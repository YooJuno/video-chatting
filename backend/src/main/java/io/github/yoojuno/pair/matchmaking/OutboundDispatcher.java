package io.github.yoojuno.pair.matchmaking;

import java.io.IOException;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketSession;

/** Network I/O runs here, never under the matchmaking state lock. */
final class OutboundDispatcher {
    private static final Logger log = LoggerFactory.getLogger(OutboundDispatcher.class);
    private final ExecutorService writers;
    private final ExecutorService closers;
    private final ArrayBlockingQueue<CloseRequest> deferredCloses;

    OutboundDispatcher(int maxClients) {
        deferredCloses = new ArrayBlockingQueue<>(maxClients);
        writers = new ThreadPoolExecutor(0, maxClients + 4, 30, TimeUnit.SECONDS,
                new SynchronousQueue<>(), threads("pair-send-"));
        ThreadPoolExecutor closePool = new ThreadPoolExecutor(Math.min(4, maxClients), maxClients,
                30, TimeUnit.SECONDS, new ArrayBlockingQueue<>(maxClients), threads("pair-close-"));
        closePool.allowCoreThreadTimeOut(true);
        closers = closePool;
    }

    void write(Runnable task) {
        writers.execute(task);
    }

    void close(WebSocketSession socket, CloseStatus status) {
        CloseRequest request = new CloseRequest(socket, status);
        if (submitClose(request)) return;
        if (!deferredCloses.offer(request)) {
            // The native Tomcat session's idle timeout is the final cleanup policy under full overload.
            log.error("WebSocket close capacity exhausted for {}; falling back to native idle timeout", socket.getId());
        }
    }

    private boolean submitClose(CloseRequest request) {
        Runnable task = () -> {
            try { request.socket.close(request.status); }
            catch (IOException | RuntimeException exception) {
                log.debug("WebSocket close failed for {}", request.socket.getId(), exception);
            }
        };
        try {
            closers.execute(task);
            return true;
        } catch (RejectedExecutionException exception) {
            try {
                writers.execute(task);
                return true;
            } catch (RejectedExecutionException busy) {
                return false;
            }
        }
    }

    void retryCloses() {
        int attempts = deferredCloses.size();
        for (int index = 0; index < attempts; index++) {
            CloseRequest request = deferredCloses.poll();
            if (request == null) return;
            if (!submitClose(request)) {
                if (!deferredCloses.offer(request)) {
                    log.error("WebSocket close retry capacity exhausted for {}; falling back to native idle timeout", request.socket.getId());
                }
                return;
            }
        }
    }

    void shutdown() {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5);
        try {
            while (!deferredCloses.isEmpty() && remaining(deadline) > 0) {
                retryCloses();
                if (!deferredCloses.isEmpty()) TimeUnit.MILLISECONDS.sleep(10);
            }
            if (!deferredCloses.isEmpty()) {
                log.warn("Native container shutdown will close {} deferred WebSocket sessions", deferredCloses.size());
                deferredCloses.clear();
            }
            writers.shutdownNow();
            closers.shutdown();
            writers.awaitTermination(remaining(deadline), TimeUnit.NANOSECONDS);
            if (!closers.awaitTermination(remaining(deadline), TimeUnit.NANOSECONDS)) closers.shutdownNow();
        } catch (InterruptedException exception) {
            writers.shutdownNow();
            closers.shutdownNow();
            Thread.currentThread().interrupt();
        }
    }

    boolean isTerminated() {
        return writers.isTerminated() && closers.isTerminated();
    }

    private static long remaining(long deadline) {
        return Math.max(0, deadline - System.nanoTime());
    }

    private static ThreadFactory threads(String prefix) {
        AtomicInteger sequence = new AtomicInteger();
        return task -> {
            Thread thread = new Thread(task, prefix + sequence.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    private record CloseRequest(WebSocketSession socket, CloseStatus status) {}
}
