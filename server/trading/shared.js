import { createHash } from "node:crypto";
import {
  TRADING_LIMITS,
  limitLabel,
  safeOrderTotal,
} from "./limits.js";

export const now = () => new Date().toISOString();
export const text = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
export const hash = (value) => createHash("sha256").update(value).digest("hex");

export const quantityLimitMessage = `수량은 1~${limitLabel(
  TRADING_LIMITS.maxQuantity,
)}개까지 입력해 주세요.`;
export const priceLimitMessage = `개당 가격은 1~${limitLabel(
  TRADING_LIMITS.maxUnitPrice,
)}원까지 입력해 주세요.`;
export const totalLimitMessage = `총 거래 금액은 ${limitLabel(
  TRADING_LIMITS.maxOrderTotal,
)}원 이하여야 합니다.`;

export const fail = (message, code = 400) => {
  const error = new Error(message);
  error.code = code;
  return error;
};

export const requireTradingNumbers = ({ quantity, unitPrice }) => {
  if (!quantity) throw fail(quantityLimitMessage);
  if (!unitPrice) throw fail(priceLimitMessage);
  const total = safeOrderTotal(unitPrice, quantity);
  if (!total) throw fail(totalLimitMessage);
  return total;
};

export const mapOrder = (row) =>
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

export const mapPosition = (row) =>
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

export const getUser = (db, id) =>
  db
    .prepare(
      "SELECT id,name,email,role,phone,credit_balance,status,last_login_at,password_changed_at,created_at,updated_at,password_hash FROM users WHERE id=?",
    )
    .get(id);
export const getContainer = (db, id) =>
  db.prepare("SELECT * FROM containers WHERE id=?").get(id);
export const getContainerByToken = (db, tokenId) =>
  db.prepare("SELECT * FROM containers WHERE token_id=?").get(tokenId);
