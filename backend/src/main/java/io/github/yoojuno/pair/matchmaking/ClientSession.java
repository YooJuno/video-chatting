package io.github.yoojuno.pair.matchmaking;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.function.Consumer;
import org.springframework.web.socket.WebSocketSession;

final class ClientSession {
    final String id;
    final ClientTransport transport;
    final Set<String> blocked = new LinkedHashSet<>();
    String callId;
    String roomCode;
    String attemptId;
    boolean alive = true;
    long waitingSince;
    long rateStart = System.currentTimeMillis();
    int rateCount;

    ClientSession(WebSocketSession socket, OutboundDispatcher dispatcher, Consumer<String> failure) {
        this.id = socket.getId();
        this.transport = new ClientTransport(socket, dispatcher, failure);
    }

    void block(String otherId) {
        blocked.add(otherId);
        if (blocked.size() > 50) blocked.remove(blocked.iterator().next());
    }
}
