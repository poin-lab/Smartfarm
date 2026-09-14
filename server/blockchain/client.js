import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as grpc from "@grpc/grpc-js";
import { connect, signers } from "@hyperledger/fabric-gateway";

// Points at the Fabric network under smartfarm/blockchain/ (see that folder's
// README-equivalent: network_setup.sh brings it up, deploy.sh installs the
// txanchor chaincode). ORG_MSP_DIR is the Admin identity's MSP folder, mounted
// read-only into this container from blockchain/organizations/ by
// docker-compose.yml.
const config = {
  peerEndpoint: process.env.FABRIC_PEER_ENDPOINT || "peer0.org1.smartfarm.com:7051",
  peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS || "peer0.org1.smartfarm.com",
  mspId: process.env.FABRIC_MSP_ID || "Org1MSP",
  channelName: process.env.FABRIC_CHANNEL || "txchannel",
  chaincodeName: process.env.FABRIC_CHAINCODE || "txanchor",
  orgMspDir:
    process.env.FABRIC_MSP_DIR ||
    "/fabric-org/users/Admin@org1.smartfarm.com/msp",
  peerTlsCertPath:
    process.env.FABRIC_PEER_TLS_CERT ||
    "/fabric-org/peers/peer0.org1.smartfarm.com/tls/ca.crt",
};

let gatewayPromise;

async function newGrpcConnection() {
  const tlsRootCert = await readFile(config.peerTlsCertPath);
  const credentials = grpc.credentials.createSsl(tlsRootCert);
  return new grpc.Client(config.peerEndpoint, credentials, {
    "grpc.ssl_target_name_override": config.peerHostAlias,
  });
}

async function newIdentity() {
  const certPath = `${config.orgMspDir}/signcerts/Admin@org1.smartfarm.com-cert.pem`;
  const credentials = await readFile(certPath);
  return { mspId: config.mspId, credentials };
}

async function newSigner() {
  const keyDir = `${config.orgMspDir}/keystore`;
  const keyPath = `${keyDir}/priv_sk`;
  const privateKeyPem = await readFile(keyPath);
  const privateKey = createPrivateKey(privateKeyPem);
  return signers.newPrivateKeySigner(privateKey);
}

async function connectGateway() {
  const client = await newGrpcConnection();
  const gateway = connect({
    client,
    identity: await newIdentity(),
    signer: await newSigner(),
  });
  return gateway;
}

// Same self-healing shape as database.js's getReady(): if connecting fails
// (Fabric not reachable yet, cert volume not mounted, etc.) don't cache the
// rejection forever — clear it so the next anchor attempt tries again fresh
// instead of failing permanently until the process is restarted.
const getGateway = () => {
  if (!gatewayPromise)
    gatewayPromise = connectGateway().catch((error) => {
      gatewayPromise = null;
      throw error;
    });
  return gatewayPromise;
};

const getContract = async () => {
  const gateway = await getGateway();
  return gateway.getNetwork(config.channelName).getContract(config.chaincodeName);
};

// Submits a batch of { execution_id, token_id, buyer_id, seller_id, quantity,
// unit_price, executed_at, cer_hash } items to the txanchor chaincode's
// CreateBatch function. Uses the fine-grained proposal/endorse/submit flow
// (rather than the submitTransaction shorthand) specifically to read back
// which Fabric block the transaction landed in.
export async function submitBatch(items) {
  const contract = await getContract();
  const wrapped = items.map((fields) => ({ fields }));
  const proposal = contract.newProposal("CreateBatch", {
    arguments: [JSON.stringify(wrapped)],
  });
  const transaction = await proposal.endorse();
  const commit = await transaction.submit();
  const status = await commit.getStatus();
  if (!status.successful)
    throw new Error(`Fabric transaction ${status.transactionId} failed to commit (code ${status.code})`);
  const record = JSON.parse(Buffer.from(transaction.getResult()).toString("utf8"));
  return { ...record, block_number: Number(status.blockNumber) };
}

export async function getBatch(merkleRoot) {
  const contract = await getContract();
  const resultBytes = await contract.evaluateTransaction("GetBatch", merkleRoot);
  return JSON.parse(Buffer.from(resultBytes).toString("utf8"));
}
