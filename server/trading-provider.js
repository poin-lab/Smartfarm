import { createHash, randomUUID } from "node:crypto";

const now = () => new Date().toISOString();
const text = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const positiveInt = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const hash = (value) => createHash("sha256").update(value).digest("hex");

const fail = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

const mapOrder = (row) =>
  row && {
    id: row.id,
    userId: row.user_id,
    tokenId: row.token_id,
    containerId: row.container_id,
    side: row.side,
    orderType: row.order_type,
    limitPrice: row.limit_price,
    originalQuantity: row.original_quantity,
    remainingQuantity: row.remaining_quantity,
    status: row.status,
    executionVenue: row.execution_venue,
    externalOrderId: row.external_order_id,
    idempotencyKey: row.idempotency_key,
    legacyOrderId: row.legacy_order_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

const mapPosition = (row) =>
  row && {
    userId: row.user_id,
    tokenId: row.token_id,
    containerId: row.container_id,
    availableQuantity: row.available_quantity,
    reservedQuantity: row.reserved_quantity,
    unsettledQuantity: row.unsettled_quantity,
    settledQuantity: row.settled_quantity,
    updatedAt: row.updated_at,
  };

export class BrokerTradingProvider {
  constructor({ providerName = "BROKER_SANDBOX" } = {}) {
    this.providerName = providerName;
  }

  capabilities() {
    return {
      provider: this.providerName,
      executionVenue: "BROKER",
      connected: false,
      mode: "sandbox-boundary",
      message:
        "외부 증권사·거래 플랫폼 연동은 계약, 계좌 연결, webhook 서명, reconciliation이 확정된 뒤 adapter에서 활성화합니다.",
    };
  }

  async placeOrder() {
    throw fail("외부 거래 adapter가 아직 연결되지 않았습니다.", 503);
  }
}

export function createInternalTradingProvider({ db, store }) {
  const getUser = (id) =>
    db
      .prepare(
        "SELECT id,name,email,role,phone,wallet_address,credit_balance,status,last_login_at,password_changed_at,created_at,updated_at,password_hash FROM users WHERE id=?",
      )
      .get(id);
  const getContainer = (id) =>
    db.prepare("SELECT * FROM containers WHERE id=?").get(id);
  const getContainerByToken = (tokenId) =>
    db.prepare("SELECT * FROM containers WHERE token_id=?").get(tokenId);

  const readIdempotent = (userId, scope, key) =>
    key
      ? db
          .prepare(
            "SELECT response_status,response_json FROM idempotency_keys WHERE user_id=? AND scope=? AND idempotency_key=?",
          )
          .get(userId, scope, key)
      : null;

  const saveIdempotent = (userId, scope, key, status, body) => {
    if (!key) return;
    const timestamp = now();
    db.prepare(
      "INSERT OR IGNORE INTO idempotency_keys VALUES (?,?,?,?,?,?,?)",
    ).run(
      userId,
      scope,
      key,
      status,
      JSON.stringify(body),
      timestamp,
      timestamp,
    );
  };

  const writeCreditLedger = ({
    userId,
    direction,
    amount,
    reason,
    executionId = null,
    settlementId = null,
    createdAt = now(),
  }) =>
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

  const writeTokenLedger = ({
    userId,
    tokenId,
    bucket,
    direction,
    quantity,
    reason,
    executionId = null,
    settlementId = null,
    createdAt = now(),
  }) =>
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

  const ensurePosition = (userId, tokenId, containerId, timestamp = now()) => {
    db.prepare(
      "INSERT OR IGNORE INTO token_positions VALUES (?,?,?,0,0,0,0,?)",
    ).run(userId, tokenId, containerId, timestamp);
  };

  const applyPositionDelta = ({
    userId,
    tokenId,
    containerId,
    available = 0,
    reserved = 0,
    unsettled = 0,
    settled = 0,
    createdAt = now(),
  }) => {
    ensurePosition(userId, tokenId, containerId, createdAt);
    const result = db
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
    if (Number(result.changes) !== 1)
      throw fail("포지션 수량이 부족합니다.", 409);
  };

  const creditHolding = (userId, tokenId, containerId, quantity, unitPrice) => {
    const holding = db
      .prepare("SELECT * FROM holdings WHERE user_id=? AND token_id=?")
      .get(userId, tokenId);
    if (!holding) {
      db.prepare("INSERT INTO holdings VALUES (?,?,?,?,?,?)").run(
        randomUUID(),
        userId,
        tokenId,
        containerId,
        quantity,
        unitPrice,
      );
      return;
    }
    const nextQuantity = holding.quantity + quantity;
    const average = nextQuantity
      ? Math.round(
          (holding.average_price * holding.quantity + unitPrice * quantity) /
            nextQuantity,
        )
      : unitPrice;
    db.prepare("UPDATE holdings SET quantity=?,average_price=? WHERE id=?").run(
      nextQuantity,
      average,
      holding.id,
    );
  };

  const debitHolding = (userId, tokenId, quantity) => {
    const result = db
      .prepare(
        "UPDATE holdings SET quantity=quantity-? WHERE user_id=? AND token_id=? AND quantity>=?",
      )
      .run(quantity, userId, tokenId, quantity);
    if (Number(result.changes) !== 1)
      throw fail("판매 가능한 보유 수량이 부족합니다.", 409);
  };

  const ensureSellTokenOrder = (order) => {
    db.prepare(
      `INSERT OR IGNORE INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,?,?,?)`,
    ).run(
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
  };

  const updateSellTokenOrder = (legacyOrderId, quantity, timestamp) => {
    const result = db
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

  const listPublicSellOrders = ({ query = "" } = {}) =>
    db
      .prepare(
        "SELECT * FROM orders WHERE status='판매중' AND (?='' OR lower(token_id||' '||seller_name) LIKE '%'||?||'%') ORDER BY created_at DESC",
      )
      .all(text(query, 80).toLowerCase(), text(query, 80).toLowerCase());

  const placeSellOrder = ({ userId, tokenId, quantity, unitPrice, key }) => {
    const scope = `sell:${tokenId}`;
    const cached = readIdempotent(userId, scope, key);
    if (cached)
      return {
        status: cached.response_status,
        body: JSON.parse(cached.response_json),
      };

    return store.transaction(() => {
      const cachedInside = readIdempotent(userId, scope, key);
      if (cachedInside)
        return {
          status: cachedInside.response_status,
          body: JSON.parse(cachedInside.response_json),
        };
      const seller = getUser(userId);
      const container = getContainerByToken(tokenId);
      if (!seller || !container || !quantity || !unitPrice)
        throw fail("보유 수량과 판매 정보를 확인해 주세요.");
      debitHolding(userId, tokenId, quantity);
      const createdAt = now();
      applyPositionDelta({
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
      db.prepare(
        "INSERT INTO orders (id,seller_id,token_id,container_id,seller_name,quantity,unit_price,status,created_at,updated_at,original_quantity,idempotency_key) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
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
      db.prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,?,?,?)`,
      ).run(
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
      writeTokenLedger({
        userId,
        tokenId,
        bucket: "available",
        direction: "DEBIT",
        quantity,
        reason: "RESERVE",
        createdAt,
      });
      writeTokenLedger({
        userId,
        tokenId,
        bucket: "reserved",
        direction: "CREDIT",
        quantity,
        reason: "RESERVE",
        createdAt,
      });
      store.appendBlock("TOKEN_LISTING", "order", order.id, {
        sellerId: userId,
        tokenId,
        containerId: container.id,
        quantity,
        unitPrice,
      });
      store.audit(userId, "CREATE_SELL_ORDER", "order", order.id, {
        quantity,
        unitPrice,
      });
      saveIdempotent(userId, scope, key, 201, order);
      return { status: 201, body: order };
    });
  };

  const purchaseSellOrder = ({ buyerId, orderId, quantity, key }) => {
    const scope = `purchase:${orderId}`;
    const cached = readIdempotent(buyerId, scope, key);
    if (cached)
      return {
        status: cached.response_status,
        body: JSON.parse(cached.response_json),
      };

    return store.transaction(() => {
      const cachedInside = readIdempotent(buyerId, scope, key);
      if (cachedInside)
        return {
          status: cachedInside.response_status,
          body: JSON.parse(cachedInside.response_json),
        };
      const order = db
        .prepare("SELECT * FROM orders WHERE id=? AND status='판매중'")
        .get(orderId);
      if (!order) throw fail("ORDER_NOT_FOUND", 404);
      ensureSellTokenOrder(order);
      if (!quantity || quantity > order.quantity)
        throw fail(`구매 수량은 1~${order.quantity}개여야 합니다.`);
      if (order.seller_id === buyerId)
        throw fail("자신의 판매 주문은 구매할 수 없습니다.", 409);
      const buyer = getUser(buyerId);
      const amount = order.unit_price * quantity;
      if (!buyer || buyer.credit_balance < amount)
        throw fail("개발용 모의 크레딧이 부족합니다.", 402);
      const timestamp = now();
      const updatedOrder = db
        .prepare(
          "UPDATE orders SET quantity=quantity-?,status=CASE WHEN quantity-?=0 THEN '거래완료' ELSE '판매중' END,updated_at=? WHERE id=? AND status='판매중' AND quantity>=?",
        )
        .run(quantity, quantity, timestamp, order.id, quantity);
      if (Number(updatedOrder.changes) !== 1)
        throw fail("남은 판매 수량이 부족합니다.", 409);
      updateSellTokenOrder(order.id, quantity, timestamp);
      const debitedBuyer = db
        .prepare(
          "UPDATE users SET credit_balance=credit_balance-?,updated_at=? WHERE id=? AND credit_balance>=?",
        )
        .run(amount, timestamp, buyerId, amount);
      if (Number(debitedBuyer.changes) !== 1)
        throw fail("개발용 모의 크레딧이 부족합니다.", 402);
      db.prepare(
        "UPDATE users SET credit_balance=credit_balance+?,updated_at=? WHERE id=?",
      ).run(amount, timestamp, order.seller_id);
      creditHolding(
        buyerId,
        order.token_id,
        order.container_id,
        quantity,
        order.unit_price,
      );
      applyPositionDelta({
        userId: order.seller_id,
        tokenId: order.token_id,
        containerId: order.container_id,
        reserved: -quantity,
        settled: -quantity,
        createdAt: timestamp,
      });
      applyPositionDelta({
        userId: buyerId,
        tokenId: order.token_id,
        containerId: order.container_id,
        available: quantity,
        settled: quantity,
        createdAt: timestamp,
      });
      const buyOrderId = randomUUID();
      db.prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,0,'filled','INTERNAL',NULL,?,NULL,?,?)`,
      ).run(
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
      db.prepare(
        "INSERT INTO token_executions VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(
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
      db.prepare("INSERT INTO settlements VALUES (?,?,?,?,?,?,?,?)").run(
        settlementId,
        executionId,
        "confirmed",
        "confirmed",
        "confirmed",
        null,
        timestamp,
        timestamp,
      );
      writeCreditLedger({
        userId: buyerId,
        direction: "DEBIT",
        amount,
        reason: "PURCHASE",
        executionId,
        settlementId,
        createdAt: timestamp,
      });
      writeCreditLedger({
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
        writeTokenLedger({
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
      db.prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(
        transaction.id,
        transaction.userId,
        transaction.type,
        transaction.tokenId,
        transaction.quantity,
        transaction.unitPrice,
        transaction.createdAt,
      );
      const sellerTransactionId = randomUUID();
      db.prepare("INSERT INTO transactions VALUES (?,?,?,?,?,?,?)").run(
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
      store.appendBlock("TOKEN_PURCHASE", "transaction", transaction.id, {
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
      store.audit(buyerId, "PURCHASE", "order", order.id, { quantity });
      saveIdempotent(buyerId, scope, key, 201, response);
      return { status: 201, body: response };
    });
  };

  const cancelSellOrder = ({ userId, orderId }) =>
    store.transaction(() => {
      const order = db.prepare("SELECT * FROM orders WHERE id=?").get(orderId);
      if (!order || order.status !== "판매중")
        throw fail("취소할 판매 주문을 찾을 수 없습니다.", 404);
      if (order.seller_id !== userId)
        throw fail("본인의 판매 주문만 취소할 수 있습니다.", 403);
      ensureSellTokenOrder(order);
      const timestamp = now();
      creditHolding(
        userId,
        order.token_id,
        order.container_id,
        order.quantity,
        order.unit_price,
      );
      db.prepare("UPDATE orders SET status='취소',updated_at=? WHERE id=?").run(
        timestamp,
        order.id,
      );
      db.prepare(
        "UPDATE token_orders SET status='cancelled',remaining_quantity=0,updated_at=? WHERE legacy_order_id=?",
      ).run(timestamp, order.id);
      if (order.quantity > 0) {
        applyPositionDelta({
          userId,
          tokenId: order.token_id,
          containerId: order.container_id,
          available: order.quantity,
          reserved: -order.quantity,
          createdAt: timestamp,
        });
        writeTokenLedger({
          userId,
          tokenId: order.token_id,
          bucket: "reserved",
          direction: "DEBIT",
          quantity: order.quantity,
          reason: "RELEASE",
          createdAt: timestamp,
        });
        writeTokenLedger({
          userId,
          tokenId: order.token_id,
          bucket: "available",
          direction: "CREDIT",
          quantity: order.quantity,
          reason: "RELEASE",
          createdAt: timestamp,
        });
      }
      store.appendBlock("TOKEN_LISTING_CANCELLED", "order", order.id, {
        sellerId: userId,
        tokenId: order.token_id,
        returnedQuantity: order.quantity,
      });
      store.audit(userId, "CANCEL_SELL_ORDER", "order", order.id, {
        returnedQuantity: order.quantity,
      });
      return { status: 204, body: null };
    });

  const requestIssuance = ({
    userId,
    containerId,
    supply,
    price,
    terms = {},
  }) =>
    store.transaction(() => {
      const container = getContainer(containerId);
      if (!container) throw fail("컨테이너를 찾을 수 없습니다.", 404);
      const farm = db
        .prepare("SELECT * FROM farms WHERE id=?")
        .get(container.farm_id);
      if (farm.owner_id !== userId)
        throw fail("농장주만 발행 신청할 수 있습니다.", 403);
      if (!supply || !price) throw fail("발행량과 초기 가격을 확인해 주세요.");
      if (container.total_token_supply > 0)
        throw fail("이미 토큰이 발행된 컨테이너입니다.", 409);
      const timestamp = now();
      const termsJson = JSON.stringify({
        mockPayment: true,
        ownership:
          "토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지 않습니다.",
        ...terms,
      });
      db.prepare(
        `INSERT INTO container_tokens (id,container_id,issuer_id,symbol,total_supply,initial_price,status,terms_json,terms_hash,execution_venue,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'requested',?,?,'INTERNAL',?,?)
         ON CONFLICT(container_id) DO UPDATE SET
           issuer_id=excluded.issuer_id,
           total_supply=excluded.total_supply,
           initial_price=excluded.initial_price,
           status='requested',
           terms_json=excluded.terms_json,
           terms_hash=excluded.terms_hash,
           updated_at=excluded.updated_at`,
      ).run(
        container.token_id,
        container.id,
        userId,
        container.token_id,
        supply,
        price,
        termsJson,
        hash(termsJson),
        timestamp,
        timestamp,
      );
      store.audit(userId, "REQUEST_TOKEN_ISSUANCE", "container", container.id, {
        supply,
        price,
      });
      return {
        id: container.token_id,
        containerId: container.id,
        issuerId: userId,
        symbol: container.token_id,
        totalSupply: supply,
        initialPrice: price,
        status: "requested",
        executionVenue: "INTERNAL",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
    });

  const approveIssuance = ({
    approverId,
    containerId,
    supply,
    price,
    queueChainOperation = null,
  }) =>
    store.transaction(() => {
      const container = getContainer(containerId);
      const owner = container
        ? db
            .prepare(
              "SELECT f.owner_id,u.wallet_address FROM containers c JOIN farms f ON f.id=c.farm_id JOIN users u ON u.id=f.owner_id WHERE c.id=?",
            )
            .get(containerId)
        : null;
      if (!container || !owner || !supply || !price)
        throw fail("컨테이너, 발행량, 가격을 확인해 주세요.");
      if (container.total_token_supply > 0)
        throw fail("이미 토큰이 발행된 컨테이너입니다.", 409);
      const timestamp = now();
      const termsJson = JSON.stringify({
        mockPayment: true,
        ownership:
          "토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지 않습니다.",
      });
      db.prepare(
        "UPDATE containers SET total_token_supply=?,available_token_quantity=0,token_price=?,updated_at=? WHERE id=?",
      ).run(supply, price, timestamp, containerId);
      db.prepare(
        `INSERT INTO container_tokens (id,container_id,issuer_id,symbol,total_supply,initial_price,status,terms_json,terms_hash,execution_venue,created_at,updated_at)
         VALUES (?,?,?,?,?,?,'issued',?,?,'INTERNAL',?,?)
         ON CONFLICT(container_id) DO UPDATE SET
           issuer_id=excluded.issuer_id,
           symbol=excluded.symbol,
           total_supply=excluded.total_supply,
           initial_price=excluded.initial_price,
           status='issued',
           terms_json=excluded.terms_json,
           terms_hash=excluded.terms_hash,
           execution_venue=excluded.execution_venue,
           updated_at=excluded.updated_at`,
      ).run(
        container.token_id,
        containerId,
        owner.owner_id,
        container.token_id,
        supply,
        price,
        termsJson,
        hash(termsJson),
        timestamp,
        timestamp,
      );
      creditHolding(
        owner.owner_id,
        container.token_id,
        containerId,
        supply,
        price,
      );
      applyPositionDelta({
        userId: owner.owner_id,
        tokenId: container.token_id,
        containerId,
        available: supply,
        settled: supply,
        createdAt: timestamp,
      });
      writeTokenLedger({
        userId: owner.owner_id,
        tokenId: container.token_id,
        bucket: "available",
        direction: "CREDIT",
        quantity: supply,
        reason: "ISSUE",
        createdAt: timestamp,
      });
      writeTokenLedger({
        userId: owner.owner_id,
        tokenId: container.token_id,
        bucket: "settled",
        direction: "CREDIT",
        quantity: supply,
        reason: "ISSUE",
        createdAt: timestamp,
      });
      store.appendBlock("TOKEN_ISSUANCE", "container", containerId, {
        tokenId: container.token_id,
        supply,
        price,
        issuerId: owner.owner_id,
        approvedBy: approverId,
      });
      store.audit(approverId, "ISSUE_TOKEN", "container", containerId, {
        supply,
        price,
        issuerId: owner.owner_id,
      });
      const publicChainOperation = queueChainOperation
        ? queueChainOperation({ container, owner, supply, price })
        : null;
      return {
        id: container.token_id,
        containerId,
        issuerId: owner.owner_id,
        symbol: container.token_id,
        totalSupply: supply,
        initialPrice: price,
        status: "issued",
        executionVenue: "INTERNAL",
        publicChainOperation,
        updatedAt: timestamp,
      };
    });

  const cancelOrder = ({ userId, orderId }) => {
    const order = db
      .prepare("SELECT * FROM token_orders WHERE id=?")
      .get(orderId);
    if (!order) throw fail("취소할 주문을 찾을 수 없습니다.", 404);
    if (order.user_id !== userId)
      throw fail("본인의 주문만 취소할 수 있습니다.", 403);
    if (order.side === "SELL" && order.legacy_order_id)
      return cancelSellOrder({ userId, orderId: order.legacy_order_id });
    if (!["open", "partially_filled", "pending"].includes(order.status))
      throw fail("이미 확정된 주문은 취소할 수 없습니다.", 409);
    return store.transaction(() => {
      const timestamp = now();
      db.prepare(
        "UPDATE token_orders SET status='cancelled',remaining_quantity=0,updated_at=? WHERE id=?",
      ).run(timestamp, order.id);
      store.audit(userId, "CANCEL_TOKEN_ORDER", "token_order", order.id, {
        tokenId: order.token_id,
        remainingQuantity: order.remaining_quantity,
      });
      return { status: 204, body: null };
    });
  };

  const placeOrder = ({ userId, body }) => {
    const side = text(body?.side, 4).toUpperCase();
    const tokenId = text(body?.tokenId || body?.instrumentId, 40);
    const quantity = positiveInt(body?.quantity || body?.originalQuantity);
    const orderType = text(body?.orderType || "LIMIT", 10).toUpperCase();
    const limitPrice = positiveInt(body?.limitPrice || body?.unitPrice);
    const key = text(body?.idempotencyKey, 160);
    if (side === "SELL")
      return placeSellOrder({
        userId,
        tokenId,
        quantity,
        unitPrice: limitPrice,
        key,
      });
    if (side !== "BUY") throw fail("주문 방향은 BUY 또는 SELL이어야 합니다.");
    if (!tokenId || !quantity || (orderType === "LIMIT" && !limitPrice))
      throw fail("매수 주문 정보를 확인해 주세요.");
    const sellOrderId = text(body?.sellOrderId, 80);
    const candidate = sellOrderId
      ? db
          .prepare("SELECT * FROM orders WHERE id=? AND status='판매중'")
          .get(sellOrderId)
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
          .get(tokenId, quantity, orderType, limitPrice || 0);
    if (candidate)
      return purchaseSellOrder({
        buyerId: userId,
        orderId: candidate.id,
        quantity,
        key,
      });
    if (orderType === "MARKET")
      throw fail("즉시 체결 가능한 판매 주문이 없습니다.", 409);
    const scope = `buy:${tokenId}`;
    const cached = readIdempotent(userId, scope, key);
    if (cached)
      return {
        status: cached.response_status,
        body: JSON.parse(cached.response_json),
      };
    return store.transaction(() => {
      const container = getContainerByToken(tokenId);
      if (!container) throw fail("토큰을 찾을 수 없습니다.", 404);
      const user = getUser(userId);
      if (user.credit_balance < limitPrice * quantity)
        throw fail("개발용 모의 크레딧이 부족합니다.", 402);
      const timestamp = now();
      const orderId = randomUUID();
      db.prepare(
        `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,'open','INTERNAL',NULL,?,NULL,?,?)`,
      ).run(
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
        db.prepare("SELECT * FROM token_orders WHERE id=?").get(orderId),
      );
      saveIdempotent(userId, scope, key, 201, response);
      return { status: 201, body: response };
    });
  };

  return Object.freeze({
    name: "InternalTradingProvider",
    executionVenue: "INTERNAL",
    listPublicSellOrders,
    placeSellOrder,
    purchaseSellOrder,
    cancelSellOrder,
    cancelOrder,
    requestIssuance,
    approveIssuance,
    placeOrder,
    getOrder(id) {
      return mapOrder(
        db.prepare("SELECT * FROM token_orders WHERE id=?").get(id),
      );
    },
    listOrders({ userId = "", tokenId = "" } = {}) {
      return db
        .prepare(
          `SELECT * FROM token_orders
            WHERE (?='' OR user_id=?)
              AND (?='' OR token_id=?)
            ORDER BY created_at DESC
            LIMIT 100`,
        )
        .all(userId, userId, tokenId, tokenId)
        .map(mapOrder);
    },
    listExecutions({ userId = "", tokenId = "" } = {}) {
      return db
        .prepare(
          `SELECT * FROM token_executions
            WHERE (?='' OR buyer_id=? OR seller_id=?)
              AND (?='' OR token_id=?)
            ORDER BY executed_at DESC
            LIMIT 100`,
        )
        .all(userId, userId, userId, tokenId, tokenId)
        .map((row) => ({
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
    },
    listPositions(userId) {
      return db
        .prepare(
          "SELECT * FROM token_positions WHERE user_id=? ORDER BY token_id",
        )
        .all(userId)
        .map(mapPosition);
    },
    listInstruments() {
      return db
        .prepare(
          `SELECT t.*,c.name,c.crop_name
             FROM container_tokens t JOIN containers c ON c.id=t.container_id
            ORDER BY c.id`,
        )
        .all()
        .map((row) => ({
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
    },
    getQuote(tokenId) {
      const row = db
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
    },
  });
}
