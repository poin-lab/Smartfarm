# GREEN LINK

GREEN LINK는 스마트팜 정보와 컨테이너 참여 토큰을 조회하고 내부 모의 크레딧으로 거래하는 웹 애플리케이션이다.

현재 핵심 범위는 일반 사용자 회원가입·로그인, 농장·컨테이너 조회, 농장주 발행 신청, 관리자 발행 승인, 내부 DB 기반 구매·판매, 지갑과 거래 원장이다. 실제 원화 결제, 법적 증권 상품화, 외부 증권사 연동은 별도 단계로 구분한다.

> 현재 토큰과 크레딧은 개발용이다. 농장 소유권, 증권, 배당, 수익권 또는 수익을 보장하지 않으며 실제 원화 결제가 아니다.

## 실행

요구사항:

```text
Node.js 22.5 이상
npm 10 이상
```

Windows 개발 모드에서는 [start-green-link.cmd](./start-green-link.cmd)를 더블클릭한다. 이 파일은 다음 작업을 순서대로 수행한다.

1. `.env`가 없으면 `.env.example`로 생성
2. `node_modules`가 없으면 `npm ci`
3. SQLite 생성·migration 실행
4. API와 React 개발 서버 실행

실행 후 접속:

```text
웹: http://localhost:5177
API: http://localhost:4100
상태: http://localhost:4100/api/health
```

같은 Wi-Fi의 스마트폰이나 다른 노트북에서 접속시키려면 [start-green-link-lan.cmd](./start-green-link-lan.cmd)를 사용한다. 이 스크립트는 React 앱을 build한 뒤 API 서버가 웹까지 한 포트에서 서빙한다.

```text
서버 PC: start-green-link-lan.cmd 실행
다른 기기: 터미널에 출력된 http://서버PC-IP:4100 주소로 접속
```

자세한 LAN 시연 방법은 [docs/LAN_ACCESS.md](./docs/LAN_ACCESS.md)를 참고한다.

같은 Wi-Fi가 아닌 외부 네트워크에서도 접속하게 하려면 [start-green-link-public.cmd](./start-green-link-public.cmd)를 사용한다. 실행 후 터미널에 출력되는 `https://...trycloudflare.com` 주소를 공유하면 된다. 자세한 내용은 [docs/PUBLIC_ACCESS.md](./docs/PUBLIC_ACCESS.md)를 참고한다.

수동 실행:

```powershell
Copy-Item .env.example .env
npm ci
npm run db:init
npm run dev
```

SQLite는 별도 DB 서버가 아니다. API 프로세스가 [smartfarm.sqlite](./server/data/smartfarm.sqlite)를 직접 열어 사용한다.

## 테스트 계정

개발 환경의 신규 DB에만 자동 생성한다.

| 구분             | 이메일                | 비밀번호     |
| ---------------- | --------------------- | ------------ |
| 일반 사용자      | `user@smartfarm.kr`   | `user1234`   |
| 농장주           | `farmer@smartfarm.kr` | `farmer1234` |
| 관리자 호환 계정 | `admin@smartfarm.kr`  | `admin1234`  |

운영 환경에서는 데모 계정을 생성하지 않는다. 기본 데이터에서 `farmer@smartfarm.kr`는 그린밸리 A팜 운영자이며, 최초 발행 물량은 관리자 계정이 아니라 농장주 지갑에 기록된다.

## 현재 기능

| 기능                             | 상태                    |
| -------------------------------- | ----------------------- |
| 일반 사용자 가입·로그인·로그아웃 | 구현                    |
| 프로필·비밀번호 변경             | 구현                    |
| 농장 지도·목록·상세              | 구현                    |
| 컨테이너 조회                    | 구현                    |
| 공개 매도 주문 구매              | 구현                    |
| 보유 토큰 판매·취소              | 구현                    |
| 모의 크레딧·보유량·거래 내역     | 구현                    |
| 농장주 발행 신청·관리자 승인     | 구현                    |
| canonical 주문·포지션·체결 원장  | 구현                    |
| 증권사·외부 거래 연동            | adapter 경계, 실연동 전 |
| 관리자 운영 화면                 | 기존 데모, 후순위       |
| 실제 IoT·퍼블릭 체인             | 선택 기능, 후순위       |

## 문서

전체 문서 목차는 [docs/README.md](./docs/README.md)를 기준으로 한다.

| 문서                                                  | 내용                                             |
| ----------------------------------------------------- | ------------------------------------------------ |
| [기능 구조](./docs/FEATURES.md)                       | 화면별 기능, 호출 API, 데이터 흐름, 구현 상태    |
| [API 기준](./docs/API.md)                             | 현재 endpoint와 인증·입출력                      |
| [현재 DB](./docs/DATABASE.md)                         | 실제 SQLite 테이블, 관계, 트랜잭션, 한계         |
| [LAN 접속](./docs/LAN_ACCESS.md)                      | 서버 PC 한 대에서 스마트폰·노트북 접속시키는 법  |
| [외부 접속](./docs/PUBLIC_ACCESS.md)                  | 다른 와이파이·모바일 데이터에서도 접속시키는 법  |
| [외부 거래 연동](./docs/EXTERNAL_TRADING.md)          | 내부 DB에서 증권사·외부 provider로 확장하는 방법 |
| [일반 사용자 인증](./USER_AUTH_DESIGN.md)             | 회원가입, 쿠키 세션, 비밀번호                    |
| [토큰시장 목표 구조](./DATABASE_BLOCKCHAIN_DESIGN.md) | 농장주 발행, 주문·체결·원장, 체인 목표           |
| [IoT 연동](./docs/IOT_INTEGRATION.md)                 | 센서·제어기·카메라                               |
| [퍼블릭 체인](./docs/PUBLIC_CHAIN.md)                 | 선택형 EVM 연동                                  |

## 현재 구조

```text
React 웹
   │ REST / SSE
Express API
   ├─ 사용자·세션
   ├─ 농장·컨테이너
   ├─ 주문·구매·판매·지갑
   ├─ 선택형 관리자·IoT·체인
   └─ SQLite
        ├─ users / sessions
        ├─ farms / containers
        ├─ container_tokens / token_positions
        ├─ token_orders / holdings / orders
        ├─ token_executions / settlements
        ├─ credit_ledger_entries / token_ledger_entries
        └─ audit / IoT / chain support tables
```

내부 구매 한 건은 조건부 주문 수량 감소, 구매자·판매자 모의 잔액, 구매자 보유량, canonical 주문, 체결, 결제, 크레딧·토큰 원장, 포지션과 감사 기록을 한 SQLite 트랜잭션으로 반영한다. 같은 구매 또는 판매 요청을 재전송할 때는 idempotency key로 중복 처리를 막는다.

## 향후 외부 연동

외부 증권사나 거래 시스템에는 DB를 직접 공개하지 않는다.

```text
현재: 웹 → API → InternalTradingProvider → SQLite
향후: 웹 → API → BrokerTradingProvider → 외부 API
                                      └→ 체결 결과를 로컬 DB에 동기화
```

외부 연동 전 주문, 체결, 결제, 원장, 포지션을 내부 모델에서 먼저 분리한다. 상세 기준은 [외부 거래 연동 문서](./docs/EXTERNAL_TRADING.md)에 있다.

## 환경변수

| 변수                     | 기본값·설명                                 |
| ------------------------ | ------------------------------------------- |
| `HOST`                   | `0.0.0.0`                                   |
| `PORT`                   | `4100`                                      |
| `SMARTFARM_DB`           | 기본 `server/data/smartfarm.sqlite`         |
| `LOGIN_ACCOUNT_SOURCE`   | 기본·운영 필수 `database`                   |
| `SESSION_HOURS`          | 기본 12시간                                 |
| `TRUST_PROXY`            | 신뢰하는 역방향 프록시 바로 뒤에서만 `true` |
| `BLOCKCHAIN_SIGNING_KEY` | production에서 32자 이상 필요               |
| `PAYMENT_PROVIDER`       | 현재 `mock`만 사용                          |

퍼블릭 체인 환경변수는 [PUBLIC_CHAIN.md](./docs/PUBLIC_CHAIN.md)를 참고한다.

## 검증

```powershell
npm run lint
npm run typecheck
npm test
npm run build
npm run check
```

검증 명령은 Windows PowerShell 기준으로 확인한다.
