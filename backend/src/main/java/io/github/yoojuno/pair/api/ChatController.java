package io.github.yoojuno.pair.api;

import java.util.HashMap;
import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import io.github.yoojuno.pair.config.ChatProperties;
import io.github.yoojuno.pair.matchmaking.MatchmakingService;

@RestController
@RequestMapping("/api")
public class ChatController {
    private final IceConfigService ice;
    private final MatchmakingService matchmaking;
    private final ChatProperties properties;
    private final Map<String, RequestWindow> requests = new HashMap<>();

    public ChatController(IceConfigService ice, MatchmakingService matchmaking, ChatProperties properties) {
        this.ice = ice;
        this.matchmaking = matchmaking;
        this.properties = properties;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return matchmaking.health();
    }

    @GetMapping("/config")
    public synchronized ResponseEntity<?> configuration(HttpServletRequest request) {
        String origin = request.getHeader("Origin");
        if (origin != null && !properties.origins().contains(origin)) return ResponseEntity.status(403).body(Map.of("error", "Origin not allowed"));
        long now = System.currentTimeMillis();
        String address = request.getRemoteAddr();
        RequestWindow window = requests.get(address);
        if (window == null || now - window.startedAt > 60000) window = new RequestWindow(now);
        window.count++;
        requests.put(address, window);
        if (window.count > 60) return ResponseEntity.status(429).header("Retry-After", "60").body(Map.of("error", "Too many requests"));
        return ResponseEntity.ok(ice.configuration());
    }

    @Scheduled(fixedDelay = 60000)
    public synchronized void expireRequests() {
        long now = System.currentTimeMillis();
        requests.values().removeIf(window -> now - window.startedAt > 60000);
    }

    private static final class RequestWindow {
        final long startedAt;
        int count;
        RequestWindow(long startedAt) { this.startedAt = startedAt; }
    }
}
