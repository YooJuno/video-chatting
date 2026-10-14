package io.github.yoojuno.pair;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;
import io.github.yoojuno.pair.config.ChatProperties;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(ChatProperties.class)
public class PairApplication {
    public static void main(String[] arguments) {
        SpringApplication.run(PairApplication.class, arguments);
    }
}
