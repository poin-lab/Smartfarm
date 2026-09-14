#!/bin/bash
set -e

CC_NAME="txanchor"
CC_VERSION="1.0"        # ✅ 올려라
CC_SEQUENCE="1"         # ✅ 올려라 (가장 중요)
CC_SRC_PATH="./chaincode"
CHANNEL_ID="txchannel"

export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID="Org1MSP"
export CORE_PEER_TLS_ROOTCERT_FILE=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.smartfarm.com/peers/peer0.org1.smartfarm.com/tls/ca.crt
export CORE_PEER_MSPCONFIGPATH=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/peerOrganizations/org1.smartfarm.com/users/Admin@org1.smartfarm.com/msp
export CORE_PEER_ADDRESS=peer0.org1.smartfarm.com:7051
export FABRIC_CFG_PATH=/etc/hyperledger/fabric

ORDERER_CA=/opt/gopath/src/github.com/hyperledger/fabric/peer/organizations/ordererOrganizations/smartfarm.com/orderers/orderer.smartfarm.com/msp/tlscacerts/tlsca.smartfarm.com-cert.pem
ORDERER_ADDRESS=orderer.smartfarm.com:7050



echo "📦 1) Package..."
peer lifecycle chaincode package ${CC_NAME}.tar.gz \
  --path ${CC_SRC_PATH} --lang golang --label ${CC_NAME}_${CC_VERSION}



echo "💾 2) Install..."
peer lifecycle chaincode install ${CC_NAME}.tar.gz

echo "🔍 Package ID..."
PACKAGE_ID=$(peer lifecycle chaincode queryinstalled | grep ${CC_NAME}_${CC_VERSION} | awk -F "Package ID: " '{print $2}' | awk -F "," '{print $1}')
echo "👉 Package ID: $PACKAGE_ID"

echo "👍 3) Approve..."
peer lifecycle chaincode approveformyorg \
  -o $ORDERER_ADDRESS --tls --cafile $ORDERER_CA \
  --channelID $CHANNEL_ID --name $CC_NAME --version $CC_VERSION \
  --package-id $PACKAGE_ID --sequence $CC_SEQUENCE

echo "🚀 4) Commit..."
peer lifecycle chaincode commit \
  -o $ORDERER_ADDRESS --tls --cafile $ORDERER_CA \
  --channelID $CHANNEL_ID --name $CC_NAME --version $CC_VERSION \
  --sequence $CC_SEQUENCE \
  --peerAddresses $CORE_PEER_ADDRESS --tlsRootCertFiles $CORE_PEER_TLS_ROOTCERT_FILE

echo "✅ committed:"
peer lifecycle chaincode querycommitted -C $CHANNEL_ID -n $CC_NAME
