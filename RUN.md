# GREEN LINK 실행 가이드

이 프로젝트는 네 부분으로 떠 있어야 합니다.

| 구성 요소 | 위치 | 역할 |
| --- | --- | --- |
| Hyperledger Fabric 네트워크 | `blockchain/` | 거래내역을 머클루트로 묶어 앵커링하는 블록체인 |
| 앱 + Postgres | `docker-compose.yml` | 실제 서비스(API+프론트)와 DB |
| Cloudflare 임시 터널 | `cloudflared` | 외부에서 접속 가능한 URL 발급 |
| 관리자 콘솔 로컬 서버 | `serve-admin.js` | `admin.html`을 `http://localhost:4101`로 서빙 |

## 한 번에 켜기

```bash
./run.sh
```

- 이미 떠 있는 부분은 알아서 건너뜁니다 (몇 번을 다시 실행해도 안전).
- Fabric 네트워크가 처음이면 crypto 생성 + 체인코드 배포까지 하느라 시간이 좀 걸립니다.
- 끝나면 터미널에 이렇게 뜹니다:

```
==================================================
 GREEN LINK 준비 완료
==================================================
 로컬:            http://localhost:4100
 외부 공개:        https://xxxx-xxxx-xxxx-xxxx.trycloudflare.com
 관리 콘솔(로컬):  http://localhost:4101/
 관리 콘솔(외부):  https://yyyy-yyyy-yyyy-yyyy.trycloudflare.com
 종료하려면:       ./stop.sh
==================================================
```

**외부 공개 주소는 껐다 켤 때마다 바뀝니다.** 계정 없이 만드는 임시(quick) 터널이라 그래요. 계속 같은 주소로 쓰려면 나중에 Cloudflare 계정 + 도메인으로 named tunnel을 만들어야 합니다 (지금은 안 함).

## 끄기

```bash
./stop.sh
```

- 앱/DB 컨테이너랑 Cloudflare 터널(앱+관리 콘솔), 관리 콘솔 로컬 서버를 내립니다.
- **Fabric 네트워크는 일부러 안 내립니다.**

### Fabric 데이터가 언제 사라지고 언제 안 사라지는지

- **컴퓨터/Docker 재부팅, `docker stop`, WSL 재시작** → 데이터 안 사라짐. 컨테이너에
  `restart: unless-stopped`가 걸려 있어서 Docker가 다시 켜지면 자동 복구되고, 설령 꺼진
  채로 있어도 `./run.sh`가 "컨테이너는 있는데 꺼져만 있음"을 감지해서 **기존 볼륨 그대로**
  다시 켭니다 (`network_setup.sh`를 다시 돌리지 않음).
- **`cd blockchain && docker compose -f compose/docker-compose.yaml down -v`를 직접 실행**
  → 이건 진짜로 다 지웁니다 (`-v`가 볼륨까지 삭제). 다음 `./run.sh`는 컨테이너가 아예 없다고
  판단해서 `network_setup.sh`로 완전히 새 체인을 처음부터 만듭니다 — 그동안 앵커링된 모든
  블록/거래 기록은 영구히 사라집니다. **이 명령은 정말 다 지우고 싶을 때만 쓰세요.**
- 이 경우 Postgres 쪽 `transaction_anchor_batches`/`public_chain_operations`에는 예전
  `tx_hash`/`block_number` 기록이 남아있지만, 그 체인 자체가 없어졌으니 더 이상 검증은
  안 됩니다. `token_executions.anchored_batch_id`도 이미 채워진 상태라 자동으로 재앵커링되지
  않으니, 필요하면 그 컬럼을 수동으로 `NULL` 처리해야 다시 앵커링됩니다.

## 데모 계정

| 역할 | 이메일 | 비밀번호 |
| --- | --- | --- |
| 일반 유저 | user@smartfarm.kr | user1234 |
| 농장주 | farmer@smartfarm.kr | farmer1234 |
| 관리자 | admin@smartfarm.kr | admin1234 |

비밀번호는 해시로 저장돼서 원본 복구가 안 됩니다. 위 계정 비번을 잃어버렸거나 테스트 계정 비번을 모를 땐 `admin.html`의 "계정" 탭에서 관리자 권한으로 강제 재설정하세요.

## 개발자 콘솔 (admin.html)

**`admin.html`을 `file://`로 직접 열지 마세요.** 최신 크롬 계열 브라우저는 Private Network
Access 정책 때문에 `file://` 페이지가 `localhost` API를 호출하는 걸 막습니다 (서버 CORS
설정과 무관하게 막힘). `run.sh`가 띄워주는 `http://localhost:4101/`로 접속하세요 —
`serve-admin.js`가 `admin.html` 내용을 그대로 서빙하는 아주 작은 로컬 전용(127.0.0.1) 서버라,
빌드/Docker 이미지에는 포함되지 않습니다.

**다른 사람한테 보여줘야 하면** `run.sh`가 관리 콘솔용 Cloudflare 터널도 같이 띄워줍니다
("관리 콘솔(외부)" 주소). 이 주소로 열면 "API base" 입력칸이 자동으로 앱의 실제 공개 주소로
채워져 있어서 바로 로그인/사용 가능합니다.

⚠️ **admin.html 안에 데모 관리자 비밀번호(admin1234)가 그대로 적혀 있습니다.** 이 외부
주소를 아는 사람은 누구나 로그인해서 DB 원본 조회, 비밀번호 강제 재설정까지 할 수 있어요.
보여줄 사람한테만 링크를 공유하고, 다 보여줬으면 `./stop.sh`로 터널을 내리세요.

- **통합 로그**: 로그인/거래/체인 앵커링/내부 원장을 시간순으로 한 화면에
- **거래내역**: 누가 뭘 얼마에 샀는지 + Fabric 블록 번호까지
- **계정**: 유저/세션 목록, 비밀번호 강제 재설정
- **DB 테이블**: 아무 테이블이나 골라서 원본 그대로 조회 (psql 안 열어도 됨)
- **Raw 콘솔**: API 호출 직접 날려보기

admin 계정으로 로그인해야 대부분의 버튼이 동작합니다.

## 문제 해결

- **`cloudflared: command not found`**: `~/.local/bin/cloudflared`에 설치돼 있어야 합니다. 없으면:
  ```bash
  curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared
  chmod +x ~/.local/bin/cloudflared
  ```
- **Fabric 컨테이너 이름이 다른 프로젝트랑 겹침**: 이 프로젝트는 `smartfarm.com` / `txchannel` / `cli-smartfarm` / `couchdb-smartfarm` 이름을 씁니다. `~/hyperledger/biodiversity` 같은 다른 Fabric 프로젝트랑 컨테이너 이름이 안 겹치게 이미 분리해뒀습니다.
- **터널 URL이 안 뜸**: `.run/cloudflared.log` 확인. `pgrep -af cloudflared`로 프로세스가 떠 있는지도 확인.
- **관리 콘솔(4101 포트)이 안 열림**: `.run/admin-console.log` 확인. 포트가 이미 다른 프로세스에 물려있으면 `ADMIN_CONSOLE_PORT=4102 ./run.sh`처럼 포트를 바꿔서 실행하세요.
- **스키마가 바뀌었는데 반영이 안 됨**: `docker compose down -v`로 DB 볼륨을 지우고 `./run.sh`를 다시 실행하세요 (데모 데이터라 지워도 됨, 이 프로젝트는 매번 새 DB에 자동으로 시드합니다).
