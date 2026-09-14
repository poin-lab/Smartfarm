import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import { assertProductionSecrets, config } from "./config.js";
import { anchorPendingExecutions } from "./blockchain/anchor.js";

assertProductionSecrets();
const port = config.port;
const store = createStore();
const app = createApp({ store });
const dist = resolve(process.cwd(), "dist");

if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve(dist, "index.html")));
}
const server = app.listen(port, config.host, () => {
  console.log(`GREEN LINK listening on http://${config.host}:${port}`);
});

// Periodically anchors any unanchored token_executions to the Fabric
// txanchor chaincode (see blockchain/). Off by default so local dev/tests
// that don't have that network running aren't affected.
let anchorInterval;
if (process.env.ENABLE_CHAIN_ANCHOR === "true") {
  const intervalMs = Number(process.env.CHAIN_ANCHOR_INTERVAL_MS) || 30_000;
  anchorInterval = setInterval(async () => {
    try {
      const result = await anchorPendingExecutions(store);
      if (result)
        console.log(
          `Anchored ${result.count} execution(s) -> ${result.batchId} (merkle ${result.merkleRoot})`,
        );
    } catch (error) {
      console.error("Chain anchor run failed:", error.message);
    }
  }, intervalMs);
  anchorInterval.unref();
}

const shutdown = () => {
  clearInterval(anchorInterval);
  server.close(async () => {
    await store.close();
    process.exit(0);
  });
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
