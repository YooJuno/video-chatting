package io.github.yoojuno.pair.matchmaking;

import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;

final class ClientSession {
    final String id;
    final WebSocketSession socket;
    final Set<String> blocked = new LinkedHashSet<>();
    String callId;
    String roomCode;
    String attemptId;
    boolean alive = true;
    long waitingSince;
    long rateStart = System.currentTimeMillis();
    int rateCount;

    ClientSession(WebSocketSession socket) {
        this.id = socket.getId();
        this.socket = new ConcurrentWebSocketSessionDecorator(socket, 5000, 262144);
    }

    void block(String otherId) {
        blocked.add(otherId);
        if (blocked.size() > 50) blocked.remove(blocked.iterator().next());
    }
}
