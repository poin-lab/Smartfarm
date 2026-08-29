# GREEN LINK 외부 거래·증권사 연동 구조

## 1. 결론

현재는 GREEN LINK SQLite에서 주문·체결·보유량을 처리한다. 향후 실제 증권사나 외부 거래 플랫폼이 필요하면 DB를 직접 연결하지 않고 `TradingProvider`와 API로 교체·연동한다.

```text
현재
GREEN LINK 웹 → GREEN LINK API → InternalTradingProvider → SQLite

향후
GREEN LINK 웹 → GREEN LINK API → BrokerTradingProvider → 증권사/외부 거래 API
                                      ↓
                                webhook·체결 동기화
                                      ↓
                             GREEN LINK 조회용 DB
```

## 2. 먼저 구분할 두 가지 연동

### A. GREEN LINK가 외부 증권사 상품을 불러오는 경우

외부 시스템이 주문·체결·잔고의 원본이다.

```text
외부 상품·시세 조회
→ GREEN LINK 화면 표시
→ 사용자가 GREEN LINK에서 주문
→ 외부 증권사에 주문 전달
→ 외부 주문번호 저장
→ 체결 webhook 또는 polling 수신
→ 우리 DB projection 갱신
```

이 모드에서 우리 DB가 임의로 외부 보유량이나 체결을 확정하면 안 된다.

### B. 증권사가 GREEN LINK 상품을 불러가는 경우

GREEN LINK가 상품·내부 거래의 원본이고 증권사가 우리 공개 API를 호출한다.

```text
증권사 시스템
→ GREEN LINK 상품 API
→ 주문 API
→ GREEN LINK 내부 체결
→ 체결·잔고 API 또는 webhook으로 증권사에 통보
```

이 경우에도 증권사에 SQLite 파일이나 SQL 계정을 제공하지 않는다. 인증된 partner API만 제공한다.

실제로 어떤 방향을 사용할지는 해당 토큰이 외부 사업자에서 취급 가능한 상품인지, 누가 거래·결제 원장을 책임지는지 계약과 법률 검토 후 정한다.

## 3. Provider 경계

애플리케이션의 거래 route는 SQLite SQL을 직접 처리하지 않고 `InternalTradingProvider`를 호출한다. 외부 거래는 같은 경계 뒤에 adapter를 추가한다.

```ts
type TradingProvider = {
  listInstruments(input): Promise<Instrument[]>;
  getQuote(input): Promise<Quote>;
  placeOrder(input): Promise<Order>;
  cancelOrder(input): Promise<Order>;
  getOrder(input): Promise<Order>;
  listOrders(input): Promise<Order[]>;
  listExecutions(input): Promise<Execution[]>;
  listPositions(input): Promise<Position[]>;
};
```

구현체:

```text
InternalTradingProvider
  현재 SQLite 주문·구매·판매·체결·정산·포지션 원본

BrokerTradingProvider
  향후 특정 증권사 REST/FIX/OpenAPI adapter, 현재는 연결되지 않은 경계

MockTradingProvider
  외부 연결 없이 UI·테스트용
```

특정 증권사의 필드명과 상태 코드는 adapter 안에서 GREEN LINK 표준 모델로 변환한다.

## 4. GREEN LINK 표준 거래 모델

### Instrument

```text
id
symbol
name
asset_type
issuer_id
currency
execution_venue
status
```

### Order

```text
id
user_id
instrument_id
side                 BUY / SELL
order_type           MARKET / LIMIT
limit_price
original_quantity
remaining_quantity
status               PENDING / OPEN / PARTIALLY_FILLED / FILLED / CANCELLED / REJECTED
provider
external_account_id
external_order_id
idempotency_key
created_at
updated_at
```

### Execution

```text
id
order_id
instrument_id
buyer_id
seller_id
quantity
unit_price
provider
external_execution_id
executed_at
```

체결은 생성 후 수정하지 않는다. 외부 정정·취소는 기존 행을 덮어쓰지 않고 reversal/correction 이벤트를 추가한다.

### Settlement

```text
id
execution_id
cash_status
asset_status
status               PENDING / CONFIRMED / FAILED / REVERSED
provider
external_settlement_id
settled_at
```

### Position

```text
user_id
instrument_id
available_quantity
reserved_quantity
unsettled_quantity
settled_quantity
updated_at
```

## 5. 원본 데이터 규칙

| 실행 장소      | 주문·체결 원본         | 보유량 원본      | 우리 DB 역할                        |
| -------------- | ---------------------- | ---------------- | ----------------------------------- |
| `INTERNAL`     | GREEN LINK DB          | GREEN LINK 원장  | 원본과 조회                         |
| `BROKER`       | 외부 증권사            | 외부 계좌·포지션 | ID 매핑, 상태 projection, 화면 캐시 |
| `PUBLIC_CHAIN` | 확정된 컨트랙트 이벤트 | 온체인 balance   | outbox, index, 화면 cache           |

한 주문에는 하나의 `execution_venue`만 사용한다. 내부 DB에서 체결한 주문을 외부에서도 다시 체결하지 않는다.

## 6. 주문 호출 흐름

### 내부 DB 모드

```text
POST /trading/orders
→ 사용자·입력 검증
→ InternalTradingProvider
→ 잔액/보유량 예약
→ 내부 주문 생성 또는 즉시 체결
→ execution·ledger·position 동시 저장
→ 응답
```

### 외부 증권사 모드

```text
POST /trading/orders
→ 사용자와 외부 계좌 연결 확인
→ idempotency key 저장
→ 로컬 주문 PENDING 생성
→ BrokerTradingProvider.placeOrder
→ external_order_id 저장
→ OPEN/REJECTED 반영
→ webhook 또는 polling으로 부분·전체 체결 반영
```

외부 API timeout은 주문 실패와 같지 않다. timeout 후 같은 주문을 새로 보내기 전에 idempotency key 또는 외부 주문 조회로 접수 여부를 확인한다.

## 7. 외부에서 불러오는 데이터

| 데이터    | 방식                                | 우리 DB 저장                          |
| --------- | ----------------------------------- | ------------------------------------- |
| 상품 목록 | 주기 동기화 또는 요청 시 조회       | 외부 ID, symbol, 상태 projection      |
| 현재 시세 | streaming/websocket 또는 짧은 cache | 필요 시 최근 snapshot                 |
| 주문 상태 | 주문 API 응답 + 조회                | 로컬 주문과 external order ID 매핑    |
| 체결      | webhook 우선, polling 보완          | external execution ID UNIQUE          |
| 포지션    | 주기 조회와 reconciliation          | 화면용 projection, 마지막 동기화 시각 |
| 계좌 잔고 | 요청 시 조회 또는 주기 동기화       | 민감정보 최소화, 화면용 값            |

원본 응답 전체를 무기한 저장하지 않는다. 장애 분석에 필요한 최소 payload만 암호화·보존 정책과 함께 관리한다.

## 8. 우리가 외부에 제공할 데이터

증권사가 GREEN LINK 상품을 가져가는 방향이면 다음 partner API가 필요하다.

```text
GET  /partner/v1/instruments
GET  /partner/v1/instruments/:id/quote
POST /partner/v1/orders
POST /partner/v1/orders/:id/cancel
GET  /partner/v1/orders/:id
GET  /partner/v1/executions
GET  /partner/v1/positions/:accountId
```

필수 운영 조건:

- partner별 OAuth2 client credential 또는 mTLS
- request signature와 timestamp
- idempotency key
- IP 제한과 rate limit
- 주문·체결 external ID 유일성
- webhook 서명과 재전송
- 모든 요청·응답의 audit ID
- 일별 주문·체결·잔고 reconciliation

## 9. 실패와 동기화

외부 연동에서는 DB 변경과 외부 요청을 하나의 트랜잭션으로 묶을 수 없다. 따라서 다음 상태를 명시한다.

```text
PENDING_SUBMISSION
SUBMITTED
PARTIALLY_FILLED
FILLED
CANCEL_PENDING
CANCELLED
REJECTED
SYNC_FAILED
```

처리 원칙:

1. 로컬 요청과 idempotency key를 먼저 저장한다.
2. 외부 API를 호출하고 external ID를 연결한다.
3. webhook은 external event ID로 중복 제거한다.
4. webhook이 누락될 수 있으므로 주기적으로 주문·체결을 대조한다.
5. 불일치는 자동 덮어쓰기보다 reconciliation 이력과 경보를 남긴다.
6. 외부 원본인 경우 외부 상태를 기준으로 로컬 projection을 복구한다.

## 10. 단계별 적용

### 1단계: 내부 거래 안정화 완료

- SQLite 내부 거래 유지
- 구매 오류와 트랜잭션 안정화
- API route에서 거래 SQL을 provider로 이동

### 2단계: 내부 원장 정리 완료

- order / execution / settlement 분리
- available / reserved position 분리
- 크레딧·토큰 ledger 추가
- idempotency key 추가

### 3단계: provider 도입 완료

- `InternalTradingProvider` 구현
- 기존 화면 호환 API와 `/api/trading/*` API가 provider 사용
- provider contract test 작성

### 4단계: 외부 sandbox 예정

- 한 사업자의 sandbox adapter 구현
- 상품·주문·체결·포지션 동기화
- webhook 서명, 재시도, reconciliation 검증

### 5단계: 운영 연동

- 상품 취급 가능 여부와 역할 계약 확정
- 개인정보·전자금융·자본시장 관련 법률 검토
- 장애 대응, 운영자 승인, 모니터링, 정산 보고 체계 구축

지금은 1~3단계가 내부 구현으로 들어간 상태다. 실제 외부 사업자 선택, 계좌 연결, webhook 서명, 일별 reconciliation, 법률·상품성 검토는 아직 연결하지 않았다.

## 11. 참고 자료

- [KRX 일반 투자자의 증권사 주문 제출 절차](https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T1.jsp)
- [KRX 회원사의 고객 위탁 호가 구조](https://global.krx.co.kr/contents/GLB/06/0602/0602010201/GLB0602010201T3.jsp)
- [KRX 청산 시스템의 거래 확인·상계·결제 의무 확정](https://global.krx.co.kr/contents/GLB/04/0402/0402040000/GLB0402040000.jsp)
- [FINRA Rule 4311: 계좌·주문·체결·장부 책임 구분](https://www.finra.org/rules-guidance/rulebooks/finra-rules/4311)
- [Investor.gov: 증권사 주문 라우팅과 체결 방식](https://www.investor.gov/introduction-investing/investing-basics/how-stock-markets-work/executing-order)
