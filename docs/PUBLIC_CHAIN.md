# GREEN LINK 퍼블릭 체인 하이브리드 운영

이 문서는 후순위 선택 기능이다. 현재 내부 거래의 원본은 SQLite이며, 현재 기능·DB·외부 거래 경계는 [FEATURES.md](./FEATURES.md), [DATABASE.md](./DATABASE.md), [EXTERNAL_TRADING.md](./EXTERNAL_TRADING.md)를 우선 기준으로 한다.

## 데이터 경계

- EVM 퍼블릭 체인: ERC-1155 컨테이너 이용/참여 토큰의 발행·잔액·전송, escrow 판매·구매 결과, 센서 배치 Merkle root
- SQLite: 센서 원본, 장비·카메라·제어 상태, 사용자 프로필, 화면용 인덱스, transactional outbox
- HMAC 사설 원장: 서버 내부 감사 및 퍼블릭 체인 transaction hash 연결

퍼블릭 체인은 농장 소유권·증권·배당권을 의미하지 않습니다. `GreenLinkAssets` 주석과 UI에서 이용/참여 자산으로 한정합니다.

## 컨트랙트

- `contracts/GreenLinkAssets.sol`: ERC-1155, supply tracking, role-based mint/anchor, emergency pause
- `contracts/GreenLinkMarketplace.sol`: ERC-1155 거래소 에스크로, native-currency 결제, fee cap, pause, reentrancy guard

관리자 권한과 릴레이어 키는 운영에서 개인 EOA 대신 multisig와 제한된 역할로 분리하십시오. 컨트랙트는 외부 전문 감사를 받기 전 메인넷에 배포하면 안 됩니다.

## 컴파일

```powershell
npm ci
npm run contracts:compile
```

산출물은 `contracts/artifacts`에 생성됩니다. 컴파일러는 Solidity 0.8.30, OpenZeppelin Contracts 5.4.0으로 고정되어 있습니다.

## 로컬 체인 또는 테스트넷 배포

먼저 `.env`에 RPC, chain ID, 테스트용 배포키를 설정합니다. 키에는 테스트 자산만 보관하십시오.

```powershell
$env:PUBLIC_CHAIN_RPC_URL = "http://127.0.0.1:8545"
$env:PUBLIC_CHAIN_ID = "31337"
$env:PUBLIC_CHAIN_NAME = "Local EVM"
$env:PUBLIC_CHAIN_RELAYER_PRIVATE_KEY = "0x..."
npm run contracts:deploy
```

출력된 주소를 `.env`에 저장합니다.

```text
PUBLIC_CHAIN_ASSET_ADDRESS=0x...
PUBLIC_CHAIN_MARKETPLACE_ADDRESS=0x...
```

그 후 서버를 재시작합니다. `GET /api/public-chain/status`에서 `enabled=true`, `relayerEnabled=true`를 확인합니다.

## 처리 흐름

### 발행

1. 사용자가 프로필에서 EVM 지갑 challenge를 개인키로 서명해 계정과 연결합니다.
2. 관리자가 토큰을 발행하면 SQLite 변경과 `ISSUE_CONTAINER_TOKEN` outbox가 같은 transaction에 저장됩니다.
3. worker가 15초마다 릴레이어로 ERC-1155 발행을 제출합니다.
4. 설정된 confirmation 수가 충족되면 outbox가 `confirmed`가 되고 transaction hash가 사설 감사 원장에도 연결됩니다.

### 센서

1. 원본 측정값은 계속 SQLite에 저장됩니다.
2. 관리자가 최대 500건 단위로 배치를 만들면 결정적 Merkle root와 outbox가 생성됩니다.
3. 체인에는 container key, root, 시간 범위, 측정 수만 기록됩니다.
4. 원본 데이터나 개인정보는 퍼블릭 체인에 올리지 않습니다.

### 거래

1. 판매자는 지갑에서 거래소에 ERC-1155 이동 권한을 승인합니다.
2. 판매 등록 시 자산이 거래소 에스크로로 이동합니다.
3. 구매자는 정확한 native-currency 금액과 함께 구매를 서명합니다.
4. 컨트랙트가 토큰과 대금을 원자적으로 이전합니다.
5. 서버는 receipt의 컨트랙트 주소와 `Listed`/`Purchased`/`Cancelled` 이벤트를 검증한 뒤 transaction hash를 감사 DB에 기록합니다.

기존 모의 크레딧 거래는 퍼블릭 체인 설정이 없는 개발 데모용으로 남아 있으며 UI에서 명확히 분리됩니다.

## 장애와 재처리

`public_chain_operations` 상태는 `pending`, `submitting`, `submitted`, `confirmed`, `failed`다. 실패 작업은 최대 5회 재시도된다. 관리자 UI에서 원인과 시도 횟수를 확인하고 다음 outbox를 수동 처리할 수도 있다.

DB의 보유량을 온체인 소유권의 최종 진실로 간주하면 안 됩니다. 퍼블릭 모드에서는 ERC-1155 `balanceOf`와 확정 event가 source of truth이고 SQLite는 조회용 projection입니다. 운영 확장 시 블록 cursor와 reorg rollback을 갖는 전용 indexer를 별도 프로세스로 분리하십시오.

## 운영 전 필수 사항

- 테스트넷 장기 검증
- Solidity 단위·property·fuzz 테스트와 독립 보안 감사
- multisig, timelock, 역할별 키 분리
- RPC 이중화 및 block reorganization 대응 indexer
- 메타데이터 영구 저장과 개인정보 배제
- 가스·수수료·환불·세무 처리
- 국내 이용자를 대상으로 하는 토큰 권리 및 거래 구조의 법률 검토
