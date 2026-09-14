import { randomUUID } from "node:crypto";
import { fail, now } from "./shared.js";

// Idempotency-key cache: replays the response of a request that was already
// processed, so retried POSTs (client timeout/retry) don't double-execute.
export const readIdempotent = (db, userId, scope, key) =>
  key
    ? db
        .prepare(
          "SELECT response_status,response_json FROM idempotency_keys WHERE user_id=? AND scope=? AND idempotency_key=?",
        )
        .get(userId, scope, key)
    : null;

export const saveIdempotent = async (db, userId, scope, key, status, body) => {
  if (!key) return;
  const timestamp = now();
  await db
    .prepare(
      "INSERT INTO idempotency_keys VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
    )
    .run(userId, scope, key, status, JSON.stringify(body), timestamp, timestamp);
};

export const writeCreditLedger = (
  db,
  {
    userId,
    direction,
    amount,
    reason,
    executionId = null,
    settlementId = null,
    createdAt = now(),
  },
) =>
  db
    .prepare("INSERT INTO credit_ledger_entries VALUES (?,?,?,?,?,?,?,?)")
    .run(
      randomUUID(),
      userId,
      direction,
      amount,
      reason,
      executionId,
      settlementId,
      createdAt,
    );

export const writeTokenLedger = (
  db,
  {
    userId,
    tokenId,
    bucket,
    direction,
    quantity,
    reason,
    executionId = null,
    settlementId = null,
    createdAt = now(),
  },
) =>
  db
    .prepare("INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(
      randomUUID(),
      userId,
      tokenId,
      bucket,
      direction,
      quantity,
      reason,
      executionId,
      settlementId,
      createdAt,
    );

export const ensurePosition = async (
  db,
  userId,
  tokenId,
  containerId,
  timestamp = now(),
) => {
  await db
    .prepare(
      "INSERT INTO token_positions VALUES (?,?,?,0,0,0,0,?) ON CONFLICT DO NOTHING",
    )
    .run(userId, tokenId, containerId, timestamp);
};

export const applyPositionDelta = async (
  db,
  {
    userId,
    tokenId,
    containerId,
    available = 0,
    reserved = 0,
    unsettled = 0,
    settled = 0,
    createdAt = now(),
  },
) => {
  await ensurePosition(db, userId, tokenId, containerId, createdAt);
  const result = await db
    .prepare(
      `UPDATE token_positions
          SET available_quantity=available_quantity+?,
              reserved_quantity=reserved_quantity+?,
              unsettled_quantity=unsettled_quantity+?,
              settled_quantity=settled_quantity+?,
              updated_at=?
        WHERE user_id=?
          AND token_id=?
          AND available_quantity+? >= 0
          AND reserved_quantity+? >= 0
          AND unsettled_quantity+? >= 0
          AND settled_quantity+? >= 0`,
    )
    .run(
      available,
      reserved,
      unsettled,
      settled,
      createdAt,
      userId,
      tokenId,
      available,
      reserved,
      unsettled,
      settled,
    );
  if (Number(result.changes) !== 1) throw fail("포지션 수량이 부족합니다.", 409);
};

export const creditHolding = async (
  db,
  userId,
  tokenId,
  containerId,
  quantity,
  unitPrice,
) => {
  const holding = await db
    .prepare("SELECT * FROM holdings WHERE user_id=? AND token_id=?")
    .get(userId, tokenId);
  if (!holding) {
    await db
      .prepare("INSERT INTO holdings VALUES (?,?,?,?,?,?)")
      .run(randomUUID(), userId, tokenId, containerId, quantity, unitPrice);
    return;
  }
  const nextQuantity = holding.quantity + quantity;
  const average = nextQuantity
    ? Math.round(
        (holding.average_price * holding.quantity + unitPrice * quantity) /
          nextQuantity,
      )
    : unitPrice;
  await db
    .prepare("UPDATE holdings SET quantity=?,average_price=? WHERE id=?")
    .run(nextQuantity, average, holding.id);
};

export const debitHolding = async (db, userId, tokenId, quantity) => {
  const result = await db
    .prepare(
      "UPDATE holdings SET quantity=quantity-? WHERE user_id=? AND token_id=? AND quantity>=?",
    )
    .run(quantity, userId, tokenId, quantity);
  if (Number(result.changes) !== 1)
    throw fail("판매 가능한 보유 수량이 부족합니다.", 409);
};
