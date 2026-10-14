package io.github.yoojuno.pair.api;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.stereotype.Service;
import io.github.yoojuno.pair.config.ChatProperties;

@Service
public class IceConfigService {
    private final ChatProperties properties;

    public IceConfigService(ChatProperties properties) {
        this.properties = properties;
    }

    public Map<String, Object> configuration() {
        List<Map<String, Object>> servers = new ArrayList<>();
        if (!properties.relayOnly() && !properties.stunUrl().isBlank()) servers.add(Map.of("urls", properties.stunUrl()));
        if (!properties.turnUrl().isBlank()) {
            String username = (Instant.now().getEpochSecond() + 3600) + ":" + UUID.randomUUID();
            try {
                Mac signature = Mac.getInstance("HmacSHA1");
                signature.init(new SecretKeySpec(properties.turnSharedSecret().getBytes(StandardCharsets.UTF_8), "HmacSHA1"));
                String credential = Base64.getEncoder().encodeToString(signature.doFinal(username.getBytes(StandardCharsets.UTF_8)));
                servers.add(Map.of("urls", Arrays.stream(properties.turnUrl().split(",")).map(String::trim).toList(),
                        "username", username, "credential", credential));
            } catch (Exception exception) {
                throw new IllegalStateException("TURN credentials could not be generated", exception);
            }
        }
        return Map.of("iceServers", servers, "iceTransportPolicy", properties.relayOnly() ? "relay" : "all", "relayOnly", properties.relayOnly());
    }
}
