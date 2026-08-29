import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { existsSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { resolve } from "node:path";
import express from "express";
import { assertProductionSecrets, config } from "./config.js";
import {
  createPublicChain,
  processNextChainOperation,
} from "./public-chain.js";

assertProductionSecrets();
const port = config.port;
const store = createStore();
const publicChain = createPublicChain();
const app = createApp({ store, publicChain });
const dist = resolve(process.cwd(), "dist");

const isWildcardHost = (host) => ["0.0.0.0", "::", ""].includes(host);
const lanUrls = () =>
  Object.values(networkInterfaces())
    .flat()
    .filter(
      (entry) =>
        entry &&
        entry.family === "IPv4" &&
        !entry.internal &&
        !entry.address.startsWith("169.254."),
    )
    .map((entry) => `http://${entry.address}:${port}`);
const printStartupUrls = () => {
  console.log(`GREEN LINK listening on http://${config.host}:${port}`);
  if (!isWildcardHost(config.host)) return;
  console.log(`Local: http://localhost:${port}`);
  const urls = lanUrls();
  if (urls.length) {
    console.log("LAN URLs for phones and laptops on the same network:");
    for (const url of urls) console.log(`  ${url}`);
  } else {
    console.log("LAN URL not detected. Check your Wi-Fi/Ethernet adapter.");
  }
  console.log(
    "If another device cannot connect, allow Node.js through Windows Defender Firewall on Private networks.",
  );
};

if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}
const server = app.listen(port, config.host, printStartupUrls);
let processing = false;
const timer = setInterval(async () => {
  if (!publicChain.relayerEnabled || processing) return;
  processing = true;
  try {
    await processNextChainOperation(store, publicChain);
  } finally {
    processing = false;
  }
}, 15_000);
const shutdown = () => {
  clearInterval(timer);
  server.close(() => {
    store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
