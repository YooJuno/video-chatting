package io.github.yoojuno.pair.signaling;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.PongMessage;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import io.github.yoojuno.pair.matchmaking.MatchmakingService;

@Component
public class SignalingHandler extends TextWebSocketHandler {
    private final ObjectMapper mapper;
    private final MatchmakingService matchmaking;

    public SignalingHandler(ObjectMapper mapper, MatchmakingService matchmaking) {
        this.mapper = mapper;
        this.matchmaking = matchmaking;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        session.setTextMessageSizeLimit(100000);
        session.setBinaryMessageSizeLimit(1);
        matchmaking.connect(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        if (!matchmaking.acceptMessage(session.getId())) return;
        try {
            matchmaking.handle(session.getId(), mapper.readTree(message.getPayload()));
        } catch (Exception exception) {
            matchmaking.invalid(session.getId());
        }
    }

    @Override
    protected void handlePongMessage(WebSocketSession session, PongMessage message) {
        matchmaking.pong(session.getId());
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        matchmaking.disconnect(session.getId());
    }

    @Override
    public void handleTransportError(WebSocketSession session, Throwable exception) throws Exception {
        session.close(CloseStatus.SERVER_ERROR);
        matchmaking.disconnect(session.getId());
    }
}
