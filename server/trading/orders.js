import { randomUUID } from "node:crypto";
import { fail, getContainerByToken, getUser, now, quantityLimitMessage, requireTradingNumbers, text } from "./shared.js";
import {
  applyPositionDelta,
  creditHolding,
  debitHolding,
  readIdempotent,
  saveIdempotent,
  writeCreditLedger,
  writeTokenLedger,
} from "./ledger.js";

// Legacy "orders" table sell listings, mirrored into token_orders (the
// canonical order-book table) so buy-side matching in book.js can treat both
// uniformly. Kept as its own table because the public marketplace views
// (containers, farms) still read it directly.

export const listPublicSellOrders = (db, { query = "" } = {}) =>
  db
    .prepare(
      "SELECT * FROM orders WHERE status='판매중' AND (?='' OR lower(token_id||' '||seller_name) LIKE '%'||?||'%') ORDER BY created_at DESC",
    )
    .all(text(query, 80).toLowerCase(), text(query, 80).toLowerCase());

export const ensureSellTokenOrder = (db, order) =>
  db
    .prepare(
      `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,?,?,?) ON CONFLICT DO NOTHING`,
    )
    .run(
      order.id,
      order.seller_id,
      order.token_id,
      order.container_id,
      "SELL",
      "LIMIT",
      order.unit_price,
      order.original_quantity || order.quantity || 1,
      order.quantity,
      order.idempotency_key || null,
      order.id,
      order.created_at,
      order.updated_at,
    );

export const updateSellTokenOrder = async (db, legacyOrderId, quantity, timestamp) => {
  const result = await db
    .prepare(
      `UPDATE token_orders
          SET remaining_quantity=remaining_quantity-?,
              status=CASE
                WHEN remaining_quantity-?=0 THEN 'filled'
                ELSE 'partially_filled'
              END,
              updated_at=?
        WHERE legacy_order_id=?
          AND side='SELL'
          AND status IN ('open','partially_filled')
          AND remaining_quantity>=?`,
    )
    .run(quantity, quantity, timestamp, legacyOrderId, quantity);
  if (Number(result.changes) !== 1)
    throw fail("남은 판매 수량이 부족합니다.", 409);
};

export const placeSellOrder = async (
  db,
  store,
  { userId, tokenId, quantity, unitPrice, key },
) => {
  if (!tokenId) throw fail("토큰을 선택해 주세요.");
  requireTradingNumbers({ quantity, unitPrice });
  const scope = `sell:${tokenId}`;
  const cached = await readIdempotent(db, userId, scope, key);
  if (cached)
    return {
      status: cached.response_status,
      body: JSON.parse(cached.response_json),
    };

  return store.transaction(async () => {
    const cachedInside = await readIdempotent(db, userId, scope, key);
    if (cachedInside)
      return {
        status: cachedInside.response_status,
        body: JSON.parse(cachedInside.response_json),
      };
    const seller = await getUser(db, userId);
    const container = await getContainerByToken(db, tokenId);
    if (!seller || !container)
      throw fail("보유 수량과 판매 정보를 확인해 주세요.");
    await debitHolding(db, userId, tokenId, quantity);
    const createdAt = now();
    await applyPositionDelta(db, {
      userId,
      tokenId,
      containerId: container.id,
      available: -quantity,
      reserved: quantity,
      createdAt,
    });
    const order = {
      id: randomUUID(),
      sellerId: userId,
      tokenId,
      containerId: container.id,
      sellerName: seller.name,
      quantity,
      originalQuantity: quantity,
      remainingQuantity: quantity,
      unitPrice,
      status: "판매중",
      createdAt,
      updatedAt: createdAt,
    };
    await db
      .prepare(
        "INSERT INTO orders (id,seller_id,token_id,container_id,seller_name,quantity,unit_price,status,created_at,updated_at,original_quantity,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(
        order.id,
        userId,
        tokenId,
        container.id,
        seller.name,
        quantity,
        unitPrice,
        "판매중",
        createdAt,
        createdAt,
        quantity,
        key || null,
      );
    await db
      .prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,?,?,?)`,
      )
      .run(
        order.id,
        userId,
        tokenId,
        container.id,
        "SELL",
        "LIMIT",
        unitPrice,
        quantity,
        quantity,
        key || null,
        order.id,
        createdAt,
        createdAt,
      );
    await writeTokenLedger(db, {
      userId,
      tokenId,
      bucket: "available",
      direction: "DEBIT",
      quantity,
      reason: "RESERVE",
      createdAt,
    });
    await writeTokenLedger(db, {
      userId,
      tokenId,
      bucket: "reserved",
      direction: "CREDIT",
      quantity,
      reason: "RESERVE",
      createdAt,
    });
    await store.appendBlock("TOKEN_LISTING", "order", order.id, {
      sellerId: userId,
      tokenId,
      containerId: container.id,
      quantity,
      unitPrice,
    });
    await store.audit(userId, "CREATE_SELL_ORDER", "order", order.id, {
      quantity,
      unitPrice,
    });
    await saveIdempotent(db, userId, scope, key, 201, order);
    return { status: 201, body: order };
  });
};

export const purchaseSellOrder = async (
  db,
  store,
  { buyerId, orderId, quantity, key },
) => {
  const scope = `purchase:${orderId}`;
  const cached = await readIdempotent(db, buyerId, scope, key);
  if (cached)
    return {
      status: cached.response_status,
      body: JSON.parse(cached.response_json),
    };

  return store.transaction(async () => {
    const cachedInside = await readIdempotent(db, buyerId, scope, key);
    if (cachedInside)
      return {
        status: cachedInside.response_status,
        body: JSON.parse(cachedInside.response_json),
      };
    const order = await db
      .prepare("SELECT * FROM orders WHERE id=? AND status='판매중'")
      .get(orderId);
    if (!order) throw fail("ORDER_NOT_FOUND", 404);
    await ensureSellTokenOrder(db, order);
    if (!quantity) throw fail(quantityLimitMessage);
    if (quantity > order.quantity)
      throw fail(`구매 수량은 1~${order.quantity}개여야 합니다.`);
    if (order.seller_id === buyerId)
      throw fail("자신의 판매 주문은 구매할 수 없습니다.", 409);
    const buyer = await getUser(db, buyerId);
    const amount = requireTradingNumbers({
      quantity,
      unitPrice: order.unit_price,
    });
    if (!buyer || buyer.credit_balance < amount)
      throw fail("개발용 모의 크레딧이 부족합니다.", 402);
    const timestamp = now();
    const updatedOrder = await db
      .prepare(
        "UPDATE orders SET quantity=quantity-?,status=CASE WHEN quantity-?=0 THEN '거래완료' ELSE '판매중' END,updated_at=? WHERE id=? AND status='판매중' AND quantity>=?",
      )
      .run(quantity, quantity, timestamp, order.id, quantity);
    if (Number(updatedOrder.changes) !== 1)
      throw fail("남은 판매 수량이 부족합니다.", 409);
    await updateSellTokenOrder(db, order.id, quantity, timestamp);
    const debitedBuyer = await db
      .prepare(
        "UPDATE users SET credit_balance=credit_balance-?,updated_at=? WHERE id=? AND credit_balance>=?",
      )
      .run(amount, timestamp, buyerId, amount);
    if (Number(debitedBuyer.changes) !== 1)
      throw fail("개발용 모의 크레딧이 부족합니다.", 402);
    await db
      .prepare(
        "UPDATE users SET credit_balance=credit_balance+?,updated_at=? WHERE id=?",
      )
      .run(amount, timestamp, order.seller_id);
    await creditHolding(
      db,
      buyerId,
      order.token_id,
      order.container_id,
      quantity,
      order.unit_price,
    );
    await applyPositionDelta(db, {
      userId: order.seller_id,
      tokenId: order.token_id,
      containerId: order.container_id,
      reserved: -quantity,
      settled: -quantity,
      createdAt: timestamp,
    });
    await applyPositionDelta(db, {
      userId: buyerId,
      tokenId: order.token_id,
      containerId: order.container_id,
      available: quantity,
      settled: quantity,
      createdAt: timestamp,
    });
    const buyOrderId = randomUUID();
    await db
      .prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,0,'filled','INTERNAL',NULL,?,NULL,?,?)`,
      )
      .run(
        buyOrderId,
        buyerId,
        order.token_id,
        order.container_id,
        "BUY",
        "LIMIT",
        order.unit_price,
        quantity,
        key || null,
        timestamp,
        timestamp,
      );
    const executionId = randomUUID();
    const settlementId = randomUUID();
    await db
      .prepare("INSERT INTO token_executions VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(
        executionId,
        buyOrderId,
        order.id,
        buyerId,
        order.seller_id,
        order.token_id,
        quantity,
        order.unit_price,
        null,
        timestamp,
      );
    await db
      .prepare("INSERT INTO settlements VALUES (?,?,?,?,?,?,?,?)")
      .run(
        settlementId,
        executionId,
        "confirmed",
        "confirmed",
        "confirmed",
        null,
        timestamp,
        timestamp,
      );
    await writeCreditLedger(db, {
      userId: buyerId,
      direction: "DEBIT",
      amount,
      reason: "PURCHASE",
      executionId,
      settlementId,
      createdAt: timestamp,
    });
    await writeCreditLedger(db, {
      userId: order.seller_id,
      direction: "CREDIT",
      amount,
      reason: "SALE",
      executionId,
      settlementId,
      createdAt: timestamp,
    });
    for (const entry of [
      {
        userId: order.seller_id,
        tokenId: order.token_id,
        bucket: "reserved",
        direction: "DEBIT",
        reason: "SALE",
      },
      {
        userId: order.seller_id,
        tokenId: order.token_id,
        bucket: "settled",
        direction: "DEBIT",
        reason: "SALE",
      },
      {
        userId: buyerId,
        tokenId: order.token_id,
        bucket: "available",
        direction: "CREDIT",
        reason: "PURCHASE",
      },
      {
        userId: buyerId,
        tokenId: order.token_id,
        bucket: "settled",
        direction: "CREDIT",
        reason: "PURCHASE",
      },
    ])
      await writeTokenLedger(db, {
        ...entry,
        quantity,
        executionId,
        settlementId,
        createdAt: timestamp,
      });
    const transaction = {
      id: randomUUID(),
      userId: buyerId,
      type: "구매",
      tokenId: order.token_id,
      quantity,
      unitPrice: order.unit_price,
      createdAt: timestamp,
    };
    await db
      .prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)")
      .run(
        transaction.id,
        transaction.userId,
        transaction.type,
        transaction.tokenId,
        transaction.quantity,
        transaction.unitPrice,
        transaction.createdAt,
      );
    const sellerTransactionId = randomUUID();
    await db
      .prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)")
      .run(
        sellerTransactionId,
        order.seller_id,
        "판매",
        order.token_id,
        quantity,
        order.unit_price,
        timestamp,
      );
    const response = {
      ...transaction,
      sellerTransactionId,
      buyOrderId,
      executionId,
      settlementId,
      remainingQuantity: order.quantity - quantity,
    };
    await store.appendBlock("TOKEN_PURCHASE", "transaction", transaction.id, {
      buyerId,
      sellerId: order.seller_id,
      buyOrderId,
      orderId: order.id,
      executionId,
      settlementId,
      tokenId: order.token_id,
      quantity,
      unitPrice: order.unit_price,
      totalAmount: amount,
    });
    await store.audit(buyerId, "PURCHASE", "order", order.id, { quantity });
    await saveIdempotent(db, buyerId, scope, key, 201, response);
    return { status: 201, body: response };
  });
};

export const cancelSellOrder = (db, store, { userId, orderId }) =>
  store.transaction(async () => {
    const order = await db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
    if (!order || order.status !== "판매중")
      throw fail("취소할 판매 주문을 찾을 수 없습니다.", 404);
    if (order.seller_id !== userId)
      throw fail("본인의 판매 주문만 취소할 수 있습니다.", 403);
    await ensureSellTokenOrder(db, order);
    const timestamp = now();
    await creditHolding(
      db,
      userId,
      order.token_id,
      order.container_id,
      order.quantity,
      order.unit_price,
    );
    await db
      .prepare("UPDATE orders SET status='취소',updated_at=? WHERE id=?")
      .run(timestamp, order.id);
    await db
      .prepare(
        "UPDATE token_orders SET status='cancelled',remaining_quantity=0,updated_at=? WHERE legacy_order_id=?",
      )
      .run(timestamp, order.id);
    if (order.quantity > 0) {
      await applyPositionDelta(db, {
        userId,
        tokenId: order.token_id,
        containerId: order.container_id,
        available: order.quantity,
        reserved: -order.quantity,
        createdAt: timestamp,
      });
      await writeTokenLedger(db, {
        userId,
        tokenId: order.token_id,
        bucket: "reserved",
        direction: "DEBIT",
        quantity: order.quantity,
        reason: "RELEASE",
        createdAt: timestamp,
      });
      await writeTokenLedger(db, {
        userId,
        tokenId: order.token_id,
        bucket: "available",
        direction: "CREDIT",
        quantity: order.quantity,
        reason: "RELEASE",
        createdAt: timestamp,
      });
    }
    await store.appendBlock("TOKEN_LISTING_CANCELLED", "order", order.id, {
      sellerId: userId,
      tokenId: order.token_id,
      returnedQuantity: order.quantity,
    });
    await store.audit(userId, "CANCEL_SELL_ORDER", "order", order.id, {
      returnedQuantity: order.quantity,
    });
    return { status: 204, body: null };
  });
