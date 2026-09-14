import { fail, getContainer, hash, now, requireTradingNumbers } from "./shared.js";
import { applyPositionDelta, creditHolding, writeTokenLedger } from "./ledger.js";

export const requestIssuance = (
  db,
  store,
  { userId, containerId, supply, price, terms = {} },
) =>
  store.transaction(async () => {
    const container = await getContainer(db, containerId);
    if (!container) throw fail("컨테이너를 찾을 수 없습니다.", 404);
    const farm = await db.prepare("SELECT * FROM farms WHERE id=?").get(container.farm_id);
    if (farm.owner_id !== userId)
      throw fail("농장주만 발행 신청할 수 있습니다.", 403);
    requireTradingNumbers({ quantity: supply, unitPrice: price });
    if (container.total_token_supply > 0)
      throw fail("이미 토큰이 발행된 컨테이너입니다.", 409);
    const timestamp = now();
    const termsJson = JSON.stringify({
      mockPayment: true,
      ownership:
        "토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지 않습니다.",
      ...terms,
    });
    await db
      .prepare(
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
      )
      .run(
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
    await store.audit(userId, "REQUEST_TOKEN_ISSUANCE", "container", container.id, {
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

export const approveIssuance = (
  db,
  store,
  { approverId, containerId, supply, price },
) =>
  store.transaction(async () => {
    const container = await getContainer(db, containerId);
    const owner = container
      ? await db
          .prepare(
            "SELECT f.owner_id FROM containers c JOIN farms f ON f.id=c.farm_id WHERE c.id=?",
          )
          .get(containerId)
      : null;
    if (!container || !owner || !supply || !price)
      throw fail("컨테이너, 발행량, 가격을 확인해 주세요.");
    requireTradingNumbers({ quantity: supply, unitPrice: price });
    if (container.total_token_supply > 0)
      throw fail("이미 토큰이 발행된 컨테이너입니다.", 409);
    const timestamp = now();
    const termsJson = JSON.stringify({
      mockPayment: true,
      ownership:
        "토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지 않습니다.",
    });
    await db
      .prepare(
        "UPDATE containers SET total_token_supply=?,available_token_quantity=0,token_price=?,updated_at=? WHERE id=?",
      )
      .run(supply, price, timestamp, containerId);
    await db
      .prepare(
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
      )
      .run(
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
    await creditHolding(db, owner.owner_id, container.token_id, containerId, supply, price);
    await applyPositionDelta(db, {
      userId: owner.owner_id,
      tokenId: container.token_id,
      containerId,
      available: supply,
      settled: supply,
      createdAt: timestamp,
    });
    await writeTokenLedger(db, {
      userId: owner.owner_id,
      tokenId: container.token_id,
      bucket: "available",
      direction: "CREDIT",
      quantity: supply,
      reason: "ISSUE",
      createdAt: timestamp,
    });
    await writeTokenLedger(db, {
      userId: owner.owner_id,
      tokenId: container.token_id,
      bucket: "settled",
      direction: "CREDIT",
      quantity: supply,
      reason: "ISSUE",
      createdAt: timestamp,
    });
    await store.appendBlock("TOKEN_ISSUANCE", "container", containerId, {
      tokenId: container.token_id,
      supply,
      price,
      issuerId: owner.owner_id,
      approvedBy: approverId,
    });
    await store.audit(approverId, "ISSUE_TOKEN", "container", containerId, {
      supply,
      price,
      issuerId: owner.owner_id,
    });
    return {
      id: container.token_id,
      containerId,
      issuerId: owner.owner_id,
      symbol: container.token_id,
      totalSupply: supply,
      initialPrice: price,
      status: "issued",
      executionVenue: "INTERNAL",
      updatedAt: timestamp,
    };
  });
