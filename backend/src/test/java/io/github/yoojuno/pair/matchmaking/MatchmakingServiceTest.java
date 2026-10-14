package io.github.yoojuno.pair.matchmaking;

import java.io.IOException;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketMessage;
import org.springframework.web.socket.WebSocketSession;
import io.github.yoojuno.pair.config.ChatProperties;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.junit.jupiter.api.Assertions.assertTimeoutPreemptively;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class MatchmakingServiceTest {
    private static final ObjectMapper mapper = new ObjectMapper();
    private final MatchmakingService service = new MatchmakingService(mapper,
            new ChatProperties("http://localhost:3300", 20, "", "", "", false));
    private final List<TestSocket> sockets = new CopyOnWriteArrayList<>();

    @AfterEach
    void shutdown() {
        sockets.forEach(socket -> { socket.sendGate.countDown(); socket.closeGate.countDown(); });
        service.shutdown();
    }

    @Test
    void slowSendAndCloseDoNotBlockHealthOrOtherClients() throws Exception {
        TestSocket slow = socket("slow");
        slow.holdSend.set(true);
        slow.holdClose.set(true);
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> service.connect(slow.socket));
        assertThat(slow.sendEntered.await(2, TimeUnit.SECONDS)).isTrue();
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> assertThat(service.health().get("online")).isEqualTo(1));
        TestSocket first = connect("first");
        TestSocket second = connect("second");
        request(first, "queue:join");
        request(second, "queue:join");
        assertThat(first.message("paired", 1).path("callId").asText())
                .isEqualTo(second.message("paired", 1).path("callId").asText());
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> service.disconnect(slow.id));
        assertThat(slow.closeEntered.await(2, TimeUnit.SECONDS)).isTrue();
        assertTimeoutPreemptively(Duration.ofSeconds(1), () -> assertThat(service.health().get("online")).isEqualTo(2));
        request(first, "call:leave");
        assertThat(second.message("peer-left", 1).path("reason").asText()).isEqualTo("left");
    }

    @Test
    void timedOutWriterReleasesItsCallAndClosesTheSocket() throws Exception {
        TestSocket slow = socket("slow");
        slow.holdSend.set(true);
        service.connect(slow.socket);
        assertThat(slow.sendEntered.await(2, TimeUnit.SECONDS)).isTrue();
        TestSocket peer = connect("peer");
        request(slow, "queue:join");
        request(peer, "queue:join");
        String call = peer.message("paired", 1).path("callId").asText();
        service.reapSlowClients(System.nanoTime() + TimeUnit.SECONDS.toNanos(6));
        assertThat(service.health()).containsEntry("online", 1).containsEntry("activeCalls", 0).containsEntry("waiting", 0);
        assertThat(peer.message("peer-left", 1).path("callId").asText()).isEqualTo(call);
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(slow.closed)
                .containsExactly(CloseStatus.SESSION_NOT_RELIABLE));
    }

    @Test
    void sendFailureRemovesTheClientAndNotifiesItsPeer() {
        TestSocket first = connect("first");
        TestSocket second = connect("second");
        request(first, "queue:join");
        request(second, "queue:join");
        String call = first.message("paired", 1).path("callId").asText();
        second.message("paired", 1);
        first.failSend.set(true);
        signal(second, call, "offer", "v=0\r\n");
        await().atMost(Duration.ofSeconds(2)).untilAsserted(() -> assertThat(first.closed).containsExactly(CloseStatus.SERVER_ERROR));
        assertThat(service.health()).containsEntry("online", 1).containsEntry("activeCalls", 0);
        assertThat(second.message("peer-left", 1).path("callId").asText()).isEqualTo(call);
    }

    @Test
    void matchmakingPreservesCallAuthorizationReportsAndPreviousPeerRestriction() {
        TestSocket first = connect("first");
        TestSocket second = connect("second");
        TestSocket third = connect("third");
        request(first, "queue:join");
        request(second, "queue:join");
        JsonNode paired = first.message("paired", 1);
        String call = paired.path("callId").asText();
        assertThat(paired.path("offerer").asBoolean()).isTrue();
        assertThat(second.message("paired", 1).path("offerer").asBoolean()).isFalse();
        signal(first, "old-call", "offer", "ignored");
        signal(third, call, "offer", "ignored");
        String sdp = "v=0\r\ns=original  \r\n";
        signal(first, call, "offer", sdp);
        assertThat(second.message("signal", 1).path("description").path("sdp").asText()).isEqualTo(sdp);
        signal(first, call, "answer", "second\r\n");
        second.message("signal", 2);
        assertThat(second.count("signal")).isEqualTo(2);
        request(first, "peer:report");
        first.message("reported", 1);
        assertThat(second.message("peer-left", 1).path("reason").asText()).isEqualTo("reported");
        request(first, "queue:join");
        request(second, "queue:join");
        assertThat(service.health()).containsEntry("waiting", 2).containsEntry("activeCalls", 0);
        request(third, "queue:join");
        assertThat(first.message("paired", 2).path("callId").asText())
                .isEqualTo(third.message("paired", 1).path("callId").asText());
        request(third, "call:leave");
        assertThat(service.health()).containsEntry("waiting", 1).containsEntry("activeCalls", 0);
    }

    @Test
    void invitationRoomHasTwoMembersAndEndsWithItsCall() {
        TestSocket owner = connect("owner");
        TestSocket guest = connect("guest");
        TestSocket third = connect("third");
        request(owner, "room:create");
        String code = owner.message("room-created", 1).path("code").asText();
        assertThat(code).matches("[A-F0-9]{12}");
        joinRoom(guest, code);
        assertThat(owner.message("paired", 1).path("mode").asText()).isEqualTo("room");
        guest.message("paired", 1);
        joinRoom(third, code);
        third.message("error", 1);
        request(guest, "call:leave");
        owner.message("peer-left", 1);
        joinRoom(third, code);
        third.message("error", 2);
        assertThat(service.health()).containsEntry("activeCalls", 0).containsEntry("waiting", 0);
    }

    @Test
    void unchangedLeaveAndErrorDoNotBroadcastStatsAndChangesAreCoalesced() {
        TestSocket first = connect("first");
        TestSocket second = connect("second");
        service.flushStats();
        first.message("stats", 2);
        second.message("stats", 2);
        request(first, "queue:leave");
        request(first, "call:leave");
        joinRoom(first, "FFFFFFFFFFFF");
        service.flushStats();
        service.invalid(first.id);
        first.message("error", 2);
        service.invalid(second.id);
        second.message("error", 1);
        assertThat(first.count("stats")).isEqualTo(2);
        assertThat(second.count("stats")).isEqualTo(2);
        request(first, "queue:join");
        request(first, "queue:leave");
        service.flushStats();
        service.invalid(first.id);
        first.message("error", 3);
        assertThat(first.count("stats")).isEqualTo(2);
        request(first, "queue:join");
        service.flushStats();
        assertThat(second.message("stats", 3).path("waiting").asInt()).isEqualTo(1);
    }

    private TestSocket socket(String id) {
        TestSocket socket = new TestSocket(id);
        sockets.add(socket);
        return socket;
    }

    private TestSocket connect(String id) {
        TestSocket socket = socket(id);
        service.connect(socket.socket);
        socket.message("welcome", 1);
        socket.message("stats", 1);
        return socket;
    }

    private void request(TestSocket socket, String type) {
        service.handle(socket.id, mapper.valueToTree(Map.of("type", type, "attemptId", UUID.randomUUID().toString())));
    }

    private void joinRoom(TestSocket socket, String code) {
        service.handle(socket.id, mapper.valueToTree(Map.of("type", "room:join", "attemptId", UUID.randomUUID().toString(), "code", code)));
    }

    private void signal(TestSocket socket, String call, String type, String sdp) {
        service.handle(socket.id, mapper.valueToTree(Map.of("type", "signal", "callId", call,
                "description", Map.of("type", type, "sdp", sdp))));
    }

    static final class TestSocket {
        final String id;
        final WebSocketSession socket = mock(WebSocketSession.class);
        final List<JsonNode> received = new CopyOnWriteArrayList<>();
        final List<CloseStatus> closed = new CopyOnWriteArrayList<>();
        final AtomicBoolean holdSend = new AtomicBoolean();
        final AtomicBoolean holdClose = new AtomicBoolean();
        final AtomicBoolean failSend = new AtomicBoolean();
        final AtomicBoolean open = new AtomicBoolean(true);
        final CountDownLatch sendEntered = new CountDownLatch(1);
        final CountDownLatch sendGate = new CountDownLatch(1);
        final CountDownLatch closeEntered = new CountDownLatch(1);
        final CountDownLatch closeGate = new CountDownLatch(1);

        TestSocket(String id) {
            this.id = id;
            when(socket.getId()).thenReturn(id);
            when(socket.isOpen()).thenAnswer(invocation -> open.get());
            try {
                doAnswer(invocation -> {
                    sendEntered.countDown();
                    if (holdSend.get()) {
                        try { sendGate.await(); }
                        catch (InterruptedException exception) { throw new IOException("interrupted", exception); }
                    }
                    if (failSend.get()) throw new IOException("simulated send failure");
                    WebSocketMessage<?> message = invocation.getArgument(0);
                    if (message instanceof TextMessage text) received.add(mapper.readTree(text.getPayload()));
                    return null;
                }).when(socket).sendMessage(any());
                doAnswer(invocation -> {
                    closeEntered.countDown();
                    if (holdClose.get()) closeGate.await();
                    open.set(false);
                    closed.add(invocation.getArgument(0));
                    return null;
                }).when(socket).close(any(CloseStatus.class));
            } catch (IOException exception) { throw new AssertionError(exception); }
        }

        long count(String type) {
            return received.stream().filter(message -> type.equals(message.path("type").asText())).count();
        }

        JsonNode message(String type, int occurrence) {
            await().atMost(Duration.ofSeconds(3)).until(() -> count(type) >= occurrence);
            return received.stream().filter(message -> type.equals(message.path("type").asText()))
                    .skip(occurrence - 1).findFirst().orElseThrow();
        }
    }
}
