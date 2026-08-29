# GREEN LINK 기능 구조

## 1. 현재 서비스 형태

GREEN LINK는 현재 한 개의 Express API와 한 개의 SQLite DB로 동작하는 내부 거래 데모다.

```text
React 웹
  └─ /api 호출
       └─ Express API
            ├─ 사용자·세션
            ├─ 농장·컨테이너 조회
            ├─ 내부 주문·체결·지갑
            ├─ 선택형 IoT·관리 기능
            └─ SQLite 단일 트랜잭션
```

브라우저는 API 응답을 직접 조합하지 않고 화면별 endpoint에서 필요한 데이터를 가져온다. 모든 변경 요청은 JSON과 `X-Green-Link-Request: 1` 헤더를 사용한다.

## 2. 구현 상태

| 영역                        | 상태      | 설명                                                              |
| --------------------------- | --------- | ----------------------------------------------------------------- |
| 일반 사용자 회원가입·로그인 | 구현      | DB 계정, HttpOnly 쿠키 세션, 로그아웃                             |
| 프로필·비밀번호             | 구현      | 이름·연락처 수정, 현재 비밀번호 확인 후 변경                      |
| 농장·컨테이너 조회          | 구현      | 목록, 지도 좌표, 상세, 재배 정보                                  |
| 내부 모의 거래              | 구현      | 공개 매도 목록, 수량 구매, 사용자 판매, 취소, 체결·결제·원장      |
| 지갑·대시보드               | 구현      | 사용 가능 수량, 판매 예약 수량, 모의 크레딧, 주문, 거래 내역 집계 |
| 농장주 발행 모델            | 구현      | 농장주 신청, 관리자 승인, 농장주 최초 포지션·ISSUE 원장 기록      |
| canonical 거래 API          | 구현      | `/api/trading/*`, `token_orders`, `token_positions`, quote 제공   |
| 증권사·외부 거래 연동       | 경계 설계 | `BrokerTradingProvider`는 adapter 경계만 있고 실제 연결 없음      |
| 관리자 운영                 | 기존 데모 | 농장·컨테이너·장비·카메라·토큰 관리가 있으나 현재 우선 범위 아님  |
| 센서·제어·카메라            | 선택 기능 | API는 있으나 실제 장비 연결은 후순위                              |
| 퍼블릭 체인                 | 선택 기능 | 설정이 없으면 비활성. 내부 DB 거래와 별도                         |

## 3. 사용자·로그인

### 포함 기능

- 일반 사용자 회원가입
- 이메일·비밀번호 로그인
- 쿠키 세션 확인과 로그아웃
- 이름·연락처 수정
- 비밀번호 변경
- 비활성 사용자 접근 거부

### 화면과 호출

| 사용자 행동   | API                      | 읽거나 변경하는 데이터            |
| ------------- | ------------------------ | --------------------------------- |
| 앱 시작       | `GET /api/me`            | `sessions`, `users`               |
| 회원가입      | `POST /api/auth/signup`  | `users`, `sessions`, `audit_logs` |
| 로그인        | `POST /api/auth/login`   | `users`, `sessions`, `audit_logs` |
| 로그아웃      | `POST /api/auth/logout`  | `sessions`, `audit_logs`          |
| 프로필 저장   | `PATCH /api/me`          | `users`, `audit_logs`             |
| 비밀번호 변경 | `PATCH /api/me/password` | `users`, `sessions`, `audit_logs` |

### 호출 흐름

```text
로그인 폼
  → DB 사용자 비밀번호 확인
  → 무작위 세션 발급
  → DB에는 세션 해시만 저장
  → 브라우저에는 HttpOnly 쿠키 설정
  → 이후 /api/me로 사용자 복구
```

## 4. 농장·컨테이너

### 포함 기능

- 농장 검색과 상태 필터
- 지도 좌표 표시
- 농장별 컨테이너 목록
- 컨테이너 작물·상태·설명·재배 일정
- 컨테이너별 토큰 표시 정보
- 선택형 센서·카메라 정보

### 화면과 호출

| 화면              | API                                       | 주요 테이블                                                         |
| ----------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| 농장 지도         | `GET /api/farms`                          | `farms`, `containers`                                               |
| 내 농장/농장 목록 | `GET /api/farms`                          | `farms`, `containers`                                               |
| 농장 상세         | `GET /api/farms/:id`                      | `farms`, `containers`                                               |
| 컨테이너 검색     | `GET /api/containers`                     | `containers`, `farms`                                               |
| 컨테이너 상세     | `GET /api/containers/:id`                 | `containers`, `farms`, `container_page_content`, `container_tokens` |
| 발행 신청         | `POST /api/containers/:id/token-requests` | `container_tokens`, `audit_logs`                                    |
| 환경 데이터       | `GET /api/containers/:id/sensors`         | `sensor_readings`                                                   |
| 카메라            | `GET /api/containers/:id/camera`          | `camera_streams`                                                    |

기본 데이터에서 일반 사용자는 투자자, `farmer@smartfarm.kr`는 그린밸리 A팜 운영자다. 농장주는 자기 농장 컨테이너에서만 토큰 발행을 신청하고 환경 제어 명령을 만들 수 있다.

## 5. 내부 거래시장

### 현재 거래 방식

현재 화면은 판매자가 가격과 수량을 등록하고 구매자가 공개 매도 주문 하나를 선택하는 매물형 시장이다. 내부에는 `token_orders` BUY/SELL 주문 모델과 quote API가 있어 지정가 매수 주문을 열어둘 수 있다.

```text
판매자 판매 등록
  → 판매 가능 보유량 차감
  → 판매 예약 원장 기록
  → orders에 판매중 주문 생성

구매자 구매
  → 주문과 잔액 확인, 조건부 주문 수량 감소
  → 구매자 크레딧 차감 / 판매자 크레딧 증가
  → 구매자 holdings 증가
  → 구매자·판매자 token_positions 갱신
  → token_orders BUY/SELL 상태 갱신
  → 주문 잔여 수량 감소
  → token_executions와 settlements 생성
  → transactions, credit/token ledger, 감사 원장 기록
```

마지막 수량이 구매되면 `orders.quantity=0`, `status=거래완료`가 된다.
같은 구매·판매 요청이 네트워크 재전송될 때는 idempotency key로 중복 처리를 막는다.

### 화면과 호출

| 사용자 행동    | API                             | 주요 테이블                                                                     |
| -------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| 판매 주문 조회 | `GET /api/orders`               | `orders`, `containers`                                                          |
| 주문 구매      | `POST /api/orders/:id/purchase` | `orders`, `users`, `holdings`, `token_executions`, `settlements`, ledger        |
| 보유 토큰 판매 | `POST /api/orders`              | `holdings`, `orders`, `token_orders`, `token_positions`, `token_ledger_entries` |
| 내 판매 취소   | `POST /api/orders/:id/cancel`   | `orders`, `holdings`, `token_orders`, `token_positions`, 원장                   |
| 표준 거래 API  | `/api/trading/*`                | `token_orders`, `token_positions`, `token_executions`                           |

### 한 구매에서 함께 처리되는 항목

다음 변경은 한 SQLite 트랜잭션에서 전부 성공하거나 전부 롤백된다.

1. 주문 잔여 수량 확인·감소
2. 구매자 모의 크레딧 차감
3. 판매자 모의 크레딧 증가
4. 구매자 보유량 증가
5. 체결과 T+0 결제 상태 생성
6. 크레딧·토큰 원장 기록
7. BUY/SELL canonical 주문과 포지션 갱신
8. 거래 내역 생성
9. 감사·사설 원장 기록

### 현재 한계

- 현재 화면 호환을 위해 `orders.quantity`는 아직 남은 수량 이름으로 유지한다.
- `orders`와 `holdings`는 화면 호환 projection이며 정식 주문·포지션은 `token_orders`, `token_positions`에 저장한다.
- `transactions`는 화면용 내역이며 주문·상대·결제 근거는 체결·결제·원장 테이블을 기준으로 한다.
- 모의 크레딧은 ledger를 기록하지만 조회용 캐시로 `users.credit_balance`도 함께 유지한다.
- 개발용 모의 크레딧만 차감하며 실제 원화 결제·투자 수익·배당을 처리하지 않는다.

## 6. 지갑과 대시보드

| 화면     | API                  | 응답 내용                                                                 |
| -------- | -------------------- | ------------------------------------------------------------------------- |
| 대시보드 | `GET /api/dashboard` | 모의 잔액, 보유 평가액, 판매 주문, 최근 거래, 농장·컨테이너 수            |
| 내 지갑  | `GET /api/wallet`    | 사용 가능 보유량, 판매 중 주문·수량, 포지션, 거래 내역, 총수량, 모의 잔액 |

평가액은 현재 보유 수량과 컨테이너의 표시 가격을 이용한 화면용 값이다. 실제 금융자산 평가나 정산 금액이 아니다.

## 7. 증권사형 구조와 향후 연동

현재 GREEN LINK 서버는 증권사 주문관리, 거래소 체결, 내부 결제를 한 프로세스에서 축소 수행한다.

```text
현재: 웹 → 내부 DB 거래
향후: 웹 → TradingProvider → 내부 DB 또는 외부 증권사 API
```

외부 연동 시 DB를 공개하지 않는다. `placeOrder`, `cancelOrder`, `getOrder`, `getExecutions`, `getPositions` 같은 provider 인터페이스와 API·webhook으로 연결한다. 자세한 내용은 [EXTERNAL_TRADING.md](./EXTERNAL_TRADING.md)를 따른다.

## 8. 관리자·IoT·체인

현재 코드에는 관리자와 IoT, 퍼블릭 체인 API가 존재한다. 실제 장비·실체인 운영은 내부 거래 안정화 이후 선택 적용 범위다.

- 관리자: 농장, 컨테이너, 화면 문구, 장비, 카메라, 토큰 표시값
- IoT: 센서 수신, 제어 명령, ACK, SSE
- 사설 원장: 주요 이벤트 HMAC 해시 체인
- 퍼블릭 체인: ERC-1155, marketplace receipt 확인, sensor root anchor

세부 내용은 [IOT_INTEGRATION.md](./IOT_INTEGRATION.md)와 [PUBLIC_CHAIN.md](./PUBLIC_CHAIN.md)를 참고한다.
