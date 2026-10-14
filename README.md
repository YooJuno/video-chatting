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

### 카메라·마이크와 이용 안내

1. 화면의 **이용 안내 동의 · 필수** 항목에 동의합니다. 동의 전에도 시작 버튼을 누를 수 있지만, 장치를 켜지 않고 이유를 안내하며 체크박스로 이동합니다.
2. **대화 시작** 또는 초대방 시작 버튼을 누르면 브라우저에 카메라·마이크 권한을 요청합니다. 허용하면 브라우저의 기본 장치로 내 영상을 표시하고 상대에게 연결합니다. 내 마이크 소리는 재생하지 않습니다.

권한 팝업은 브라우저가 표시합니다. 이미 허용한 사이트는 팝업 없이 장치가 켜질 수 있고, 이전에 거부했거나 운영체제가 막은 권한을 웹페이지에서 강제로 허용할 수는 없습니다. 오류가 생기면 화면의 메시지와 **카메라·마이크 문제 해결** 안내를 확인하고, 설정을 바꾼 뒤 같은 시작 버튼으로 다시 시도합니다. 권한 조회를 지원하지 않는 브라우저도 실제 장치 요청은 수행합니다.

- Chrome·Edge: 주소창 왼쪽 사이트 설정에서 카메라·마이크를 허용한 뒤 다시 시도합니다. Safari: 설정 → 웹사이트 → 카메라·마이크에서 해당 사이트를 허용합니다.
- macOS: 시스템 설정 → 개인정보 보호 및 보안 → 카메라·마이크에서 브라우저를 허용합니다. Windows: 설정 → 개인정보 및 보안에서 카메라·마이크와 데스크톱 앱 접근을 확인합니다.
- 장치 없음, 장치 점유·운영체제 오류, 장치 설정 문제, HTTPS·페이지 보안 정책 문제를 별도로 안내합니다. 다른 통화·녹화 앱을 종료하거나 브라우저와 운영체제의 기본 장치 설정을 확인합니다.
- 이 컴퓨터에서는 `http://localhost:3305` 또는 `http://127.0.0.1:3305`로 접속합니다. 다른 기기에서 `http://192.168.…` 등으로 접속하면 HTTPS가 필요합니다.
- 권한 요청에 45초 동안 응답이 없으면 앱의 준비 상태를 해제하고 재시도 안내를 표시합니다. 앱에서 취소해도 브라우저 팝업은 남을 수 있습니다. 나중에 허용된 스트림은 즉시 종료합니다.
- 종료·동의 철회·페이지 종료는 track을 해제합니다. 장치는 브라우저와 운영체제의 설정에서 변경한 뒤 다시 시작합니다.
- 권한 변경 이벤트와 화면 복귀 때 권한을 확인합니다. 캡처 중에도 권한을 주기적으로 다시 읽어, 변경 알림이 누락되어도 차단된 장치를 해제합니다. 이 조회는 권한 팝업을 띄우지 않습니다.

개발 중 통화 관리 코드가 바뀌면 앱을 다시 마운트해 오래된 장치·연결 객체를 해제합니다. 실행 중인 개발 화면이 이전 상태로 남아 있으면 새로고침합니다.

## 코드 구성

| 위치 | 역할 |
| --- | --- |
| `frontend/src/components/` | 영상·장치 제어, 연결 폼, 채팅 화면 |
| `frontend/src/chat/ChatClient.ts` | 매칭 시도·통화 상태·오류·종료 처리 |
| `frontend/src/chat/MediaController.ts` | 장치 권한·track·미디어 해제 |
| `frontend/src/chat/PeerSession.ts` | SDP·ICE·PeerConnection·데이터 채널 |
| `frontend/src/chat/SignalingSocket.ts` | WebSocket 연결·메시지 전달 |
| `frontend/src/hooks/useVideoChat.ts` | React 구독·페이지 종료 정리·캐시 복원 |
| `backend/src/main/java/io/github/yoojuno/pair/api/` | 상태·ICE 설정 REST API |
| `backend/src/main/java/io/github/yoojuno/pair/matchmaking/` | 대기열·초대방·통화·차단·만료 |
| `backend/src/main/java/io/github/yoojuno/pair/matchmaking/ClientTransport.java` | 세션별 전송 대기열·순서·크기·시간 제한 |
| `backend/src/main/java/io/github/yoojuno/pair/matchmaking/OutboundDispatcher.java` | 소켓 전송·종료 실행기와 자원 회수 |
| `backend/src/main/java/io/github/yoojuno/pair/signaling/` | Spring WebSocket 진입점·메시지 파싱 |
| `backend/src/main/java/io/github/yoojuno/pair/config/` | Origin·설정 검증·HTTP 보안 헤더 |

React 화면은 `useSyncExternalStore`로 통화 상태를 구독합니다. 브라우저 API 자원은 UI 컴포넌트와 분리한 클래스에서 관리합니다. 백엔드는 매칭 상태 변경을 동기화하고, 소켓 전송·종료는 별도 실행기에서 수행합니다. 세션별 전송 대기열로 메시지 순서를 유지하며 느린 소켓의 I/O가 전체 매칭 상태 락을 잡지 않도록 합니다. 회원·영구 기록이 없는 현재 범위에서는 DB를 추가하지 않았습니다.

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

- 랜덤 매칭: 대기열에서 연결 가능한 두 세션을 묶습니다. 대화를 종료한 상대를 세션별 최근 50명까지 기록하여 재매칭을 피합니다.
- 초대방: 무작위 12자리 코드, 정원 2명, 대기 15분 만료입니다. 통화가 끝나면 방도 종료됩니다.
- 대기열: 10분 후 만료합니다. 실제 정리는 30초 heartbeat 주기에서 이루어집니다.
- 다음 상대: 이전 PeerConnection·채팅을 정리하고 카메라를 유지한 채 새 매칭을 요청합니다.
- 종료·상대 이탈·서버 단절: 연결을 정리하고 로컬 미디어 track을 `stop()`합니다. 자동으로 새 상대에게 연결하지 않습니다.
- 미디어 토글: track의 `enabled`를 변경합니다. 장치 자원 해제는 통화 종료에서 처리합니다.
- 페이지 복귀: 페이지를 떠나면 통화·장치를 종료합니다. 브라우저 뒤로 가기 캐시에서 복원하면 서버 연결만 다시 열며, 카메라·마이크는 시작 버튼을 눌러야 켜집니다.
- 채팅 읽기: 이전 메시지를 읽는 동안 수신 메시지로 스크롤을 이동하지 않습니다. 새 메시지 버튼으로 하단에 이동할 수 있고, 본인이 메시지를 보내면 하단으로 이동합니다.

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

채팅은 서버 WebSocket을 경유하지 않고 통화당 하나의 `chat` RTCDataChannel을 사용합니다. 다른 이름이나 추가 채널은 닫습니다. 메시지는 최대 2,000자, 수신은 통화 전체에서 1초 구간당 10개, 화면 보관은 최근 150개로 제한하고 React 텍스트로 출력합니다.

WebSocket은 세션당 10초에 200개 메시지와 약 100 KB 텍스트로 제한합니다. 이진 메시지는 지원하지 않습니다. heartbeat는 30초 주기이며 응답이 없는 세션을 정리합니다. SDP는 마지막 줄바꿈까지 원문을 유지해 전달합니다.

서버 전송 대기열은 진행 중인 메시지를 포함해 세션당 최대 256개·256 KiB입니다. 버퍼 초과나 전송 실패는 해당 세션을 정리하고, 전송이 5초를 넘기면 감시 주기에서 세션을 종료합니다. 기본 Tomcat 컨테이너의 전송·종료 제한 시간도 5초로 지정합니다. 접속·대기 인원 통계는 100ms 주기로 변경을 합쳐 전송하며, 상태 변화 없는 종료 요청에는 전체 방송을 하지 않습니다.

종료 실행기가 포화되면 다른 실행기와 유한한 재시도 대기열을 사용합니다. 이 경로까지 모두 포화되면 오류를 기록하고 컨테이너의 90초 idle timeout을 최종 정리 수단으로 사용합니다. 정상 세션은 30초 heartbeat로 유지됩니다.

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
- 차단은 현재 WebSocket 세션의 최근 50명 기준입니다. 오래된 기록은 제거되고 새 세션으로도 우회할 수 있으므로 강한 제재나 신원 확인으로 취급하지 않습니다.
- 성인 동의 체크는 실제 연령 확인이 아닙니다. 공개 익명 매칭 서비스에는 인증·연령 정책·모더레이션·신고 검토·악용 방지·운영 대응이 추가로 필요합니다.
- 방·매칭은 단일 프로세스 메모리입니다. 다중 인스턴스·재시작 복구는 구현하지 않았습니다.
- 기본 접속 수 제한, 메시지 크기·빈도 제한, Origin 검사, heartbeat는 기초 보호이며 운영 보안 감사를 대신하지 않습니다.

## 검증 범위

Vitest·React Testing Library와 JUnit으로 자동 회귀 테스트를 실행합니다. 브라우저 API와 소켓을 대체한 테스트이므로 실제 장치·네트워크 연결을 대신하지 않습니다.

```bash
# 프론트엔드와 백엔드 테스트
npm test

# TypeScript 검사와 양쪽 테스트·Maven 검증
npm run check

# 한쪽 테스트만 실행
npm run test --workspace frontend
sh backend/mvnw test
```

- 프론트엔드: 데이터 채널 이름·중복·빈도·종료 이벤트, ICE 버퍼와 연결 타이머, 동의 안내·포커스 이동, 장치 권한·실패 원인·타임아웃·취소, 동의 없는 시작·서버 단절·늦은 장치 요청, 페이지 복귀 이벤트, 채팅 스크롤·발신자 표시를 검증합니다.
- 백엔드: 느린 소켓 격리, 전송 순서·버퍼·실패 정리, 매칭·초대방·신고·시그널 계약과 불필요한 통계 방송 방지를 검증합니다.

로컬 Chromium에서 가상 카메라·마이크로 두 브라우저 간 영상·음성 RTP 수신, 양방향 채팅, 장치 토글·종료, 초대방 정원 제한을 확인했습니다. 채팅 읽기 위치와 150개 보관 한도에서의 위치 보정, 375px 모바일 화면도 점검했습니다. 수동 점검 항목은 아래와 같습니다. 실장치 음질·서로 다른 NAT·TURN 실서버·다중 인스턴스·공개 서비스 부하 검증과 상시 브라우저 E2E 스위트는 포함하지 않습니다.

Chrome의 초기 권한 상태에서 사용자 클릭 직후 실제 장치 요청이 실행되는지, 브라우저 권한을 차단·허용·해제했을 때 안내·재시도·장치 종료가 되는지 확인했습니다. HTTP 비보안 주소와 Permissions-Policy 차단도 브라우저에서 점검했습니다. 무응답·취소 뒤 늦은 허용은 제어한 비동기 요청으로 재현합니다. 이 검증에도 가상 장치를 사용했으며 실제 운영체제 권한 팝업과 물리 장치 동작은 별도 점검이 필요합니다.

### 수동 점검

1. 동의하지 않은 시작 요청에서 카메라가 켜지지 않는지 확인합니다.
2. 두 브라우저에서 랜덤 매칭 후 영상·소리·메시지를 확인합니다.
3. 초대방 코드와 링크로 연결하고, 세 번째 사용자의 입장을 거부하는지 확인합니다.
4. 마이크·카메라 토글, 다음 상대, 신고·차단, 종료 후 장치 해제를 확인합니다.
5. 권한 거부·장치 없음·잘못된 방·서버 단절·연결 타임아웃을 확인합니다.
6. 서로 다른 네트워크에서 TURN 및 relay-only 구성까지 별도로 확인합니다.
7. 채팅이 쌓인 뒤 이전 메시지를 읽는 중 새 메시지를 받아도 위치가 유지되는지, 새 메시지 버튼과 발신자 표시를 확인합니다.
8. 다른 페이지로 이동했다가 뒤로 돌아왔을 때 서버만 재연결하고 카메라·마이크는 꺼져 있는지 확인합니다.

## 참고

- [MDN RTCPeerConnection](https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection)
- [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
- [Chrome 카메라·마이크 권한](https://support.google.com/chrome/answer/2693767?hl=ko)
- [MDN WebRTC connectivity](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity)
- [Spring WebSocket](https://docs.spring.io/spring-framework/reference/web/websocket/server.html)
- [Tomcat WebSocket 설정](https://tomcat.apache.org/tomcat-10.1-doc/web-socket-howto.html)
- [React TypeScript](https://react.dev/learn/typescript)
