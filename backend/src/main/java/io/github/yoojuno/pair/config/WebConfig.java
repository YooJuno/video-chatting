package io.github.yoojuno.pair.config;

import java.util.Map;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.ServerHttpRequest;
import org.springframework.http.server.ServerHttpResponse;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.server.HandshakeInterceptor;
import io.github.yoojuno.pair.signaling.SignalingHandler;

@Configuration
@EnableWebSocket
public class WebConfig implements WebSocketConfigurer {
    private final SignalingHandler handler;
    private final ChatProperties properties;

    public WebConfig(SignalingHandler handler, ChatProperties properties) {
        this.handler = handler;
        this.properties = properties;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(handler, "/signal")
                .setAllowedOrigins(properties.origins().toArray(String[]::new))
                .addInterceptors(new HandshakeInterceptor() {
                    @Override
                    public boolean beforeHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                                   WebSocketHandler webSocketHandler, Map<String, Object> attributes) {
                        if (properties.origins().contains(request.getHeaders().getOrigin())) return true;
                        response.setStatusCode(HttpStatus.FORBIDDEN);
                        return false;
                    }

                    @Override
                    public void afterHandshake(ServerHttpRequest request, ServerHttpResponse response,
                                               WebSocketHandler webSocketHandler, Exception exception) {}
                });
    }
}
