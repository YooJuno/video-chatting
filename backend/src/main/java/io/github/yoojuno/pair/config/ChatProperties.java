package io.github.yoojuno.pair.config;

import java.net.URI;
import java.util.Arrays;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("chat")
public record ChatProperties(String allowedOrigins, int maxClients, String stunUrl, String turnUrl,
                             String turnSharedSecret, boolean relayOnly) {
    public ChatProperties {
        if (maxClients < 2 || maxClients > 10000) throw new IllegalArgumentException("MAX_CLIENTS must be between 2 and 10000");
        for (String origin : allowedOrigins.split(",")) {
            URI address = URI.create(origin.trim());
            if (!("http".equals(address.getScheme()) || "https".equals(address.getScheme()))
                    || address.getHost() == null || address.getRawUserInfo() != null
                    || address.getRawQuery() != null || address.getRawFragment() != null
                    || (address.getRawPath() != null && !address.getRawPath().isEmpty())) {
                throw new IllegalArgumentException("PUBLIC_ORIGIN must contain exact HTTP(S) origins without paths");
            }
        }
        if (relayOnly && (turnUrl.isBlank() || turnSharedSecret.isBlank())) {
            throw new IllegalArgumentException("RELAY_ONLY requires TURN_URL and TURN_SHARED_SECRET");
        }
        if (turnUrl.isBlank() != turnSharedSecret.isBlank()) throw new IllegalArgumentException("TURN_URL and TURN_SHARED_SECRET must be set together");
    }

    public List<String> origins() {
        return Arrays.stream(allowedOrigins.split(",")).map(String::trim).toList();
    }
}
