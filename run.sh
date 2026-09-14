#!/bin/bash
# Starts everything needed for the GREEN LINK demo:
#   1) Hyperledger Fabric network + txanchor chaincode (blockchain/)
#   2) app + Postgres (docker-compose.yml)
#   3) a Cloudflare quick tunnel so it's reachable from outside
#   4) a tiny local server for the admin.html dev console
# Safe to re-run: skips any piece that's already up.
set -euo pipefail
cd "$(dirname "$0")"

RUN_DIR=".run"
mkdir -p "$RUN_DIR"
CLOUDFLARED="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
if ! command -v node > /dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.nvm/nvm.sh"
fi
ADMIN_PORT="${ADMIN_CONSOLE_PORT:-4101}"

echo "== 1) Fabric 블록체인 네트워크 =="
if docker ps --format '{{.Names}}' | grep -q '^peer0.org1.smartfarm.com$'; then
  echo "이미 떠 있음, 건너뜀."
elif docker ps -a --format '{{.Names}}' | grep -q '^peer0.org1.smartfarm.com$'; then
  # 컨테이너/볼륨은 있는데 꺼져만 있는 상태 (컴퓨터 재부팅 등). network_setup.sh는
  # crypto를 밀고 새로 만들어서 기존 체인 데이터를 날려버리니, 이 경우엔 절대 쓰지 않고
  # 있는 컨테이너를 그대로 다시 켠다.
  echo "컨테이너는 있는데 꺼져 있음 — 기존 체인 데이터 유지한 채 다시 켬..."
  (cd blockchain && docker compose -f compose/docker-compose.yaml up -d)
else
  echo "처음 띄우는 거라 새로 만듭니다 (crypto 생성 + 컨테이너 기동, 시간이 좀 걸림)..."
  (cd blockchain && bash network_setup.sh)
  echo "체인코드(txanchor) 패키징/설치/승인/커밋 중..."
  docker exec cli-smartfarm bash -c \
    "cd /opt/gopath/src/github.com/hyperledger/fabric/peer && bash deploy.sh"
fi

echo ""
echo "== 2) 앱 + DB (Docker Compose) =="
docker compose up -d --build

echo ""
echo "== 3) Cloudflare 임시 터널 =="
if pgrep -f "cloudflared tunnel --url http://localhost:${PORT:-4100}" > /dev/null 2>&1; then
  echo "이미 떠 있음, 건너뜀."
else
  if [ ! -x "$CLOUDFLARED" ] && ! command -v cloudflared > /dev/null 2>&1; then
    echo "cloudflared가 없습니다. 설치 방법은 RUN.md를 참고하세요."
  else
    nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:${PORT:-4100}" \
      > "$RUN_DIR/cloudflared.log" 2>&1 &
    echo $! > "$RUN_DIR/cloudflared.pid"
    echo "터널 URL 기다리는 중..."
    for _ in $(seq 1 20); do
      URL="$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$RUN_DIR/cloudflared.log" 2>/dev/null | head -1 || true)"
      [ -n "$URL" ] && break
      sleep 1
    done
  fi
fi
URL="$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$RUN_DIR/cloudflared.log" 2>/dev/null | head -1 || true)"

echo ""
echo "== 4) 관리자 콘솔 (admin.html) 로컬 서버 =="
if pgrep -f "node .*serve-admin.js" > /dev/null 2>&1; then
  echo "이미 떠 있음, 건너뜀."
else
  ADMIN_CONSOLE_PORT="$ADMIN_PORT" APP_PUBLIC_URL="$URL" nohup node serve-admin.js \
    > "$RUN_DIR/admin-console.log" 2>&1 &
  echo $! > "$RUN_DIR/admin-console.pid"
  sleep 1
fi

echo ""
echo "== 5) 관리자 콘솔 Cloudflare 터널 =="
# admin.html에 데모 관리자 비번이 그대로 적혀 있음 — 이 주소를 아는 사람은 로그인해서
# DB 원본 조회/비번 강제 재설정까지 가능. 보여줄 사람한테만 링크 공유할 것.
if pgrep -f "cloudflared tunnel --url http://localhost:${ADMIN_PORT}" > /dev/null 2>&1; then
  echo "이미 떠 있음, 건너뜀."
else
  if [ ! -x "$CLOUDFLARED" ] && ! command -v cloudflared > /dev/null 2>&1; then
    echo "cloudflared가 없습니다. 설치 방법은 RUN.md를 참고하세요."
  else
    nohup "$CLOUDFLARED" tunnel --no-autoupdate --url "http://localhost:${ADMIN_PORT}" \
      > "$RUN_DIR/cloudflared-admin.log" 2>&1 &
    echo $! > "$RUN_DIR/cloudflared-admin.pid"
    echo "터널 URL 기다리는 중..."
    for _ in $(seq 1 20); do
      ADMIN_URL="$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$RUN_DIR/cloudflared-admin.log" 2>/dev/null | head -1 || true)"
      [ -n "$ADMIN_URL" ] && break
      sleep 1
    done
  fi
fi
ADMIN_URL="$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$RUN_DIR/cloudflared-admin.log" 2>/dev/null | head -1 || true)"

echo ""
echo "=================================================="
echo " GREEN LINK 준비 완료"
echo "=================================================="
echo " 로컬:            http://localhost:${PORT:-4100}"
if [ -n "$URL" ]; then
  echo " 외부 공개:        $URL"
else
  echo " 외부 공개:        아직 못 받아옴, .run/cloudflared.log 확인"
fi
echo " 관리 콘솔(로컬):  http://localhost:${ADMIN_PORT}/  (file://로 직접 열지 마세요)"
if [ -n "$ADMIN_URL" ]; then
  echo " 관리 콘솔(외부):  $ADMIN_URL  ← 보여줄 사람한테만 공유"
else
  echo " 관리 콘솔(외부):  아직 못 받아옴, .run/cloudflared-admin.log 확인"
fi
echo " 종료하려면:       ./stop.sh"
echo "=================================================="
