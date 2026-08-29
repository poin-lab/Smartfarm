import { createHash } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  parseEventLogs,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const assetAbi = parseAbi([
  "function issueContainerToken(bytes32 containerKey,uint256 tokenId,uint256 supply,address recipient)",
  "function anchorSensorBatch(bytes32 containerKey,bytes32 merkleRoot,uint64 fromTimestamp,uint64 toTimestamp,uint32 readingCount)",
]);
const marketplaceAbi = parseAbi([
  "event Listed(uint256 indexed listingId,address indexed seller,uint256 indexed tokenId,uint256 quantity,uint256 unitPrice)",
  "event Purchased(uint256 indexed listingId,address indexed buyer,address indexed seller,uint256 tokenId,uint256 quantity,uint256 totalPrice)",
  "event Cancelled(uint256 indexed listingId,address indexed seller,uint256 returnedQuantity)",
]);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
export const containerTokenId = (containerId) =>
  BigInt(`0x${sha256(containerId).slice(0, 16)}`);
export const containerKey = (containerId) => keccak256(toBytes(containerId));

export function merkleRoot(records) {
  if (!records.length)
    throw new Error("Cannot build a Merkle root from an empty batch");
  let level = records.map((record) =>
    Buffer.from(sha256(JSON.stringify(record)), "hex"),
  );
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index],
        right = level[index + 1] || left;
      next.push(Buffer.from(sha256(Buffer.concat([left, right])), "hex"));
    }
    level = next;
  }
  return `0x${level[0].toString("hex")}`;
}

export function createPublicChain(env = process.env) {
  const rpcUrl = env.PUBLIC_CHAIN_RPC_URL || "";
  const contractAddress = env.PUBLIC_CHAIN_ASSET_ADDRESS || "";
  const marketplaceAddress = env.PUBLIC_CHAIN_MARKETPLACE_ADDRESS || "";
  const privateKey = env.PUBLIC_CHAIN_RELAYER_PRIVATE_KEY || "";
  const chainId = Number(env.PUBLIC_CHAIN_ID || 0);
  const explorerUrl = env.PUBLIC_CHAIN_EXPLORER_URL || "";
  const enabled = Boolean(
    rpcUrl && /^0x[0-9a-fA-F]{40}$/.test(contractAddress) && chainId > 0,
  );
  const relayerEnabled = Boolean(
    enabled && /^0x[0-9a-fA-F]{64}$/.test(privateKey),
  );
  const chain = {
    id: chainId || 0,
    name: env.PUBLIC_CHAIN_NAME || "Configured EVM",
    nativeCurrency: {
      name: "Native",
      symbol: env.PUBLIC_CHAIN_CURRENCY || "ETH",
      decimals: 18,
    },
    rpcUrls: { default: { http: rpcUrl ? [rpcUrl] : [] } },
  };
  const account = relayerEnabled ? privateKeyToAccount(privateKey) : null;
  const publicClient = enabled
    ? createPublicClient({ chain, transport: http(rpcUrl) })
    : null;
  const walletClient = relayerEnabled
    ? createWalletClient({ account, chain, transport: http(rpcUrl) })
    : null;
  return {
    enabled,
    relayerEnabled,
    status() {
      return {
        enabled,
        chainId,
        chainName: chain.name,
        assetAddress: contractAddress || null,
        marketplaceAddress: marketplaceAddress || null,
        explorerUrl: explorerUrl || null,
        relayerAddress: account?.address || null,
        relayerEnabled,
        mode: enabled ? "evm" : "disabled",
      };
    },
    async submit(operation) {
      if (!relayerEnabled)
        throw new Error("Public-chain relayer is not configured");
      const payload = operation.payload;
      let functionName, args;
      if (operation.operationType === "ISSUE_CONTAINER_TOKEN") {
        functionName = "issueContainerToken";
        args = [
          containerKey(payload.containerId),
          containerTokenId(payload.containerId),
          BigInt(payload.supply),
          payload.recipient,
        ];
      } else if (operation.operationType === "ANCHOR_SENSOR_BATCH") {
        functionName = "anchorSensorBatch";
        args = [
          containerKey(payload.containerId),
          payload.merkleRoot,
          BigInt(Math.floor(new Date(payload.fromTimestamp).getTime() / 1000)),
          BigInt(Math.floor(new Date(payload.toTimestamp).getTime() / 1000)),
          Number(payload.readingCount),
        ];
      } else
        throw new Error(`Unsupported operation: ${operation.operationType}`);
      const hash = await walletClient.writeContract({
        address: contractAddress,
        abi: assetAbi,
        functionName,
        args,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: Number(env.PUBLIC_CHAIN_CONFIRMATIONS || 2),
      });
      if (receipt.status !== "success")
        throw new Error("Public-chain transaction reverted");
      return { txHash: hash, blockNumber: Number(receipt.blockNumber) };
    },
    async confirmMarketplaceTransaction(hash) {
      if (!enabled || !marketplaceAddress)
        throw new Error("퍼블릭 거래소가 설정되지 않았습니다.");
      const receipt = await publicClient.waitForTransactionReceipt({
        hash,
        confirmations: Number(env.PUBLIC_CHAIN_CONFIRMATIONS || 2),
      });
      if (
        receipt.status !== "success" ||
        receipt.to?.toLowerCase() !== marketplaceAddress.toLowerCase()
      )
        throw new Error("거래소 트랜잭션이 성공하지 않았습니다.");
      const events = parseEventLogs({
        abi: marketplaceAbi,
        logs: receipt.logs,
        strict: true,
      });
      if (events.length !== 1)
        throw new Error("GREEN LINK 거래소 이벤트를 확인할 수 없습니다.");
      const event = events[0];
      const args = Object.fromEntries(
        Object.entries(event.args).map(([key, value]) => [
          key,
          typeof value === "bigint" ? value.toString() : value,
        ]),
      );
      return {
        txHash: hash,
        blockNumber: Number(receipt.blockNumber),
        eventName: event.eventName,
        args,
      };
    },
  };
}

export async function processNextChainOperation(store, chain) {
  const { db } = store;
  const row = db
    .prepare(
      "SELECT * FROM public_chain_operations WHERE status IN ('pending','failed') AND attempts < 5 ORDER BY created_at LIMIT 1",
    )
    .get();
  if (!row) return null;
  const timestamp = new Date().toISOString();
  db.prepare(
    "UPDATE public_chain_operations SET status='submitting',attempts=attempts+1,error_message=NULL,updated_at=? WHERE id=?",
  ).run(timestamp, row.id);
  const operation = {
    id: row.id,
    operationType: row.operation_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    payload: JSON.parse(row.payload_json),
  };
  try {
    const receipt = await chain.submit(operation);
    db.prepare(
      "UPDATE public_chain_operations SET status='confirmed',tx_hash=?,block_number=?,updated_at=? WHERE id=?",
    ).run(
      receipt.txHash,
      receipt.blockNumber,
      new Date().toISOString(),
      row.id,
    );
    store.appendBlock(
      "PUBLIC_CHAIN_CONFIRMED",
      row.entity_type,
      row.entity_id,
      { operationId: row.id, operationType: row.operation_type, ...receipt },
    );
    return { ...operation, status: "confirmed", ...receipt };
  } catch (error) {
    db.prepare(
      "UPDATE public_chain_operations SET status='failed',error_message=?,updated_at=? WHERE id=?",
    ).run(
      String(error.message || error).slice(0, 500),
      new Date().toISOString(),
      row.id,
    );
    return {
      ...operation,
      status: "failed",
      error: String(error.message || error),
    };
  }
}
