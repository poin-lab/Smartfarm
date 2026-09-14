import { createHash, randomUUID } from "node:crypto";
import { submitBatch } from "./client.js";

const now = () => new Date().toISOString();
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Must match the Go chaincode's verifyIntegrity exactly: same field set,
// alphabetically-sorted keys (what Go's json.Marshal does for a map), no
// extra whitespace.
const cerHash = (execution) => {
  const fields = {
    buyer_id: execution.buyer_id,
    executed_at: execution.executed_at,
    execution_id: execution.id,
    quantity: execution.quantity,
    seller_id: execution.seller_id,
    token_id: execution.token_id,
    unit_price: execution.unit_price,
  };
  return sha256(JSON.stringify(fields));
};

// Batches every not-yet-anchored token_execution, submits it to the Fabric
// txanchor chaincode as one Merkle-rooted entry, and records the result.
// Returns null when there is nothing pending.
export async function anchorPendingExecutions(store, { limit = 200 } = {}) {
  const { db } = store;
  const pending = await db
    .prepare(
      "SELECT id,token_id,buyer_id,seller_id,quantity,unit_price,executed_at FROM token_executions WHERE anchored_batch_id IS NULL ORDER BY executed_at LIMIT ?",
    )
    .all(limit);
  if (!pending.length) return null;

  const items = pending.map((execution) => ({
    execution_id: execution.id,
    token_id: execution.token_id,
    buyer_id: execution.buyer_id,
    seller_id: execution.seller_id,
    quantity: execution.quantity,
    unit_price: execution.unit_price,
    executed_at: execution.executed_at,
    cer_hash: cerHash(execution),
  }));

  const batchId = `batch-${randomUUID()}`;
  const operation = await store.enqueueChainOperation(
    "TX_ANCHOR",
    "transaction_anchor_batch",
    batchId,
    { executionIds: pending.map((execution) => execution.id) },
  );

  let record;
  try {
    record = await submitBatch(items);
  } catch (error) {
    await db
      .prepare(
        "UPDATE public_chain_operations SET status='failed',attempts=attempts+1,error_message=?,updated_at=? WHERE id=?",
      )
      .run(String(error.message || error), now(), operation.id);
    throw error;
  }

  const timestamp = now();
  await store.transaction(async () => {
    await db
      .prepare(
        "UPDATE public_chain_operations SET status='confirmed',tx_hash=?,block_number=?,attempts=attempts+1,updated_at=? WHERE id=?",
      )
      .run(record.tx_id, record.block_number, timestamp, operation.id);
    await db
      .prepare(
        "INSERT INTO transaction_anchor_batches (id,from_execution_id,to_execution_id,execution_count,merkle_root,operation_id,created_at) VALUES (?,?,?,?,?,?,?)",
      )
      .run(
        batchId,
        pending[0].id,
        pending[pending.length - 1].id,
        pending.length,
        record.merkle_root,
        operation.id,
        timestamp,
      );
    for (const execution of pending)
      await db
        .prepare("UPDATE token_executions SET anchored_batch_id=? WHERE id=?")
        .run(batchId, execution.id);
  });

  return {
    batchId,
    merkleRoot: record.merkle_root,
    blockNumber: record.block_number,
    count: pending.length,
  };
}
