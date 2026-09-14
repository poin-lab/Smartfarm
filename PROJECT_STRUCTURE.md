# GREEN LINK 프로젝트 구조

이 문서는 현재 저장소에서 어떤 파일이 어떤 역할인지 보기 위한 구조표다.

## 전체 구조

```text
GREEN LINK
├─ src/       React/Vite 프론트엔드
├─ server/    Express 백엔드와 DB 로직
├─ public/    브라우저 정적 파일
├─ README.md
└─ PROJECT_STRUCTURE.md
```

## 최상위 파일

| 파일 | 역할 |
| --- | --- |
| `README.md` | 프로젝트 기준 요약 |
| `PROJECT_STRUCTURE.md` | 현재 파일 구조 설명 |
| `package.json` | npm 명령과 의존성 |
| `package-lock.json` | 설치 버전 잠금 |
| `index.html` | Vite HTML 진입점 |
| `vite.config.ts` | Vite 설정 |
| `tsconfig.json` | TypeScript 공통 설정 |
| `tsconfig.app.json` | 프론트 TypeScript 설정 |
| `eslint.config.js` | ESLint 설정 |
| `.env.example` | 환경변수 예시 |
| `.gitignore` | git 제외 파일 목록 |

## src

프론트엔드 영역이다. 화면, API 호출 helper, 타입, 스타일이 들어있다.

| 파일 | 역할 |
| --- | --- |
| `src/main.tsx` | React 앱 시작점 |
| `src/App.tsx` | 화면 라우팅과 주요 페이지 |
| `src/api.ts` | `/api` 요청 helper, 세션 토큰 처리 |
| `src/model.ts` | 프론트 TypeScript 타입 |
| `src/tradingLimits.ts` | 거래 수량/가격 제한값 |
| `src/vite-env.d.ts` | Vite 타입 선언 |
| `src/styles/app.css` | 전체 UI 스타일 |
| `src/components/AdminOperations.tsx` | 관리자 운영/감사 화면 |
| `src/components/HlsVideo.tsx` | HLS 영상 컴포넌트 |
| `src/components/LiveMap.tsx` | 지도 컴포넌트 |

## server

백엔드 영역이다. 로그인, API, DB, 거래 처리 코드가 들어있다.

| 파일 | 역할 |
| --- | --- |
| `server/index.js` | 서버 시작점 |
| `server/app.js` | Express 앱, 인증, API 라우트 |
| `server/database.js` | PostgreSQL 스키마, 트랜잭션/블록체인 엔진 |
| `server/seed.js` | 로컬 개발/테스트용 데모 계정·데이터 (운영 환경엔 안 들어감) |
| `server/store.js` | DB store 생성 wrapper |
| `server/config.js` | 환경변수 설정 |
| `server/account/authenticator.js` | 로그인 검증 |
| `server/account/accounts.js` | 파일 기반 로그인 계정 로더 |
| `server/account/accounts.txt` | 개발용 로그인 계정 |
| `server/trading/index.js` | 내부 거래 provider (아래 파일들을 조립만 함) |
| `server/trading/shared.js` | 거래 로직 공용 헬퍼 (검증, 조회, 매핑) |
| `server/trading/ledger.js` | 원장 기록/포지션 증감/멱등키 헬퍼 |
| `server/trading/orders.js` | 매도 주문 등록·구매·취소 |
| `server/trading/issuance.js` | 토큰 발행 신청·승인 |
| `server/trading/book.js` | 주문장 조회·취소, 시세(quote) |
| `server/trading/limits.js` | 서버 거래 제한값 |
| `server/iot-simulator.js` | IoT 테스트용 시뮬레이터 |
| `server/logger.js` | 요청 로깅 |
| `server/app.test.js` | API 테스트 |

## public

브라우저가 직접 가져가는 정적 파일이다. import해서 쓰는 프론트 코드와 달리 URL로 바로 접근된다.

| 파일 | 역할 |
| --- | --- |
| `public/manifest.webmanifest` | 웹앱 이름, 아이콘, 표시 방식 설정 |
| `public/icons/app-icon.svg` | 앱 아이콘 |
| `public/images/smartfarm-cctv-placeholder.png` | CCTV placeholder 이미지 |

## 지운 것

| 대상 | 이유 |
| --- | --- |
| `dist/`, `dist-check/` | 빌드 산출물 |
| `server/data/` | 실제 DB 파일 위치 |
| `contracts/` | 블록체인 코드는 나중에 별도 설계 |
| `scripts/start-lan.js`, `scripts/start-public.js` | 공개/터널 실행은 나중에 배포 단계에서 결정 |
| Windows `.cmd` 파일 | npm 명령 중심으로 단순화 |
| `public/sw.js` | 오프라인 캐시가 현재 필요 없음 |
| 기타 설명용 `.md` 문서 | README와 구조문서만 남기기 위해 정리 |

## 나중에 바꿀 위치

| 바꿀 것 | 우선 볼 파일 |
| --- | --- |
| 로그인/세션 | `server/app.js`, `server/account/authenticator.js` |
| 프론트 화면 | `src/App.tsx`, `src/components/`, `src/styles/app.css` |
| 거래 기능 | `server/trading/`, `src/tradingLimits.ts` |
| 외부 공개 | `server/index.js`, `.env.example`, 별도 Cloudflare 설정 |
| 블록체인 anchor | PostgreSQL 전환 후 별도 모듈로 추가 |
