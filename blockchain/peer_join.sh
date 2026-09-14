#!/bin/bash

# 1. Peer0 Org1 환경변수 설정 (나 Peer0 이야! 라고 신분 증명)
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.smartfarm.com/peers/peer0.org1.smartfarm.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.smartfarm.com/users/Admin@org1.smartfarm.com/msp
export CORE_PEER_ADDRESS=peer0.org1.smartfarm.com:7051

export FABRIC_CFG_PATH=/etc/hyperledger/fabric


GENESIS_BLOCK="/opt/gopath/src/github.com/hyperledger/fabric/peer/channel_artifacts/genesis.block"

# 2. 채널 이름 & 블록 경로
CHANNEL_ID="txchannel"
echo "🏃 Peer0가 '$CHANNEL_ID' 채널에 입장(Join)합니다..."


if [ ! -f "$GENESIS_BLOCK" ]; then
    echo "🔥 에러: 제네시스 블록 파일이 없습니다! ($GENESIS_BLOCK)"
    ls -R /opt/gopath/src/github.com/hyperledger/fabric/peer/channel_artifacts
    exit 1
fi

peer channel join -b $GENESIS_BLOCK

if [ $? -eq 0 ]; then
    echo "🎉 Peer0 채널 가입 성공!"
    peer channel list
else
    echo "🔥 실패! 로그 확인 필요."
fi