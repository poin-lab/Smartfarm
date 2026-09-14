#!/bin/bash

echo "=========================================================="
echo "🕵️‍♂️  하이퍼레저 패브릭 버전 정합성 검사 (Audit)"
echo "=========================================================="

# 1. 내 컴퓨터(Host)에 있는 도구 버전 확인
echo ""
echo "🖥️  [1. Host Binaries] 내 컴퓨터 도구 버전 (제네시스 블록 만든 놈)"
if [ -f "./bin/peer" ]; then
    echo -n "👉 Peer Binary:       "
    ./bin/peer version | grep "Version:"
else
    echo "⚠️  ./bin/peer 파일이 없습니다."
fi

if [ -f "./bin/configtxgen" ]; then
    echo -n "👉 Configtxgen:       "
    ./bin/configtxgen -version | grep "Version"
else
    echo "⚠️  ./bin/configtxgen 파일이 없습니다."
fi

# 2. 도커 이미지 버전 확인
echo ""
echo "🐳  [2. Docker Images] 실행 중인 컨테이너 이미지 태그"
echo "👉 Orderer Image:     $(docker inspect -f '{{.Config.Image}}' orderer.smartfarm.com 2>/dev/null || echo 'Not Running')"
echo "👉 Peer Image:        $(docker inspect -f '{{.Config.Image}}' peer0.org1.smartfarm.com 2>/dev/null || echo 'Not Running')"
echo "👉 CLI Image:         $(docker inspect -f '{{.Config.Image}}' cli-smartfarm 2>/dev/null || echo 'Not Running')"
echo "👉 CouchDB Image:     $(docker inspect -f '{{.Config.Image}}' couchdb-smartfarm 2>/dev/null || echo 'Not Running')"

# 3. CLI 컨테이너 내부 버전 확인 (실제 명령 수행하는 놈)
echo ""
echo "📦  [3. CLI Container] 컨테이너 내부 도구 버전"
docker exec cli-smartfarm peer version | grep "Version:" > /dev/null
if [ $? -eq 0 ]; then
    echo -n "👉 CLI Internal Peer: "
    docker exec cli-smartfarm peer version | grep "Version:"
else
    echo "⚠️  CLI 컨테이너가 실행 중이지 않습니다."
fi

# 4. Go 언어 버전 (체인코드용)
echo ""
echo "🐹  [4. Go Lang] 체인코드 실행 환경"
echo -n "👉 Host Go Version:   "
go version 2>/dev/null || echo "Go가 설치되지 않았거나 경로에 없습니다."

echo ""
echo "=========================================================="
echo "✅  검사 완료. 위 버전들이 서로 비슷한지(2.x) 확인하세요."