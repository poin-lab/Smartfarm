#!/bin/bash

# 1. 환경변수 설정 (경로 지옥 해결)
export ORDERER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/smartfarm.com/orderers/orderer.smartfarm.com/msp/tlscacerts/tlsca.smartfarm.com-cert.pem
export ADMIN_TLS_SIGN_CERT=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/smartfarm.com/orderers/orderer.smartfarm.com/tls/server.crt
export ADMIN_TLS_PRIVATE_KEY=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/smartfarm.com/orderers/orderer.smartfarm.com/tls/server.key
export ORDERER_ADMIN_LISTENADDRESS=orderer.smartfarm.com:7053

# 2. 채널 이름 & 제네시스 블록 경로
CHANNEL_NAME="txchannel"
GENESIS_BLOCK="./channel_artifacts/genesis.block"

echo "Running osnadmin channel join..."

# 3. 명령 실행
osnadmin channel join --channelID $CHANNEL_NAME \
--config-block $GENESIS_BLOCK \
-o $ORDERER_ADMIN_LISTENADDRESS \
--ca-file $ORDERER_CA \
--client-cert $ADMIN_TLS_SIGN_CERT \
--client-key $ADMIN_TLS_PRIVATE_KEY

# 4. 결과 확인
osnadmin channel list -o $ORDERER_ADMIN_LISTENADDRESS \
--ca-file $ORDERER_CA \
--client-cert $ADMIN_TLS_SIGN_CERT \
--client-key $ADMIN_TLS_PRIVATE_KEY