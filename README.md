# Pair · Video Chatting

WebRTC 학습용 1:1 영상 대화 앱입니다. 랜덤 매칭과 초대방, 마이크·카메라 토글, 다음 상대, 데이터 채널 채팅을 구현합니다.

- 프론트엔드: React · TypeScript · Vite, `RTCPeerConnection`, `RTCDataChannel`
- 백엔드: Java 17 · Spring Boot 3.5 · Spring WebSocket, 메모리 기반 대기열·방·통화 상태
- 미디어: 브라우저 간 WebRTC, 필요 시 TURN 릴레이

## 실행

Java 17 이상과 Node.js 22.12 이상을 사용합니다. Maven은 `backend/mvnw`가 고정 버전으로 내려받습니다. 첫 빌드에는 인터넷과 `curl`, `shasum`이 필요하며, 실행기와 Maven 배포 파일의 SHA-256을 확인합니다.

```bash
npm ci
npm run build
npm run check
npm start
```

`http://localhost:3300`에서 접속합니다. 빌드한 React 정적 파일을 Spring Boot JAR에 포함하므로 실행 시 Node 서버는 필요하지 않습니다. 서버는 기본적으로 `127.0.0.1`에만 바인딩합니다. 두 브라우저 또는 서로 다른 브라우저 프로필에서 연결할 수 있습니다. 카메라·마이크는 시작 동의와 버튼 클릭 후 요청합니다.

설정을 바꾸려면 `.env.example`을 저장소 루트의 `.env`로 복사합니다. 명령은 저장소 루트에서 실행합니다. `.env`와 TURN 공유 비밀은 커밋하지 않습니다.

### 개발 모드

터미널 두 개에서 실행합니다.

```bash
npm run backend
```

```bash
npm run dev
```

프론트엔드는 `http://localhost:3305`, 백엔드는 `http://localhost:3300`입니다. Vite가 `/api`와 `/signal`을 Spring으로 프록시합니다. 개발 Origin을 `PUBLIC_ORIGIN`에서 제거하면 WebSocket 연결이 거부됩니다. Vite 프록시의 백엔드 포트는 `frontend/vite.config.js`에서 맞춥니다. 프론트엔드 변경은 HMR, 백엔드 변경은 재시작으로 반영합니다.

## 코드 구성

| 위치 | 역할 |
| --- | --- |
| `frontend/src/components/` | 영상·장치 제어, 연결 폼, 채팅 화면 |
| `frontend/src/chat/ChatClient.ts` | 매칭 시도·통화 상태·오류·종료 처리 |
| `frontend/src/chat/MediaController.ts` | 장치 권한·track·미디어 해제 |
| `frontend/src/chat/PeerSession.ts` | SDP·ICE·PeerConnection·데이터 채널 |
| `frontend/src/chat/SignalingSocket.ts` | WebSocket 연결·메시지 전달 |
| `frontend/src/hooks/useVideoChat.ts` | React 구독·페이지 종료 정리 |
| `backend/src/main/java/io/github/yoojuno/pair/api/` | 상태·ICE 설정 REST API |
| `backend/src/main/java/io/github/yoojuno/pair/matchmaking/` | 대기열·초대방·통화·차단·만료 |
| `backend/src/main/java/io/github/yoojuno/pair/signaling/` | Spring WebSocket 진입점·메시지 파싱 |
| `backend/src/main/java/io/github/yoojuno/pair/config/` | Origin·설정 검증·HTTP 보안 헤더 |

React 화면은 `useSyncExternalStore`로 통화 상태를 구독합니다. 브라우저 API 자원은 UI 컴포넌트와 분리한 클래스에서 관리합니다. 백엔드는 동기화된 매칭 상태 변경과 `ConcurrentWebSocketSessionDecorator`로 중복 매칭·동시 전송을 제어합니다. 회원·영구 기록이 없는 현재 범위에서는 DB를 추가하지 않았습니다.

## 연결 흐름

```text
브라우저 A ─ queue:join / room:create ─┐
                                     Spring Boot 매칭·시그널링
브라우저 B ─ queue:join / room:join ───┘
       ↕ paired(callId, offerer), SDP offer/answer, ICE
브라우저 A ← 영상·음성·RTCDataChannel → 브라우저 B
                    필요 시 TURN 경유
```

한쪽을 offerer로 정해 최초 offer 충돌을 피합니다. remote description보다 먼저 도착한 ICE 후보는 클라이언트에서 보관합니다. 매칭 시도 ID와 통화 ID를 구분해 이전 연결의 늦은 이벤트를 제외합니다.

- 랜덤 매칭: 대기열에서 연결 가능한 두 세션을 묶습니다. 직전 상대와 차단 상대는 같은 세션에서 다시 연결하지 않습니다.
- 초대방: 무작위 12자리 코드, 정원 2명, 대기 15분 만료입니다. 통화가 끝나면 방도 종료됩니다.
- 대기열: 10분 후 만료합니다. 실제 정리는 30초 heartbeat 주기에서 이루어집니다.
- 다음 상대: 이전 PeerConnection·채팅을 정리하고 카메라를 유지한 채 새 매칭을 요청합니다.
- 종료·상대 이탈·서버 단절: 연결을 정리하고 로컬 미디어 track을 `stop()`합니다. 자동으로 새 상대에게 연결하지 않습니다.
- 미디어 토글: track의 `enabled`를 변경합니다. 장치 자원 해제는 통화 종료에서 처리합니다.

## HTTP API

| 요청 | 응답·역할 |
| --- | --- |
| `GET /api/health` | `status`, `online`, `waiting`, `activeCalls` |
| `GET /api/config` | `iceServers`, `iceTransportPolicy`, `relayOnly` |
| `GET /` | 클라이언트 |

`/api/config`는 응답을 캐시하지 않으며 요청 주소별 분당 60회로 제한합니다. 프록시 뒤에서는 접속 주소가 프록시 주소가 될 수 있으므로 공개 배포 시 별도 신뢰 프록시·rate limit 구성이 필요합니다.

## WebSocket 계약

경로는 `/signal`입니다. 브라우저 Origin은 `PUBLIC_ORIGIN` 허용 목록과 일치해야 합니다. 클라이언트는 먼저 `welcome`을 받은 뒤 요청합니다.

| 클라이언트 type | 주요 필드 | 서버 응답 |
| --- | --- | --- |
| `queue:join` | `attemptId` | `waiting` 또는 `paired` |
| `queue:leave` | 없음 | 대기 해제 |
| `room:create` | `attemptId` | `room-created`의 `code` |
| `room:join` | `attemptId`, `code` | `paired` 또는 `error` |
| `signal` | `callId`, `description` 또는 `candidate` | 현재 상대에게 `signal` |
| `call:leave` | 없음 | 상대에게 `peer-left` |
| `peer:report` | 없음 | 연결 종료, 요청자에게 `reported` |

`attemptId`는 시작 요청마다 생성한 UUID 문자열입니다. `paired`는 `callId`, `offerer`, `mode`를 전달합니다. 시그널 메시지는 다음 형식을 사용합니다.

```json
{
  "type": "signal",
  "callId": "현재 통화 ID",
  "description": { "type": "offer", "sdp": "브라우저가 생성한 SDP" }
}
```

ICE 전달에는 같은 `callId`와 `candidate`를 사용하며, 후보 수집 종료는 `null`입니다. 서버가 수신자의 임의 ID를 신뢰하는 대신 현재 통화의 상대를 직접 찾아 전달합니다.

채팅은 서버 WebSocket을 경유하지 않고 `chat` 이름의 RTCDataChannel을 사용합니다. 메시지 길이·수신 빈도·화면 보관 개수를 제한하고 React 텍스트로 출력합니다.

WebSocket은 세션당 10초에 200개 메시지와 약 100 KB 텍스트로 제한합니다. 이진 메시지는 지원하지 않습니다. heartbeat는 30초 주기이며 응답이 없는 세션을 정리합니다. SDP는 마지막 줄바꿈까지 원문을 유지해 전달합니다.

## 인터넷 환경과 TURN

`localhost` 외의 카메라 접근에는 HTTPS가 필요합니다. 공개 호스트에서는 TLS 리버스 프록시와 WebSocket upgrade를 설정하고 `PUBLIC_ORIGIN`을 실제 HTTPS Origin으로 제한합니다. 쉼표로 여러 Origin을 지정할 수 있습니다.

```dotenv
HOST=127.0.0.1
PORT=3300
PUBLIC_ORIGIN=https://chat.example.com
TURN_URL=turn:turn.example.com:3478?transport=udp,turns:turn.example.com:5349?transport=tcp
TURN_SHARED_SECRET=replace-with-the-coturn-shared-secret
RELAY_ONLY=true
```

위 값은 설정 형식 예시입니다. 실제 TURN 서버를 제공하지 않습니다. coturn의 REST 인증 방식과 공유 비밀이 일치해야 하며, 서버는 만료 시각이 포함된 사용자 이름과 HMAC-SHA1 자격을 발급합니다. `RELAY_ONLY=true`이면 TURN 설정 없이 시작하지 않습니다.

기본 STUN은 `stun:stun.l.google.com:19302`이며 `STUN_URL`로 바꿀 수 있습니다. 빈 값은 STUN을 끕니다. STUN만으로 모든 NAT·방화벽 환경에서 연결되는 것은 아닙니다. TURN 대역폭·할당량·인증 정책은 별도로 운영해야 합니다.

## 개인정보와 운영 범위

- 카메라·마이크는 동의 후 시작합니다. 미디어·채팅 내용을 서버에 저장하지 않습니다.
- P2P 모드에서는 상대에게 네트워크 주소가 드러날 수 있습니다. 네트워크 주소 노출을 줄이려면 TURN과 relay-only 정책을 함께 사용합니다.
- 녹화 기능은 제공하지 않지만 상대방의 별도 녹화를 기술적으로 막지는 못합니다.
- 신고는 통화 ID·시각만 메모리에 최대 1시간, 최대 1,000건 보관합니다. 운영자 검토·영구 차단 기능이 아닙니다.
- 차단은 현재 WebSocket 세션 기준입니다. 새 세션으로 우회할 수 있으므로 강한 제재나 신원 확인으로 취급하지 않습니다.
- 성인 동의 체크는 실제 연령 확인이 아닙니다. 공개 익명 매칭 서비스에는 인증·연령 정책·모더레이션·신고 검토·악용 방지·운영 대응이 추가로 필요합니다.
- 방·매칭은 단일 프로세스 메모리입니다. 다중 인스턴스·재시작 복구는 구현하지 않았습니다.
- 기본 접속 수 제한, 메시지 크기·빈도 제한, Origin 검사, heartbeat는 기초 보호이며 운영 보안 감사를 대신하지 않습니다.

## 검증 범위

로컬 Chromium에서 가상 카메라·마이크를 사용해 실제 WebRTC 연결과 데이터 채널 전송을 확인했습니다. 랜덤 매칭·다음 상대·초대방·정원 제한·신고·장치 토글·종료와 권한 거부·시작 취소·서버 단절을 점검했습니다. Origin 거부, 잘못된 시그널·이진 메시지 처리, 현재 통화 상대 제한과 SDP 원문 보존도 확인했습니다. TypeScript 검사와 프론트엔드·JAR 빌드를 통과했습니다.

실장치 음질·서로 다른 NAT·TURN 실서버·다중 인스턴스·공개 서비스 부하 검증은 포함하지 않습니다. 저장소에 상시 실행되는 단위·E2E 테스트 스위트는 아직 없습니다.

### 수동 점검

1. 동의하지 않은 시작 요청에서 카메라가 켜지지 않는지 확인합니다.
2. 두 브라우저에서 랜덤 매칭 후 영상·소리·메시지를 확인합니다.
3. 초대방 코드와 링크로 연결하고, 세 번째 사용자의 입장을 거부하는지 확인합니다.
4. 마이크·카메라 토글, 다음 상대, 신고·차단, 종료 후 장치 해제를 확인합니다.
5. 권한 거부·장치 없음·잘못된 방·서버 단절·연결 타임아웃을 확인합니다.
6. 서로 다른 네트워크에서 TURN 및 relay-only 구성까지 별도로 확인합니다.

## 참고

- [MDN RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
- [Spring WebSocket](https://docs.spring.io/spring-framework/reference/web/websocket/server.html)
- [React TypeScript](https://react.dev/learn/typescript)
