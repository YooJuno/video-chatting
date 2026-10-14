package io.github.yoojuno.pair.matchmaking;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Queue;
import java.util.concurrent.FutureTask;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;

/** A bounded FIFO mailbox with at most one writer for each WebSocket session. */
final class ClientTransport {
    static final int MAX_MESSAGES = 256;
    static final int MAX_BYTES = 262144;
    private static final long SEND_TIMEOUT_NANOS = TimeUnit.SECONDS.toNanos(5);

    private final WebSocketSession socket;
    private final OutboundDispatcher dispatcher;
    private final Consumer<String> failure;
    private final Queue<WebSocketMessage<?>> messages = new ArrayDeque<>();
    private FutureTask<Void> writer;
    private boolean closed;
    private int bufferedMessages;
    private int bufferedBytes;
    private long sendStarted;

    ClientTransport(WebSocketSession socket, OutboundDispatcher dispatcher, Consumer<String> failure) {
        this.socket = socket;
        this.dispatcher = dispatcher;
        this.failure = failure;
    }

    boolean isOpen() {
        synchronized (this) {
            return !closed && socket.isOpen();
        }
    }

    boolean send(WebSocketMessage<?> message) {
        FutureTask<Void> task = null;
        boolean overflow;
        synchronized (this) {
            if (closed) return false;
            overflow = bufferedMessages >= MAX_MESSAGES || message.getPayloadLength() > MAX_BYTES - bufferedBytes;
            if (!overflow) {
                messages.add(message);
                bufferedMessages++;
                bufferedBytes += message.getPayloadLength();
                if (writer == null) {
                    task = new FutureTask<>(() -> { drain(); return null; });
                    writer = task;
                }
            }
        }
        if (overflow) {
            terminate(CloseStatus.SESSION_NOT_RELIABLE, true);
            return false;
        }
        if (task != null) {
            try { dispatcher.write(task); }
            catch (RejectedExecutionException exception) {
                terminate(CloseStatus.SERVER_ERROR, true);
                return false;
            }
        }
        return true;
    }

    private void drain() {
        while (true) {
            WebSocketMessage<?> message;
            synchronized (this) {
                if (closed) return;
                message = messages.poll();
                if (message == null) {
                    writer = null;
                    return;
                }
                sendStarted = System.nanoTime();
            }
            try { socket.sendMessage(message); }
            catch (IOException | RuntimeException exception) {
                terminate(CloseStatus.SERVER_ERROR, true);
                return;
            }
            synchronized (this) {
                if (closed) return;
                sendStarted = 0;
                bufferedMessages--;
                bufferedBytes -= message.getPayloadLength();
            }
        }
    }

    void checkTimeout(long now) {
        boolean expired;
        synchronized (this) {
            expired = !closed && sendStarted != 0 && now - sendStarted > SEND_TIMEOUT_NANOS;
        }
        if (expired) terminate(CloseStatus.SESSION_NOT_RELIABLE, true);
    }

    void close(CloseStatus status) {
        terminate(status, false);
    }

    private void terminate(CloseStatus status, boolean notifyFailure) {
        FutureTask<Void> active;
        synchronized (this) {
            if (closed) return;
            closed = true;
            active = writer;
            writer = null;
            messages.clear();
            bufferedMessages = 0;
            bufferedBytes = 0;
            sendStarted = 0;
        }
        // This callback only adds an ID to the service's failure queue; it never takes its state lock.
        if (notifyFailure) failure.accept(socket.getId());
        if (active != null) active.cancel(true);
        dispatcher.close(socket, status);
    }
}
