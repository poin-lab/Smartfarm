import solc from "solc";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = Object.fromEntries(
  ["GreenLinkAssets.sol", "GreenLinkMarketplace.sol"].map((name) => [
    name,
    { content: readFileSync(resolve(root, "contracts", name), "utf8") },
  ]),
);
const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"],
      },
    },
  },
};
const findImports = (path) => {
  try {
    return {
      contents: readFileSync(resolve(root, "node_modules", path), "utf8"),
    };
  } catch {
    return { error: `Import not found: ${path}` };
  }
};
const output = JSON.parse(
  solc.compile(JSON.stringify(input), { import: findImports }),
);
const errors = (output.errors || []).filter(
  (item) => item.severity === "error",
);
if (errors.length)
  throw new Error(errors.map((item) => item.formattedMessage).join("\n"));
const artifacts = resolve(root, "contracts", "artifacts");
mkdirSync(artifacts, { recursive: true });
for (const [sourceName, contracts] of Object.entries(output.contracts))
  for (const [contractName, artifact] of Object.entries(contracts)) {
    if (!sourceName.startsWith("GreenLink")) continue;
    writeFileSync(
      resolve(artifacts, `${contractName}.json`),
      `${JSON.stringify(
        {
          contractName,
          sourceName,
          abi: artifact.abi,
          bytecode: `0x${artifact.evm.bytecode.object}`,
          deployedBytecode: `0x${artifact.evm.deployedBytecode.object}`,
        },
        null,
        2,
      )}\n`,
    );
  }
console.log("Compiled GREEN LINK contracts successfully.");
