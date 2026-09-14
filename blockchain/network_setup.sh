#!/bin/bash

# ====================================================
# [위치] 이 스크립트는 network 폴더에서 실행하세요!
# ====================================================

# 변수 설정 (나중에 바꾸기 쉽게 위로 뺌)
CHANNEL_ID="txchannel"
PROFILE_NAME="TwoOrgsOrdererGenesis"

echo "🐳 네트워크 완전 초기화 및 시작 (Host-Based Setup)"

# Git에는 플랫폼별 Fabric 바이너리를 포함하지 않는다. 새로 clone한 환경에서는
# 공식 설치 스크립트로 필요한 도구를 먼저 내려받는다.
if [ ! -x ./bin/cryptogen ] || [ ! -x ./bin/configtxgen ]; then
    echo "📦 Hyperledger Fabric 바이너리 설치 중..."
    bash ./install-fabric.sh binary
fi

# ----------------------------------------------------
# 1. 청소 (Clean up)
# ----------------------------------------------------
echo "🧹 도커 컨테이너 및 볼륨 삭제..."
docker compose -f compose/docker-compose.yaml down -v

echo "🗑️ 기존 인증서 및 제네시스 블록 완전 삭제..."
rm -rf organizations
# sudo rm -rf crypto-config  <-- (주의) crypto-config.yaml 파일은 지우면 안 되니 폴더만 지워야 함.
# 보통 organizations 폴더만 지우면 됩니다.
rm -rf channel_artifacts/*.block

# ----------------------------------------------------
# 2. 파일 생성 (Generate Files) - ★ 여기가 중요! ★
# 도커 켜기 전에 재료를 다 만들어야 합니다.
# ----------------------------------------------------

# (1) 인증서 생성
echo "🔐 인증서(Crypto) 재생성 중..."
./bin/cryptogen generate --config=./crypto-config.yaml --output="organizations"
if [ $? -ne 0 ]; then echo "🔥 인증서 생성 실패!"; exit 1; fi

# (2) 제네시스 블록 생성 (Step 5에 있던 걸 여기로 가져옴!)
# 이제 컨테이너(CLI) 말고 내 컴퓨터(Host)에서 만듭니다.
echo "🔨 제네시스 블록 생성 중... (Host 방식)"
export FABRIC_CFG_PATH=$PWD

# output 경로가 channel_artifacts 폴더인지 확인
if [ ! -d "channel_artifacts" ]; then mkdir channel_artifacts; fi

./bin/configtxgen -profile $PROFILE_NAME -channelID $CHANNEL_ID -outputBlock ./channel_artifacts/genesis.block

if [ $? -ne 0 ]; then echo "🔥 제네시스 블록 생성 실패! configtx.yaml 확인 필요."; exit 1; fi


# ----------------------------------------------------
# 3. 도커 실행 (Run Docker)
# 이제 밥(genesis.block)이 있으니 오더러가 안 죽습니다.
# ----------------------------------------------------
echo "🚀 컨테이너 시작..."

docker compose -f compose/docker-compose.yaml up -d

echo "⏳ 오더러/피어 안정화 대기 (5초)..."
sleep 5

# ----------------------------------------------------
# 4. 채널 조인 (Join Channel)
# ----------------------------------------------------
# 블록은 아까 위에서 만들었으니, generate.sh는 빼고 join만 시킵니다.

echo "🔗 채널 참여 (Orderer & Peer)..."
# join.sh 안에서 채널 생성(create)과 조인(join)을 하는지 확인 필요
docker exec cli-smartfarm ./join.sh
docker exec cli-smartfarm ./peer_join.sh

echo "✅ [성공] 네트워크가 정상적으로 구동되었습니다!"
