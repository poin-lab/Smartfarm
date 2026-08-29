import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const rpcUrl = required("PUBLIC_CHAIN_RPC_URL"),
  privateKey = required("PUBLIC_CHAIN_RELAYER_PRIVATE_KEY");
const chainId = Number(required("PUBLIC_CHAIN_ID"));
const account = privateKeyToAccount(privateKey);
const chain = {
  id: chainId,
  name: process.env.PUBLIC_CHAIN_NAME || "Configured EVM",
  nativeCurrency: {
    name: "Native",
    symbol: process.env.PUBLIC_CHAIN_CURRENCY || "ETH",
    decimals: 18,
  },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const wallet = createWalletClient({ account, chain, transport: http(rpcUrl) });
const client = createPublicClient({ chain, transport: http(rpcUrl) });
const artifact = (name) =>
  JSON.parse(
    readFileSync(resolve("contracts", "artifacts", `${name}.json`), "utf8"),
  );
const assets = artifact("GreenLinkAssets");
const assetHash = await wallet.deployContract({
  abi: assets.abi,
  bytecode: assets.bytecode,
  args: [
    process.env.PUBLIC_CHAIN_METADATA_URI ||
      "https://example.invalid/green-link/{id}.json",
    account.address,
  ],
});
const assetReceipt = await client.waitForTransactionReceipt({
  hash: assetHash,
});
const market = artifact("GreenLinkMarketplace");
const marketHash = await wallet.deployContract({
  abi: market.abi,
  bytecode: market.bytecode,
  args: [
    assetReceipt.contractAddress,
    account.address,
    account.address,
    Number(process.env.PUBLIC_CHAIN_FEE_BPS || 0),
  ],
});
const marketReceipt = await client.waitForTransactionReceipt({
  hash: marketHash,
});
console.log(
  JSON.stringify(
    {
      chainId,
      deployer: account.address,
      assetAddress: assetReceipt.contractAddress,
      marketplaceAddress: marketReceipt.contractAddress,
    },
    null,
    2,
  ),
);
