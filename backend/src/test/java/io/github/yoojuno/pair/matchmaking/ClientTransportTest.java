package io.github.yoojuno.pair.matchmaking;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.ArrayList;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ClientTransportTest {
    private final OutboundDispatcher dispatcher = new OutboundDispatcher(2);
    private final WebSocketSession socket = mock(WebSocketSession.class);
    private final CountDownLatch entered = new CountDownLatch(1);
    private final CountDownLatch release = new CountDownLatch(1);
    private final List<String> sent = new CopyOnWriteArrayList<>();
    private final List<String> failed = new CopyOnWriteArrayList<>();
    private final List<CloseStatus> closed = new CopyOnWriteArrayList<>();
    private final ClientTransport transport = new ClientTransport(socket, dispatcher, failed::add);

    ClientTransportTest() throws IOException {
        when(socket.getId()).thenReturn("client");
        when(socket.isOpen()).thenReturn(true);
        doAnswer(invocation -> {
            entered.countDown();
            try { release.await(); }
            catch (InterruptedException exception) { throw new IOException("interrupted", exception); }
            sent.add(((TextMessage) invocation.getArgument(0)).getPayload());
            return null;
        }).when(socket).sendMessage(any());
        doAnswer(invocation -> { closed.add(invocation.getArgument(0)); return null; })
                .when(socket).close(any(CloseStatus.class));
    }

    @AfterEach
    void shutdown() {
        release.countDown();
        transport.close(CloseStatus.GOING_AWAY);
        dispatcher.shutdown();
        assertThat(dispatcher.isTerminated()).isTrue();
    }

    @Test
    void messagesStayInOrderWhileTheFirstSendIsBlocked() throws Exception {
        assertThat(transport.send(new TextMessage("first"))).isTrue();
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(transport.send(new TextMessage("second"))).isTrue();
        assertThat(transport.send(new TextMessage("third"))).isTrue();
        release.countDown();
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(sent).containsExactly("first", "second", "third"));
        assertThat(failed).isEmpty();
    }

    @Test
    void messageLimitIncludesTheInFlightSendAndFailsOnlyOnce() throws Exception {
        assertThat(transport.send(new TextMessage("in-flight"))).isTrue();
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        for (int index = 1; index < ClientTransport.MAX_MESSAGES; index++) {
            assertThat(transport.send(new TextMessage("queued"))).isTrue();
        }
        assertThat(transport.send(new TextMessage("overflow"))).isFalse();
        assertThat(transport.send(new TextMessage("after-close"))).isFalse();
        assertThat(failed).containsExactly("client");
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(closed).containsExactly(CloseStatus.SESSION_NOT_RELIABLE));
    }

    @Test
    void byteLimitCountsUtf8BytesAndIncludesTheInFlightSend() throws Exception {
        assertThat(transport.send(new TextMessage("한".repeat(80000)))).isTrue();
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        assertThat(transport.send(new TextMessage("x".repeat(30000)))).isFalse();
        assertThat(failed).containsExactly("client");
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(closed).containsExactly(CloseStatus.SESSION_NOT_RELIABLE));
    }

    @Test
    void shutdownInterruptsBlockedWritersAndReclaimsExecutors() throws Exception {
        transport.send(new TextMessage("blocked"));
        assertThat(entered.await(2, TimeUnit.SECONDS)).isTrue();
        transport.close(CloseStatus.GOING_AWAY);
        dispatcher.shutdown();
        assertThat(dispatcher.isTerminated()).isTrue();
        assertThat(closed).containsExactly(CloseStatus.GOING_AWAY);
    }

    @Test
    void fullCloseQueueUsesWriterCapacityWithoutDroppingTheClose() throws Exception {
        List<MatchmakingServiceTest.TestSocket> closing = new ArrayList<>();
        try {
            // Two close workers and two queue slots are full before the fifth close is submitted.
            for (int index = 0; index < 5; index++) {
                var client = new MatchmakingServiceTest.TestSocket("closing-" + index);
                client.holdClose.set(true);
                closing.add(client);
                dispatcher.close(client.socket, CloseStatus.GOING_AWAY);
            }
            assertThat(closing.get(4).closeEntered.await(2, TimeUnit.SECONDS)).isTrue();
            closing.forEach(client -> client.closeGate.countDown());
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> closing.forEach(client ->
                    assertThat(client.closed).containsExactly(CloseStatus.GOING_AWAY)));
        } finally {
            closing.forEach(client -> client.closeGate.countDown());
        }
    }

    @Test
    void closeIsRetriedWhenBothBoundedPoolsAreBusy() throws Exception {
        List<MatchmakingServiceTest.TestSocket> closing = new ArrayList<>();
        try {
            // Two close workers, two queued closes and six fallback workers leave the final close deferred.
            for (int index = 0; index < 11; index++) {
                var client = new MatchmakingServiceTest.TestSocket("closing-" + index);
                client.holdClose.set(true);
                closing.add(client);
                dispatcher.close(client.socket, CloseStatus.GOING_AWAY);
            }
            assertThat(closing.get(9).closeEntered.await(2, TimeUnit.SECONDS)).isTrue();
            assertThat(closing.get(10).closeEntered.getCount()).isEqualTo(1);
            closing.forEach(client -> client.closeGate.countDown());
            await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> {
                dispatcher.retryCloses();
                closing.forEach(client -> assertThat(client.closed).containsExactly(CloseStatus.GOING_AWAY));
            });
        } finally {
            closing.forEach(client -> client.closeGate.countDown());
        }
    }
}
