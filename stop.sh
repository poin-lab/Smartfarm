#!/bin/bash
# Stops the app/DB containers and the Cloudflare tunnel started by run.sh.
# Leaves the Fabric network (blockchain/) running on purpose — bringing it
# back up regenerates crypto material and redeploys the chaincode, which
# takes a while. Tear it down separately if you really want to (see RUN.md).
set -uo pipefail
cd "$(dirname "$0")"

RUN_DIR=".run"

echo "Cloudflare 터널 종료 (앱 + 관리 콘솔)..."
if [ -f "$RUN_DIR/cloudflared.pid" ]; then
  kill "$(cat "$RUN_DIR/cloudflared.pid")" 2>/dev/null
  rm -f "$RUN_DIR/cloudflared.pid"
fi
if [ -f "$RUN_DIR/cloudflared-admin.pid" ]; then
  kill "$(cat "$RUN_DIR/cloudflared-admin.pid")" 2>/dev/null
  rm -f "$RUN_DIR/cloudflared-admin.pid"
fi
pkill -f "cloudflared tunnel --url http://localhost" 2>/dev/null

echo "관리자 콘솔 로컬 서버 종료..."
if [ -f "$RUN_DIR/admin-console.pid" ]; then
  kill "$(cat "$RUN_DIR/admin-console.pid")" 2>/dev/null
  rm -f "$RUN_DIR/admin-console.pid"
else
  pkill -f "node .*serve-admin.js" 2>/dev/null
fi

echo "앱 + DB 컨테이너 종료..."
docker compose down

echo "완료. Fabric 네트워크는 계속 떠 있습니다 (docker ps로 확인 가능)."
echo "Fabric까지 완전히 내리려면: (cd blockchain && docker compose -f compose/docker-compose.yaml down -v)"
