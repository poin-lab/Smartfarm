# GREEN LINK 장비 연동 가이드

이 문서는 후순위 선택 기능인 ESP32, 라즈베리파이, PLC, IP 카메라 연동을 설명한다. 현재 핵심 범위와 API 전체 목록은 [FEATURES.md](./FEATURES.md)와 [API.md](./API.md)를 기준으로 한다.

장비는 계정 비밀번호가 아니라 관리자 화면/API에서 한 번만 발급되는 개별 `X-Device-Key`로 인증한다. 서버에는 키의 SHA-256 해시만 저장된다.

## 1. 장비 등록

관리자 화면에서 장비를 등록한다. API를 직접 호출할 때 브라우저는 관리자 쿠키와 CSRF 헤더를 사용한다. 응답의 `apiKey`는 다시 조회할 수 없으므로 장비의 보안 저장소에 보관한다.

```http
POST /api/admin/iot/devices
Cookie: green_link_session=<admin-session>
X-Green-Link-Request: 1
Content-Type: application/json

{"containerId":"a-01","name":"A01 ESP32","deviceType":"sensor"}
```

`deviceType`은 `sensor`, `controller`, `camera` 중 하나입니다.

## 2. 센서 데이터 전송

센서 장비는 HTTPS로 5~60초 주기로 값을 전송합니다. 각 측정은 DB 이벤트와 서명된 블록체인 원장에 기록되고, 열린 SSE 화면으로 즉시 전파됩니다.

```http
POST /api/iot/ingest/sensors
X-Device-Key: glk_발급받은키
Content-Type: application/json

{"temperature":24.6,"humidity":68,"light":12400,"co2":720,"soilMoisture":54,"ph":6.2,"ec":1.8}
```

온도(-30~70℃), 습도(0~100%), pH(0~14) 등 값 범위를 서버에서 검증합니다.

시연용 가상 센서는 다음처럼 실행할 수 있습니다.

```powershell
$env:IOT_DEVICE_KEY="glk_발급받은키"
npm.cmd run iot:simulator
```

## 3. 온·습도 제어 장비

농장 소유자 또는 관리자가 제어 명령을 생성하면 컨트롤러가 폴링하여 실행한 뒤 ACK를 보냅니다. 이 방식은 서버가 릴레이를 직접 노출하지 않아 오작동과 무단 제어를 줄입니다.

```http
POST /api/containers/a-01/climate/commands
Cookie: green_link_session=<owner-or-admin-session>
X-Green-Link-Request: 1
Content-Type: application/json

{"targetTemperature":23,"targetHumidity":65,"mode":"auto","fan":true}
```

컨트롤러 폴링:

```http
GET /api/iot/commands/pending
X-Device-Key: glk_컨트롤러키
```

실행 완료 ACK:

```http
POST /api/iot/commands/<command-id>/ack
X-Device-Key: glk_컨트롤러키
Content-Type: application/json

{"success":true,"message":"cooling relay enabled"}
```

## 4. CCTV

브라우저는 RTSP를 직접 재생할 수 없으므로 카메라 게이트웨이(Nginx/MediaMTX 등)가 RTSP를 HLS `.m3u8` 또는 WebRTC로 변환해야 합니다. 현재 백엔드는 브라우저용 HLS URL을 등록·조회합니다.

```http
PUT /api/admin/cameras/a-01
Cookie: green_link_session=<admin-session>
X-Green-Link-Request: 1
Content-Type: application/json

{"hlsUrl":"https://camera.example.com/a-01/index.m3u8","status":"online"}
```

`GET /api/containers/a-01/camera`로 등록된 스트림 정보를 가져옵니다. 공개 배포에서는 반드시 HTTPS, 카메라 전용 네트워크/VPN, 짧은 만료의 서명 URL을 사용하세요.

## 5. 실시간 웹 연결

웹 또는 모바일 클라이언트는 먼저 60초짜리 일회성 SSE 티켓을 발급받는다. 브라우저 `EventSource`의 장시간 연결 권한을 일반 로그인 세션과 분리하고 특정 컨테이너에 한 번만 사용하도록 별도 티켓을 사용한다.

```http
POST /api/containers/a-01/live-ticket
Cookie: green_link_session=<user-session>
X-Green-Link-Request: 1
```

응답의 티켓으로 아래 SSE를 열면 `snapshot`, `sensor`, `control_command`, `control_ack` 이벤트를 받습니다. 티켓은 한 번 사용하면 폐기됩니다.

```http
GET /api/containers/a-01/live?ticket=<one-time-ticket>
Accept: text/event-stream
```

## 운영 보안 체크리스트

- 인터넷 공개 환경에서는 TLS(HTTPS)와 역프록시를 필수로 사용합니다.
- `BLOCKCHAIN_SIGNING_KEY`를 환경변수의 충분히 긴 랜덤 값으로 교체합니다.
- 장비 키는 장비별로 분리하고, 분실 시 새 키를 발급한 뒤 기존 장비를 비활성화합니다.
- 냉난방 제어기에는 물리적 안전한계, 수동 차단 스위치, 실패 시 안전 모드를 별도로 구현합니다.
