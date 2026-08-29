# GREEN LINK 1.0.0-rc.2 검증 보고서

> 현재 기능과 실행 기준은 [README.md](./README.md)와 [docs/README.md](./docs/README.md)를 따른다.

## 2026-08-29 제출 전 보강

- 첨부 목표 구조에 맞춰 `container_tokens`, `token_executions`, `settlements`, `credit_ledger_entries`, `token_ledger_entries`, `idempotency_keys`를 migration 9로 추가
- migration 10으로 `token_positions`, `token_orders`를 추가하고 기존 매도 주문과 보유량을 농장주 발행 구조에 맞게 backfill
- `InternalTradingProvider`를 도입해 기존 `/api/orders`와 새 `/api/trading/*` API가 같은 주문·체결·정산·포지션 원장을 사용
- 농장주가 자기 컨테이너 토큰 발행을 신청하고 관리자가 신청값으로 승인하는 화면/API 추가
- `start-green-link-lan.cmd`와 `npm run start:lan`을 추가해 서버 PC 한 대가 SQLite 파일을 열고 다른 노트북·스마트폰은 LAN URL로 접속하는 단일 포트 구조 구성
- 구매 처리에 조건부 주문 수량 감소와 idempotency key를 적용해 마지막 수량 중복 구매와 재전송 중복 반영을 방지
- 구매 한 건마다 체결, T+0 결제, 구매자·판매자 크레딧 원장, 판매자 예약 토큰 차감, 구매자 토큰 증가 원장을 기록
- 관리자 토큰 발행은 발행 물량을 관리자가 아니라 해당 농장 운영자의 보유량, 포지션, ISSUE 원장에 반영
- 컨테이너 상세·거래소·지갑 화면에서 초기 참고가, 공개 매도 수량, 사용 가능 수량, 판매 예약 수량, 모의 크레딧 안내를 분리 표시
- 새 회귀 테스트를 추가해 API 28개 테스트가 통과하도록 검증 범위 확대

검증일: 2026-08-29 (Asia/Seoul)  
환경: Windows, Node.js 24.20.0, npm 11.19.0

## 주요 변경

- ERC-1155 컨테이너 이용/참여 토큰과 에스크로형 퍼블릭 거래소 Solidity 컨트랙트 추가
- 센서 원본은 SQLite에 유지하고 최대 500건의 결정적 Merkle root만 퍼블릭 체인에 anchor
- DB 변경과 체인 제출 사이의 transactional outbox, confirmation, 최대 5회 재시도 worker 추가
- EVM challenge 서명 기반 사용자 지갑 연결과 직접 지갑 서명형 판매·구매 UI 추가
- 퍼블릭 거래소 receipt의 대상 컨트랙트 및 이벤트 검증 후 내부 감사 원장에 transaction hash 연결
- Solidity 0.8.30/OpenZeppelin 5.4.0 고정 컴파일, 배포 스크립트, 테스트넷 운영 문서 추가

- 실행되지 않던 1세대 pages/components/mock/types 트리를 제거하고 실제 API 기반 앱만 유지
- OpenStreetMap/Leaflet lat/lng 지도와 provider 교체 경계 추가
- HLS.js 기반 카메라 재생 및 오류 상태 추가
- 관리자 장비 발급, 카메라 설정, 환경 제어, 장비 상태, 사설 원장 감사 UI 추가
- DB 기반 관리자/농장/컨테이너 지표로 하드코딩 통계 제거
- 모의 크레딧을 이용한 구매자 차감·판매자 적립을 단일 SQLite transaction으로 처리
- 토큰의 이용/참여 목적, 실제 결제 아님, 투자·수익권 아님을 UI/README에 명시
- 원장을 위변조 검증형 사설 원장으로 명명하고 HMAC 변조 테스트 추가
- 환경변수 검증, 0.0.0.0 bind, request ID 구조화 로그, health endpoint 강화
- 모바일 safe-area/bottom navigation/touch UI 유지 및 실제 지도 모바일 레이아웃 추가

## 실행 결과

- `npm run check`: lint, typecheck, `npm test` 28/28, production build 통과
- `npm run format:check`: 통과
- `npm run db:init`: 실제 SQLite 파일에 migration 10 적용 확인
- 실제 서버 `0.0.0.0:4100`, 웹 `http://localhost:5177`: `/api/health` 정상, SQLite/원장 검증 정상
- LAN 단일 서버 `http://192.168.0.189:4100`: HTML, 정적 asset, `/api/health` 정상
- 실제 DB 확인: `schema_migrations=10`, `token_positions=11`, `token_orders=9`
- 브라우저 smoke: 농장주 로그인 → 대시보드 → 지갑 진입, 포지션 요약 표시, 콘솔 error 0건

## 알려진 제한

- 브라우저와 서버 사이 실제 SSE 이벤트 수신은 API 자동 테스트 대신 ingest 후 DB/API 갱신과 one-time ticket 경로로 검증했습니다.
- OpenStreetMap 타일은 인터넷이 없는 환경에서 표시되지 않습니다. 좌표 데이터와 adapter 구조는 유지됩니다.
- HLS는 실제 카메라/gateway URL이 있어야 영상까지 확인할 수 있습니다.
- mock payment adapter만 있습니다. 실제 PG, 환불, 외부 webhook, 외부 reconciliation은 운영 도입 범위입니다.
- 사설 원장은 단일 SQLite/단일 HMAC 키 기반이며 분산 합의나 퍼블릭 체인 공증이 아닙니다.
- 실제 퍼블릭 체인 배포는 사용자의 RPC·chain·가스가 든 테스트 지갑이 없어서 수행하지 않았습니다. 배포 전 Solidity 전문 감사가 필요합니다.
- 이 환경은 사용자 PC의 방화벽 규칙이나 공유기 설정을 변경하지 않았습니다.
