import { describe, expect, it } from "vitest";
import { createStore } from "./store.js";
import {
  containerKey,
  containerTokenId,
  merkleRoot,
  processNextChainOperation,
} from "./public-chain.js";

describe("public-chain hybrid layer", () => {
  it("derives deterministic container identifiers and Merkle roots", () => {
    expect(containerTokenId("a-01")).toBe(containerTokenId("a-01"));
    expect(containerKey("a-01")).toMatch(/^0x[0-9a-f]{64}$/);
    const records = [
      { id: "1", value: 24.1 },
      { id: "2", value: 24.2 },
    ];
    expect(merkleRoot(records)).toBe(merkleRoot(records));
    expect(merkleRoot(records)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("processes an outbox operation and records public confirmation", async () => {
    const store = createStore(":memory:");
    const operation = store.enqueueChainOperation(
      "ANCHOR_SENSOR_BATCH",
      "sensor_batch",
      "batch-1",
      {
        containerId: "a-01",
        merkleRoot: `0x${"11".repeat(32)}`,
        fromTimestamp: "2026-01-01T00:00:00.000Z",
        toTimestamp: "2026-01-01T00:01:00.000Z",
        readingCount: 2,
      },
    );
    const chain = {
      enabled: true,
      submit: async () => ({
        txHash: `0x${"22".repeat(32)}`,
        blockNumber: 123,
      }),
    };
    const result = await processNextChainOperation(store, chain);
    expect(result).toMatchObject({
      id: operation.id,
      status: "confirmed",
      blockNumber: 123,
    });
    expect(
      store.db
        .prepare(
          "SELECT status,tx_hash FROM public_chain_operations WHERE id=?",
        )
        .get(operation.id),
    ).toMatchObject({ status: "confirmed", tx_hash: `0x${"22".repeat(32)}` });
    expect(store.verifyBlockchain().valid).toBe(true);
    store.close();
  });
});
