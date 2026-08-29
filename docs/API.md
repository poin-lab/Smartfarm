# GREEN LINK API 기준

이 문서는 현재 `server/app.js`에 구현된 `/api` endpoint를 기능별로 정리한다.

## 1. 공통 규칙

### 주소와 형식

```text
개발 API: http://localhost:4100/api
웹 개발 서버: http://localhost:5177
Content-Type: application/json
```

### 인증

- 브라우저: `green_link_session` HttpOnly 쿠키
- production HTTPS: `__Host-green_link_session` Secure 쿠키
- 테스트 호환: `Authorization: Bearer <raw-session-token>`
- 장비: `X-Device-Key: <device-key>`

쿠키로 인증하는 `POST`, `PATCH`, `PUT`, `DELETE` 요청에는 다음 헤더가 필요하다.

```http
X-Green-Link-Request: 1
```

구매, 판매 등록, `/trading/orders` 요청은 선택적으로 `Idempotency-Key` 헤더 또는 본문 `idempotencyKey`를 받을 수 있다. 같은 사용자·같은 작업 범위에서 같은 키가 다시 오면 처음 처리한 응답을 돌려주고 수량과 잔액을 중복 변경하지 않는다.

### 권한 표기

| 표기   | 의미                            |
| ------ | ------------------------------- |
| 공개   | 로그인 없이 호출                |
| 사용자 | 로그인 필요                     |
| 소유자 | 해당 농장 소유자 또는 관리자    |
| 관리자 | `role=admin` 필요               |
| 장비   | 올바른 장비 키와 장비 유형 필요 |

### 주요 오류

| 상태 | 의미                                 |
| ---- | ------------------------------------ |
| 400  | 입력값 오류                          |
| 401  | 로그인 실패·세션 만료·장비 인증 실패 |
| 402  | 모의 크레딧 부족                     |
| 403  | CSRF 헤더·소유권·관리자 권한 오류    |
| 404  | 대상 없음                            |
| 409  | 중복·자기 주문 구매·상태 충돌        |
| 422  | 외부 체인 영수증 검증 실패           |
| 429  | 요청 제한 초과                       |

## 2. 상태 확인

| Method | 경로                   | 권한 | 기능                                |
| ------ | ---------------------- | ---- | ----------------------------------- |
| GET    | `/health`              | 공개 | SQLite 무결성과 사설 원장 검증 상태 |
| GET    | `/public-chain/status` | 공개 | 퍼블릭 체인 설정·활성 상태          |

## 3. 사용자·로그인

| Method | 경로                   | 권한   | 입력·결과                                                      |
| ------ | ---------------------- | ------ | -------------------------------------------------------------- |
| POST   | `/auth/signup`         | 공개   | 이름, 이메일, 연락처, 비밀번호로 일반 사용자 생성 및 쿠키 설정 |
| POST   | `/auth/login`          | 공개   | 이메일·비밀번호 확인 후 쿠키 설정                              |
| POST   | `/auth/logout`         | 사용자 | 현재 세션 삭제와 쿠키 만료                                     |
| GET    | `/me`                  | 사용자 | 공개 사용자 정보 조회                                          |
| PATCH  | `/me`                  | 사용자 | 이름·연락처 수정                                               |
| PATCH  | `/me/password`         | 사용자 | 현재·새 비밀번호로 변경, 다른 세션 폐기                        |
| POST   | `/me/wallet/challenge` | 사용자 | EVM 지갑 연결용 일회성 서명 메시지 발급                        |
| POST   | `/me/wallet/verify`    | 사용자 | 주소·서명 확인 후 대표 지갑 연결                               |

회원가입 입력:

```json
{
  "name": "김사용자",
  "email": "user@example.com",
  "phone": "010-0000-0000",
  "password": "12345678"
}
```

로그인·회원가입 응답에는 원문 세션 토큰이 없다. 브라우저가 `Set-Cookie`를 처리한다.

## 4. 농장·컨테이너 공개 조회

| Method | 경로                             | 권한   | Query         | 기능                                |
| ------ | -------------------------------- | ------ | ------------- | ----------------------------------- |
| GET    | `/farms`                         | 공개   | `q`, `status` | 농장 검색, 컨테이너 수 포함         |
| GET    | `/farms/:id`                     | 공개   | -             | 농장과 소속 컨테이너 조회           |
| GET    | `/containers`                    | 공개   | `q`, `farmId` | 컨테이너 검색                       |
| GET    | `/containers/:id`                | 공개   | -             | 농장·랙 문구를 포함한 컨테이너 상세 |
| POST   | `/containers/:id/token-requests` | 소유자 | -             | 농장주 토큰 발행 신청               |
| GET    | `/containers/:id/sensors`        | 공개   | -             | 최신 센서 상태와 짧은 온도 이력     |
| GET    | `/orders`                        | 공개   | `q`           | `판매중` 매도 주문과 컨테이너 정보  |

## 5. 내부 거래·지갑

| Method | 경로                   | 권한   | 입력                                                      | 기능                                                         |
| ------ | ---------------------- | ------ | --------------------------------------------------------- | ------------------------------------------------------------ |
| POST   | `/orders/:id/purchase` | 사용자 | `quantity`, 선택 `idempotencyKey`                         | 공개 매도 주문 구매                                          |
| POST   | `/orders`              | 사용자 | `tokenId`, `quantity`, `unitPrice`, 선택 `idempotencyKey` | 보유 토큰 판매 등록                                          |
| POST   | `/orders/:id/cancel`   | 사용자 | -                                                         | 본인의 판매중 주문 취소                                      |
| GET    | `/wallet`              | 사용자 | -                                                         | 사용 가능 보유량, 판매 중 주문, 포지션, 모의 잔액, 거래 내역 |
| GET    | `/dashboard`           | 사용자 | -                                                         | 대시보드용 지갑·주문·농장 집계                               |

기존 화면 호환용 `/orders` API는 내부적으로 `InternalTradingProvider`를 호출한다. 거래 기준 데이터는 `token_orders`, `token_positions`, `token_executions`, `settlements`, `credit_ledger_entries`, `token_ledger_entries`에 함께 기록된다.

표준 거래 API:

| Method | 경로                                  | 권한   | 입력·Query                                               | 기능                                  |
| ------ | ------------------------------------- | ------ | -------------------------------------------------------- | ------------------------------------- |
| GET    | `/trading/provider`                   | 사용자 | -                                                        | 내부 provider와 외부 broker 경계 상태 |
| GET    | `/trading/instruments`                | 사용자 | -                                                        | 컨테이너 토큰 상품 목록               |
| GET    | `/trading/instruments/:tokenId/quote` | 사용자 | -                                                        | 초기 가격, 최저 매도, 최고 매수, VWAP |
| GET    | `/trading/positions`                  | 사용자 | -                                                        | 내 available/reserved/settled 포지션  |
| GET    | `/trading/orders`                     | 사용자 | `tokenId`, 관리자 선택 `all=1`                           | canonical 주문 목록                   |
| POST   | `/trading/orders`                     | 사용자 | `side`, `orderType`, `tokenId`, `quantity`, `limitPrice` | BUY/SELL 주문 생성 또는 즉시 체결     |
| GET    | `/trading/orders/:id`                 | 사용자 | -                                                        | 주문 단건 조회                        |
| POST   | `/trading/orders/:id/cancel`          | 사용자 | -                                                        | open/pending 주문 취소                |
| GET    | `/trading/executions`                 | 사용자 | `tokenId`, 관리자 선택 `all=1`                           | 체결 내역 조회                        |

구매 입력:

```json
{ "quantity": 1 }
```

판매 입력:

```json
{
  "tokenId": "SFC-A01",
  "quantity": 1,
  "unitPrice": 125000
}
```

현재 구매는 내부 DB의 모의 크레딧을 사용한다. 실제 원화 결제가 아니다. 체결 결과는 `token_executions`, T+0 완료 상태는 `settlements`, 금액·토큰 증감은 각 ledger table에 남긴다.

농장주 발행 신청 입력:

```json
{
  "supply": 10,
  "price": 77000,
  "terms": { "farmerMemo": "초기 발행 조건" }
}
```

## 6. 실시간·카메라·제어

| Method | 경로                               | 권한        | 기능                                 |
| ------ | ---------------------------------- | ----------- | ------------------------------------ |
| POST   | `/containers/:id/live-ticket`      | 사용자      | 60초·1회용 SSE 티켓 발급             |
| GET    | `/containers/:id/live?ticket=...`  | 티켓/사용자 | snapshot·sensor·control event stream |
| GET    | `/containers/:id/camera`           | 사용자      | HLS 카메라 주소와 상태 조회          |
| POST   | `/containers/:id/climate/commands` | 소유자      | 목표 온도·습도·모드·팬 명령 생성     |

## 7. 장비 API

| Method | 경로                    | 장비 유형  | 기능                     |
| ------ | ----------------------- | ---------- | ------------------------ |
| POST   | `/iot/ingest/sensors`   | sensor     | 센서 측정 전송           |
| GET    | `/iot/commands/pending` | controller | 대기 제어 명령 조회      |
| POST   | `/iot/commands/:id/ack` | controller | 실행 성공·실패 결과 전송 |

장비 키는 관리자 장비 생성 시 한 번만 응답하고 DB에는 해시만 저장한다.

## 8. 사설·퍼블릭 체인

| Method | 경로                                 | 권한   | 기능                                           |
| ------ | ------------------------------------ | ------ | ---------------------------------------------- |
| GET    | `/blockchain/verify`                 | 사용자 | HMAC 사설 원장 전체 검증                       |
| GET    | `/blockchain/blocks?limit=30`        | 관리자 | 최근 사설 원장 블록                            |
| GET    | `/public-chain/operations?limit=30`  | 관리자 | 퍼블릭 체인 outbox 상태                        |
| POST   | `/public-chain/marketplace/confirm`  | 사용자 | 본인이 제출한 marketplace tx receipt 검증·기록 |
| POST   | `/admin/public-chain/process-next`   | 관리자 | 다음 outbox 작업 수동 처리                     |
| POST   | `/admin/public-chain/sensor-batches` | 관리자 | 미기록 센서 이벤트 Merkle batch 생성           |

## 9. 관리자 API

관리자 기능은 코드에 존재하지만 현재 일반 사용자 기능 개발보다 후순위다.

| Method | 경로                                 | 기능                                                             |
| ------ | ------------------------------------ | ---------------------------------------------------------------- |
| POST   | `/admin/iot/devices`                 | 장비 생성, 원문 장비 키 1회 반환                                 |
| GET    | `/admin/iot/devices`                 | 장비 목록                                                        |
| GET    | `/admin/summary`                     | 농장·컨테이너·토큰·장비·명령·원장 집계                           |
| GET    | `/admin/control-commands`            | 최근 제어 명령                                                   |
| PUT    | `/admin/cameras/:containerId`        | HLS 카메라 등록·수정                                             |
| POST   | `/admin/farms`                       | 농장 등록                                                        |
| POST   | `/admin/containers`                  | 컨테이너 등록                                                    |
| PATCH  | `/admin/containers/:id/content`      | 컨테이너 설명·랙 문구 수정                                       |
| GET    | `/admin/token-requests`              | 농장주 발행 신청 목록 조회                                       |
| POST   | `/admin/tokens`                      | 컨테이너 토큰 발행 승인, 발행 물량을 농장 운영자 보유량으로 기록 |
| POST   | `/admin/tokens/:containerId/approve` | 농장주 신청값으로 토큰 발행 승인                                 |
| PATCH  | `/admin/sensors/:containerId`        | 데모 센서값 수정                                                 |

## 10. 외부 거래 연동

`/api/trading/*` endpoint는 현재 내부 DB provider에 연결되어 있다. `BrokerTradingProvider`는 adapter 경계만 있으며 실제 외부 주문 제출은 연결하지 않았다. 외부 증권사·거래 플랫폼을 붙일 때는 `external_order_id`, `external_execution_id`, webhook 서명, reconciliation, 법률·상품성 검토가 필요하다.

내부·외부 provider 전환 기준은 [EXTERNAL_TRADING.md](./EXTERNAL_TRADING.md)에 정의한다.
