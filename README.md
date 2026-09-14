# GREEN LINK

스마트팜의 재배 환경을 실시간으로 모니터링·제어하고, 컨테이너 기반 참여 토큰을 내부
모의 거래소에서 거래하며, 체결 내역을 Hyperledger Fabric에 앵커링하는 풀스택 데모
프로젝트입니다.

> 참여 토큰과 모의 크레딧은 개발·시연용이며 실제 농장 소유권, 증권, 배당권, 수익 보장
> 또는 실제 결제를 의미하지 않습니다.

## 주요 기능

- 온도, 습도, 조도, CO₂, 토양 수분, pH, EC 센서 모니터링
- SSE 기반 실시간 센서 갱신과 HLS CCTV 재생
- 농장 운영자의 환경 제어 명령 전송과 장치 처리 결과 확인
- 컨테이너별 참여 토큰 발행 요청·승인
- 모의 크레딧 기반 토큰 구매·판매, 주문, 포지션 및 지갑 관리
- PostgreSQL 내부 감사 원장과 Hyperledger Fabric 거래 앵커링
- 농장, 컨테이너, IoT 장치, 사용자 및 감사 로그 관리자 기능

## 기술 구성

| 영역 | 기술 |
| --- | --- |
| 프론트엔드 | React, TypeScript, Vite, Leaflet, HLS.js |
| 백엔드 | Node.js 22+, Express 5 |
| 데이터베이스 | PostgreSQL |
| 블록체인 | Hyperledger Fabric, CouchDB, Go 체인코드 |
| 실행 환경 | Docker, Docker Compose, Cloudflare Quick Tunnel |
| 테스트/검사 | Vitest, Supertest, ESLint, Prettier, TypeScript |

## 빠른 실행

Docker와 `cloudflared`가 준비되어 있다면 전체 데모 환경을 한 번에 실행할 수 있습니다.

```bash
./run.sh
```

- 서비스: `http://localhost:4100`
- 관리자 콘솔: `http://localhost:4101`
- 종료: `./stop.sh`

PostgreSQL을 별도로 실행하는 일반 개발 환경에서는 `.env.example`을 참고해 `.env`를 만든 뒤
다음 명령을 사용합니다.

```bash
npm install
npm run dev
```

```bash
npm run check
```

`npm run check`는 린트, TypeScript 검사, 테스트와 프로덕션 빌드를 수행합니다.

## 문서

| 문서 | 내용 |
| --- | --- |
| [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) | 프로젝트 목적, 기능, 처리 흐름, 데이터 모델과 전체 구조 |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | 프론트·백엔드·DB·Fabric 간 세부 연결 구조 |
| [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) | 디렉터리와 주요 파일별 역할 |
| [RUN.md](./RUN.md) | 전체 실행, 종료, 데모 계정과 문제 해결 방법 |

## 저장소에 포함하지 않는 파일

다음 항목은 보안 또는 용량 문제로 Git에서 제외되며 실행 시 로컬에서 생성됩니다.

- `.env`와 장치 키 등 로컬 비밀정보
- PostgreSQL/SQLite 데이터, 로그, 백업과 빌드 결과
- Fabric 조직 인증서와 개인키(`blockchain/organizations/`)
- Fabric 바이너리, 제네시스 블록, 체인코드 패키지와 실행 파일

운영 배포 전에는 반드시 DB 비밀번호와 `LEDGER_SIGNING_KEY`를 안전한 값으로 교체하고,
관리자 콘솔을 외부에 공개하지 않도록 별도의 접근 통제를 구성해야 합니다.
