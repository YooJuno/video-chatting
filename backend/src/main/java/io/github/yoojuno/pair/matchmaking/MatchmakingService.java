package io.github.yoojuno.pair.matchmaking;

import java.io.IOException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PingMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import io.github.yoojuno.pair.config.ChatProperties;

@Service
public class MatchmakingService {
    private final ObjectMapper mapper;
    private final ChatProperties properties;
    private final SecureRandom random = new SecureRandom();
    private final Map<String, ClientSession> clients = new HashMap<>();
    private final Set<String> queue = new LinkedHashSet<>();
    private final Map<String, Room> rooms = new HashMap<>();
    private final Map<String, Call> calls = new HashMap<>();
    private final List<Report> reports = new ArrayList<>();

    public MatchmakingService(ObjectMapper mapper, ChatProperties properties) {
        this.mapper = mapper;
        this.properties = properties;
    }

    public synchronized void connect(WebSocketSession socket) {
        if (clients.size() >= properties.maxClients()) {
            closeSocket(socket, CloseStatus.POLICY_VIOLATION);
            return;
        }
        ClientSession client = new ClientSession(socket);
        clients.put(client.id, client);
        send(client, Map.of("type", "welcome", "id", client.id));
        stats();
    }

    public synchronized boolean acceptMessage(String id) {
        ClientSession client = clients.get(id);
        if (client == null) return false;
        long now = System.currentTimeMillis();
        if (now - client.rateStart > 10000) { client.rateStart = now; client.rateCount = 0; }
        if (++client.rateCount <= 200) return true;
        disconnect(id);
        closeSocket(client.socket, CloseStatus.POLICY_VIOLATION);
        return false;
    }

    public synchronized void handle(String id, JsonNode message) {
        ClientSession client = clients.get(id);
        if (client == null) return;
        if (message == null || !message.isObject()) throw new IllegalArgumentException("Invalid message");
        String type = text(message, "type", 40);
        if (Set.of("queue:join", "room:create", "room:join").contains(type)) client.attemptId = text(message, "attemptId", 80);
        switch (type) {
            case "queue:join" -> joinQueue(client);
            case "queue:leave", "call:leave" -> release(client, "left");
            case "room:create" -> createRoom(client);
            case "room:join" -> joinRoom(client, message);
            case "signal" -> { relay(client, message); return; }
            case "peer:report" -> report(client);
            default -> throw new IllegalArgumentException("Unknown message");
        }
        stats();
    }

    public synchronized void invalid(String id) {
        error(clients.get(id), "요청 형식을 확인해주세요.");
    }

    public synchronized void pong(String id) {
        ClientSession client = clients.get(id);
        if (client != null) client.alive = true;
    }

    public synchronized void disconnect(String id) {
        ClientSession client = clients.remove(id);
        if (client == null) return;
        release(client, "disconnected");
        stats();
    }

    public synchronized Map<String, Object> health() {
        return Map.of("status", "ok", "online", clients.size(), "waiting", queue.size(), "activeCalls", calls.size());
    }

    private boolean occupied(ClientSession client) {
        return client.callId != null || client.roomCode != null || queue.contains(client.id);
    }

    private void joinQueue(ClientSession client) {
        if (occupied(client)) { error(client, "이미 연결 또는 대기 중입니다."); return; }
        for (String id : List.copyOf(queue)) {
            ClientSession member = clients.get(id);
            if (member == null || !member.socket.isOpen()) { queue.remove(id); continue; }
            if (!id.equals(client.id) && !member.blocked.contains(client.id) && !client.blocked.contains(id)) {
                pair(member, client, null);
                return;
            }
        }
        queue.add(client.id);
        client.waitingSince = System.currentTimeMillis();
        send(client, Map.of("type", "waiting", "mode", "random"));
    }

    private void createRoom(ClientSession client) {
        if (occupied(client)) { error(client, "먼저 현재 연결을 종료해주세요."); return; }
        String code;
        do {
            byte[] bytes = new byte[6];
            random.nextBytes(bytes);
            code = HexFormat.of().withUpperCase().formatHex(bytes);
        } while (rooms.containsKey(code));
        rooms.put(code, new Room(client.id, System.currentTimeMillis()));
        client.roomCode = code;
        send(client, Map.of("type", "room-created", "code", code));
    }

    private void joinRoom(ClientSession client, JsonNode message) {
        if (occupied(client)) { error(client, "먼저 현재 연결을 종료해주세요."); return; }
        String code = text(message, "code", 12).trim().toUpperCase(java.util.Locale.ROOT);
        Room room = code.matches("[A-F0-9]{12}") ? rooms.get(code) : null;
        ClientSession owner = room == null ? null : clients.get(room.owner);
        if (owner == null || owner.callId != null || owner.id.equals(client.id) || System.currentTimeMillis() - room.createdAt > 900000) {
            error(client, "입장할 수 없는 방입니다. 코드를 확인하거나 새 방을 만들어주세요.");
            return;
        }
        if (owner.blocked.contains(client.id) || client.blocked.contains(owner.id)) {
            error(client, "이 세션에서는 서로 다시 연결할 수 없습니다.");
            return;
        }
        client.roomCode = code;
        pair(owner, client, code);
    }

    private void pair(ClientSession first, ClientSession second, String roomCode) {
        queue.remove(first.id);
        queue.remove(second.id);
        Call call = new Call(UUID.randomUUID().toString(), List.of(first.id, second.id), roomCode);
        calls.put(call.id, call);
        first.callId = call.id;
        second.callId = call.id;
        String mode = roomCode == null ? "random" : "room";
        send(first, Map.of("type", "paired", "callId", call.id, "offerer", true, "mode", mode));
        send(second, Map.of("type", "paired", "callId", call.id, "offerer", false, "mode", mode));
    }

    private void release(ClientSession client, String reason) {
        queue.remove(client.id);
        if (client.roomCode != null) {
            Room room = rooms.get(client.roomCode);
            if (room != null && room.owner.equals(client.id)) rooms.remove(client.roomCode);
            client.roomCode = null;
        }
        Call call = client.callId == null ? null : calls.remove(client.callId);
        client.callId = null;
        if (call == null) return;
        if (call.roomCode != null) rooms.remove(call.roomCode);
        for (String id : call.members) {
            ClientSession member = clients.get(id);
            if (member == null) continue;
            member.callId = null;
            member.roomCode = null;
            member.block(call.members.get(0).equals(id) ? call.members.get(1) : call.members.get(0));
            if (!id.equals(client.id)) send(member, Map.of("type", "peer-left", "callId", call.id, "reason", reason));
        }
    }

    private void relay(ClientSession client, JsonNode message) {
        Call call = client.callId == null ? null : calls.get(client.callId);
        if (call == null || !call.id.equals(message.path("callId").asText())) return;
        Map<String, Object> payload = new HashMap<>();
        payload.put("type", "signal");
        payload.put("callId", call.id);
        JsonNode description = message.path("description");
        JsonNode candidate = message.path("candidate");
        if (description.isObject() && Set.of("offer", "answer").contains(description.path("type").asText())) {
            payload.put("description", Map.of("type", description.path("type").asText(), "sdp", text(description, "sdp", 65000)));
        } else if (message.has("candidate") && (candidate.isNull() || (candidate.isObject()
                && candidate.path("candidate").isTextual() && candidate.path("candidate").textValue().length() <= 4000
                && (!candidate.has("sdpMid") || candidate.path("sdpMid").isNull() || candidate.path("sdpMid").isTextual())
                && (!candidate.has("sdpMLineIndex") || candidate.path("sdpMLineIndex").isNull() || candidate.path("sdpMLineIndex").isInt())))) {
            payload.put("candidate", candidate);
        } else throw new IllegalArgumentException("Invalid signal");
        String peerId = call.members.get(0).equals(client.id) ? call.members.get(1) : call.members.get(0);
        send(clients.get(peerId), payload);
    }

    private void report(ClientSession client) {
        if (client.callId == null) return;
        reports.add(new Report(client.callId, System.currentTimeMillis()));
        if (reports.size() > 1000) reports.remove(0);
        release(client, "reported");
        send(client, Map.of("type", "reported"));
    }

    private String text(JsonNode node, String field, int maximum) {
        JsonNode value = node.path(field);
        if (!value.isTextual() || value.textValue().isBlank() || value.textValue().length() > maximum) throw new IllegalArgumentException("Invalid " + field);
        return value.textValue();
    }

    private void error(ClientSession client, String message) {
        send(client, Map.of("type", "error", "message", message));
    }

    private void send(ClientSession client, Map<String, Object> message) {
        if (client == null || !client.socket.isOpen()) return;
        Map<String, Object> payload = new HashMap<>(message);
        if (client.attemptId != null) payload.put("attemptId", client.attemptId);
        try { client.socket.sendMessage(new TextMessage(mapper.writeValueAsString(payload))); }
        catch (IOException | RuntimeException exception) { closeSocket(client.socket, CloseStatus.SERVER_ERROR); }
    }

    private void stats() {
        Map<String, Object> message = Map.of("type", "stats", "online", clients.size(), "waiting", queue.size());
        for (ClientSession client : List.copyOf(clients.values())) send(client, message);
    }

    private void closeSocket(WebSocketSession socket, CloseStatus status) {
        try { socket.close(status); } catch (IOException ignored) {}
    }

    @Scheduled(fixedDelay = 30000)
    public synchronized void heartbeat() {
        long now = System.currentTimeMillis();
        for (ClientSession client : List.copyOf(clients.values())) {
            if (!client.alive || !client.socket.isOpen()) {
                disconnect(client.id);
                closeSocket(client.socket, CloseStatus.SESSION_NOT_RELIABLE);
                continue;
            }
            client.alive = false;
            try { client.socket.sendMessage(new PingMessage()); }
            catch (IOException | RuntimeException exception) { disconnect(client.id); closeSocket(client.socket, CloseStatus.SERVER_ERROR); }
            if (queue.contains(client.id) && now - client.waitingSince > 600000) {
                release(client, "expired");
                send(client, Map.of("type", "expired", "message", "대기 시간이 만료되었습니다. 다시 시작해주세요."));
            }
        }
        for (Map.Entry<String, Room> entry : List.copyOf(rooms.entrySet())) {
            ClientSession owner = clients.get(entry.getValue().owner);
            if ((owner == null || owner.callId == null) && now - entry.getValue().createdAt > 900000) {
                rooms.remove(entry.getKey());
                if (owner != null) {
                    owner.roomCode = null;
                    send(owner, Map.of("type", "expired", "message", "초대방이 만료되었습니다. 새 방을 만들어주세요."));
                }
            }
        }
        reports.removeIf(report -> now - report.createdAt > 3600000);
        stats();
    }

    @PreDestroy
    public synchronized void shutdown() {
        List<ClientSession> active = List.copyOf(clients.values());
        clients.clear();
        queue.clear();
        calls.clear();
        rooms.clear();
        reports.clear();
        for (ClientSession client : active) closeSocket(client.socket, CloseStatus.GOING_AWAY);
    }

    private record Room(String owner, long createdAt) {}
    private record Call(String id, List<String> members, String roomCode) {}
    private record Report(String callId, long createdAt) {}
}
