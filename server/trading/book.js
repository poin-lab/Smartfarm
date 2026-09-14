import { randomUUID } from "node:crypto";
import { TRADING_LIMITS, positiveInt } from "./limits.js";
import {
  fail,
  getContainerByToken,
  getUser,
  mapOrder,
  mapPosition,
  now,
  priceLimitMessage,
  quantityLimitMessage,
  requireTradingNumbers,
  text,
} from "./shared.js";
import { readIdempotent, saveIdempotent } from "./ledger.js";
import { placeSellOrder, purchaseSellOrder, cancelSellOrder } from "./orders.js";

export const cancelOrder = async (db, store, { userId, orderId }) => {
  const order = await db.prepare("SELECT * FROM token_orders WHERE id=?").get(orderId);
  if (!order) throw fail("취소할 주문을 찾을 수 없습니다.", 404);
  if (order.user_id !== userId)
    throw fail("본인의 주문만 취소할 수 있습니다.", 403);
  if (order.side === "SELL" && order.legacy_order_id)
    return cancelSellOrder(db, store, { userId, orderId: order.legacy_order_id });
  if (!["open", "partially_filled", "pending"].includes(order.status))
    throw fail("이미 확정된 주문은 취소할 수 없습니다.", 409);
  return store.transaction(async () => {
    const timestamp = now();
    await db
      .prepare(
        "UPDATE token_orders SET status='cancelled',remaining_quantity=0,updated_at=? WHERE id=?",
      )
      .run(timestamp, order.id);
    await store.audit(userId, "CANCEL_TOKEN_ORDER", "token_order", order.id, {
      tokenId: order.token_id,
      remainingQuantity: order.remaining_quantity,
    });
    return { status: 204, body: null };
  });
};

export const placeOrder = async (db, store, { userId, body }) => {
  const side = text(body?.side, 4).toUpperCase();
  const tokenId = text(body?.tokenId || body?.instrumentId, 40);
  const quantity = positiveInt(
    body?.quantity || body?.originalQuantity,
    TRADING_LIMITS.maxQuantity,
  );
  const orderType = text(body?.orderType || "LIMIT", 10).toUpperCase();
  const limitPrice = positiveInt(
    body?.limitPrice || body?.unitPrice,
    TRADING_LIMITS.maxUnitPrice,
  );
  const key = text(body?.idempotencyKey, 160);
  if (side === "SELL")
    return placeSellOrder(db, store, {
      userId,
      tokenId,
      quantity,
      unitPrice: limitPrice,
      key,
    });
  if (side !== "BUY") throw fail("주문 방향은 BUY 또는 SELL이어야 합니다.");
  if (!tokenId) throw fail("토큰을 선택해 주세요.");
  if (!quantity) throw fail(quantityLimitMessage);
  if (orderType === "LIMIT" && !limitPrice) throw fail(priceLimitMessage);
  const sellOrderId = text(body?.sellOrderId, 80);
  const candidate = await (sellOrderId
    ? db.prepare("SELECT * FROM orders WHERE id=? AND status='판매중'").get(sellOrderId)
    : db
        .prepare(
          `SELECT * FROM orders
            WHERE token_id=?
              AND status='판매중'
              AND quantity>=?
              AND (?='MARKET' OR unit_price<=?)
            ORDER BY unit_price ASC, created_at ASC
            LIMIT 1`,
        )
        .get(tokenId, quantity, orderType, limitPrice || 0));
  if (candidate)
    return purchaseSellOrder(db, store, {
      buyerId: userId,
      orderId: candidate.id,
      quantity,
      key,
    });
  if (orderType === "MARKET")
    throw fail("즉시 체결 가능한 판매 주문이 없습니다.", 409);
  const scope = `buy:${tokenId}`;
  const cached = await readIdempotent(db, userId, scope, key);
  if (cached)
    return {
      status: cached.response_status,
      body: JSON.parse(cached.response_json),
    };
  return store.transaction(async () => {
    const container = await getContainerByToken(db, tokenId);
    if (!container) throw fail("토큰을 찾을 수 없습니다.", 404);
    const user = await getUser(db, userId);
    const amount = requireTradingNumbers({ quantity, unitPrice: limitPrice });
    if (user.credit_balance < amount)
      throw fail("개발용 모의 크레딧이 부족합니다.", 402);
    const timestamp = now();
    const orderId = randomUUID();
    await db
      .prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,NULL,?,?)`,
      )
      .run(
        orderId,
        userId,
        tokenId,
        container.id,
        "BUY",
        "LIMIT",
        limitPrice,
        quantity,
        quantity,
        key || null,
        timestamp,
        timestamp,
      );
    const response = mapOrder(
      await db.prepare("SELECT * FROM token_orders WHERE id=?").get(orderId),
    );
    await saveIdempotent(db, userId, scope, key, 201, response);
    return { status: 201, body: response };
  });
};

export const getOrder = async (db, id) =>
  mapOrder(await db.prepare("SELECT * FROM token_orders WHERE id=?").get(id));

export const listOrders = async (db, { userId = "", tokenId = "" } = {}) =>
  (
    await db
      .prepare(
        `SELECT * FROM token_orders
          WHERE (?='' OR user_id=?)
            AND (?='' OR token_id=?)
          ORDER BY created_at DESC
          LIMIT 100`,
      )
      .all(userId, userId, tokenId, tokenId)
  ).map(mapOrder);

export const listExecutions = async (db, { userId = "", tokenId = "" } = {}) =>
  (
    await db
      .prepare(
        `SELECT * FROM token_executions
          WHERE (?='' OR buyer_id=? OR seller_id=?)
            AND (?='' OR token_id=?)
          ORDER BY executed_at DESC
          LIMIT 100`,
      )
      .all(userId, userId, userId, tokenId, tokenId)
  ).map((row) => ({
    id: row.id,
    buyOrderId: row.buy_order_id,
    sellOrderId: row.sell_order_id,
    buyerId: row.buyer_id,
    sellerId: row.seller_id,
    tokenId: row.token_id,
    quantity: row.quantity,
    unitPrice: row.unit_price,
    externalExecutionId: row.external_execution_id,
    executedAt: row.executed_at,
  }));

export const listPositions = async (db, userId) =>
  (
    await db
      .prepare("SELECT * FROM token_positions WHERE user_id=? ORDER BY token_id")
      .all(userId)
  ).map(mapPosition);

export const listInstruments = async (db) =>
  (
    await db
      .prepare(
        `SELECT t.*,c.name,c.crop_name
           FROM container_tokens t JOIN containers c ON c.id=t.container_id
          ORDER BY c.id`,
      )
      .all()
  ).map((row) => ({
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    cropName: row.crop_name,
    assetType: "SMART_FARM_PARTICIPATION_TOKEN",
    issuerId: row.issuer_id,
    currency: "MOCK_KRW",
    totalSupply: row.total_supply,
    initialPrice: row.initial_price,
    executionVenue: row.execution_venue,
    status: row.status,
  }));

export const getQuote = async (db, tokenId) => {
  const row = await db
    .prepare(
      `SELECT
         (SELECT initial_price FROM container_tokens WHERE symbol=?) AS initial_price,
         (SELECT MIN(limit_price) FROM token_orders WHERE token_id=? AND side='SELL' AND status IN ('open','partially_filled') AND remaining_quantity>0) AS lowest_ask,
         (SELECT MAX(limit_price) FROM token_orders WHERE token_id=? AND side='BUY' AND status IN ('open','partially_filled') AND remaining_quantity>0) AS highest_bid,
         (SELECT unit_price FROM token_executions WHERE token_id=? ORDER BY executed_at DESC LIMIT 1) AS last_price,
         (SELECT ROUND(SUM(quantity*unit_price)*1.0/SUM(quantity)) FROM token_executions WHERE token_id=?) AS vwap
       `,
    )
    .get(tokenId, tokenId, tokenId, tokenId, tokenId);
  return {
    tokenId,
    initialPrice: row?.initial_price || 0,
    lowestAsk: row?.lowest_ask || null,
    highestBid: row?.highest_bid || null,
    lastPrice: row?.last_price || null,
    weightedAveragePrice: row?.vwap || null,
  };
};
