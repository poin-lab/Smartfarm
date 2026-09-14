import pg from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { TRADING_LIMITS } from "./trading/limits.js";
import { seed } from "./seed.js";

const { Pool } = pg;
// COUNT(*)/SUM(integer) come back as BIGINT (OID 20), which node-postgres
// returns as a string by default to avoid silent precision loss. Every count
// or sum in this app fits well within Number.MAX_SAFE_INTEGER, so parse it as
// a plain JS number instead.
pg.types.setTypeParser(20, (value) => parseInt(value, 10));
const now = () => new Date().toISOString();
const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
export const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sign = (key, value) =>
  createHmac("sha256", key).update(value).digest("hex");
const asyncScrypt = promisify(scrypt);
const SCRYPT_OPTIONS = Object.freeze({
  N: 32768,
  r: 8,
  p: 3,
  maxmem: 64 * 1024 * 1024,
});

export const hashPassword = (password) => {
  const salt = randomBytes(16).toString("base64url");
  const hash = scryptSync(password, salt, 64).toString("base64url");
  return `scrypt$${salt}$${hash}`;
};
export const verifyPassword = (password, encoded) => {
  const [scheme, salt, saved] = String(encoded || "").split("$");
  if (scheme !== "scrypt" || !salt || !saved) return false;
  const actual = scryptSync(password, salt, 64).toString("base64url");
  return timingSafeEqual(Buffer.from(actual), Buffer.from(saved));
};
export const hashPasswordStrong = async (password) => {
  const salt = randomBytes(16).toString("base64url");
  const hash = await asyncScrypt(
    String(password).normalize("NFC"),
    salt,
    64,
    SCRYPT_OPTIONS,
  );
  return `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$${salt}$${hash.toString("base64url")}`;
};
export const verifyPasswordAsync = async (password, encoded) => {
  const parts = String(encoded || "").split("$");
  if (parts[0] !== "scrypt") return false;

  let salt;
  let saved;
  let options;
  let candidate = String(password);
  if (parts.length === 3) {
    [, salt, saved] = parts;
    options = {};
  } else if (parts.length === 6) {
    const [, n, r, p, encodedSalt, encodedHash] = parts;
    const parsed = { N: Number(n), r: Number(r), p: Number(p) };
    if (
      !Number.isInteger(parsed.N) ||
      parsed.N < 2 ||
      parsed.N > 1048576 ||
      (parsed.N & (parsed.N - 1)) !== 0 ||
      !Number.isInteger(parsed.r) ||
      parsed.r < 1 ||
      parsed.r > 32 ||
      !Number.isInteger(parsed.p) ||
      parsed.p < 1 ||
      parsed.p > 16
    )
      return false;
    salt = encodedSalt;
    saved = encodedHash;
    options = { ...parsed, maxmem: 64 * 1024 * 1024 };
    candidate = candidate.normalize("NFC");
  } else return false;

  if (!salt || !saved) return false;
  try {
    const expected = Buffer.from(saved, "base64url");
    const actual = await asyncScrypt(candidate, salt, expected.length, options);
    return expected.length > 0 && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
};
export const needsPasswordRehash = (encoded) =>
  !String(encoded || "").startsWith(
    `scrypt$${SCRYPT_OPTIONS.N}$${SCRYPT_OPTIONS.r}$${SCRYPT_OPTIONS.p}$`,
  );

const { maxQuantity, maxUnitPrice, maxOrderTotal } = TRADING_LIMITS;

// Consolidated final-state schema (equivalent to the old SQLite file after all
// of its incremental migrations). Fresh databases only, no legacy data to carry
// forward. The old per-row "trading limit" triggers are expressed here as plain
// CHECK constraints since they only ever inspected the row being written.
const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')), phone TEXT NOT NULL DEFAULT '', credit_balance INTEGER NOT NULL DEFAULT 2000000 CHECK(credit_balance >= 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','withdrawn')), last_login_at TEXT, password_changed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE TABLE IF NOT EXISTS farms (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_farms_owner ON farms(owner_id);
CREATE TABLE IF NOT EXISTS containers (id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE, name TEXT NOT NULL, crop_name TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', planted_at TEXT NOT NULL DEFAULT '', harvest_at TEXT NOT NULL DEFAULT '', token_id TEXT NOT NULL UNIQUE, total_token_supply INTEGER NOT NULL DEFAULT 0 CHECK(total_token_supply >= 0 AND total_token_supply <= ${maxQuantity}), available_token_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_token_quantity >= 0 AND available_token_quantity <= total_token_supply), token_price INTEGER NOT NULL DEFAULT 0 CHECK(token_price >= 0 AND token_price <= ${maxUnitPrice}), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(total_token_supply * token_price <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_containers_farm ON containers(farm_id);
CREATE TABLE IF NOT EXISTS container_page_content (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, rack_views_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sensor_readings (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, temperature REAL NOT NULL, humidity REAL NOT NULL, light REAL NOT NULL, co2 REAL NOT NULL, soil_moisture REAL NOT NULL, ph REAL NOT NULL, ec REAL NOT NULL, history_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holdings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), quantity INTEGER NOT NULL CHECK(quantity >= 0 AND quantity <= ${maxQuantity}), average_price INTEGER NOT NULL CHECK(average_price >= 0 AND average_price <= ${maxUnitPrice}), UNIQUE(user_id, token_id), CHECK(quantity * average_price <= ${maxOrderTotal}));
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), seller_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0 AND quantity <= ${maxQuantity}), unit_price INTEGER NOT NULL CHECK(unit_price > 0 AND unit_price <= ${maxUnitPrice}), status TEXT NOT NULL CHECK(status IN ('판매중','거래완료','취소')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, original_quantity INTEGER NOT NULL DEFAULT 0 CHECK(original_quantity >= 0), idempotency_key TEXT, CHECK(quantity * unit_price <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_idempotency ON orders(seller_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('구매','판매')), token_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= ${maxQuantity}), unit_price INTEGER NOT NULL CHECK(unit_price > 0 AND unit_price <= ${maxUnitPrice}), created_at TEXT NOT NULL, CHECK(quantity * unit_price <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS container_tokens (id TEXT PRIMARY KEY, container_id TEXT NOT NULL UNIQUE REFERENCES containers(id) ON DELETE CASCADE, issuer_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL UNIQUE, total_supply INTEGER NOT NULL CHECK(total_supply >= 0 AND total_supply <= ${maxQuantity}), initial_price INTEGER NOT NULL CHECK(initial_price >= 0 AND initial_price <= ${maxUnitPrice}), status TEXT NOT NULL CHECK(status IN ('requested','approved','issued','suspended')), terms_json TEXT NOT NULL DEFAULT '{}', terms_hash TEXT NOT NULL DEFAULT '', execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(total_supply * initial_price <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_container_tokens_container ON container_tokens(container_id);
CREATE TABLE IF NOT EXISTS token_positions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity >= 0), reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0), unsettled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(unsettled_quantity >= 0), settled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(settled_quantity >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, token_id));
CREATE INDEX IF NOT EXISTS idx_token_positions_user ON token_positions(user_id);
CREATE TABLE IF NOT EXISTS token_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), side TEXT NOT NULL CHECK(side IN ('BUY','SELL')), order_type TEXT NOT NULL CHECK(order_type IN ('MARKET','LIMIT')), limit_price INTEGER CHECK(limit_price IS NULL OR (limit_price > 0 AND limit_price <= ${maxUnitPrice})), original_quantity INTEGER NOT NULL CHECK(original_quantity > 0 AND original_quantity <= ${maxQuantity}), remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0 AND remaining_quantity <= original_quantity), status TEXT NOT NULL CHECK(status IN ('pending','open','partially_filled','filled','cancelled','rejected')), execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER')), external_order_id TEXT, idempotency_key TEXT, legacy_order_id TEXT UNIQUE REFERENCES orders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, CHECK(limit_price IS NULL OR limit_price * original_quantity <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_token_orders_book ON token_orders(token_id,side,status,limit_price,created_at);
CREATE INDEX IF NOT EXISTS idx_token_orders_user ON token_orders(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS token_executions (id TEXT PRIMARY KEY, buy_order_id TEXT, sell_order_id TEXT NOT NULL REFERENCES orders(id), buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), quantity INTEGER NOT NULL CHECK(quantity > 0 AND quantity <= ${maxQuantity}), unit_price INTEGER NOT NULL CHECK(unit_price > 0 AND unit_price <= ${maxUnitPrice}), external_execution_id TEXT, executed_at TEXT NOT NULL, anchored_batch_id TEXT, CHECK(quantity * unit_price <= ${maxOrderTotal}));
CREATE INDEX IF NOT EXISTS idx_executions_token_time ON token_executions(token_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_unanchored ON token_executions(executed_at) WHERE anchored_batch_id IS NULL;
CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE REFERENCES token_executions(id), cash_status TEXT NOT NULL CHECK(cash_status IN ('pending','confirmed','failed','reversed')), asset_status TEXT NOT NULL CHECK(asset_status IN ('pending','confirmed','failed','reversed')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed','reversed')), external_settlement_id TEXT, settled_at TEXT, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status, created_at DESC);
CREATE TABLE IF NOT EXISTS credit_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount INTEGER NOT NULL CHECK(amount > 0 AND amount <= ${maxOrderTotal}), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger_entries(user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS token_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), position_bucket TEXT NOT NULL CHECK(position_bucket IN ('available','reserved','unsettled','settled')), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), quantity INTEGER NOT NULL CHECK(quantity > 0), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_token_ledger_user_token ON token_ledger_entries(user_id, token_id, created_at DESC);
CREATE TABLE IF NOT EXISTS idempotency_keys (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, scope, idempotency_key));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blockchain_blocks (height INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, block_hash TEXT NOT NULL UNIQUE, signature TEXT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_blockchain_entity ON blockchain_blocks(entity_type, entity_id);
CREATE TABLE IF NOT EXISTS iot_devices (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, name TEXT NOT NULL, device_type TEXT NOT NULL CHECK(device_type IN ('sensor','controller','camera')), api_key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline','disabled')), last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_iot_devices_container ON iot_devices(container_id);
CREATE TABLE IF NOT EXISTS sensor_events (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, device_id TEXT REFERENCES iot_devices(id), payload_json TEXT NOT NULL, created_at TEXT NOT NULL, anchored_batch_id TEXT);
CREATE INDEX IF NOT EXISTS idx_sensor_events_container ON sensor_events(container_id,created_at DESC);
CREATE TABLE IF NOT EXISTS control_commands (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, requested_by TEXT NOT NULL REFERENCES users(id), command_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','acknowledged','failed','cancelled')), requested_at TEXT NOT NULL, acknowledged_at TEXT, result_json TEXT);
CREATE INDEX IF NOT EXISTS idx_control_commands_pending ON control_commands(container_id,status,requested_at);
CREATE TABLE IF NOT EXISTS camera_streams (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, hls_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline')), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS public_chain_operations (id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted','confirmed','failed')), tx_hash TEXT, block_number INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_chain_operations_status ON public_chain_operations(status,created_at);
CREATE TABLE IF NOT EXISTS sensor_anchor_batches (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id), from_event_id TEXT NOT NULL, to_event_id TEXT NOT NULL, from_timestamp TEXT NOT NULL, to_timestamp TEXT NOT NULL, reading_count INTEGER NOT NULL CHECK(reading_count > 0), merkle_root TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE REFERENCES public_chain_operations(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_sensor_batches_container ON sensor_anchor_batches(container_id,created_at DESC);
CREATE TABLE IF NOT EXISTS transaction_anchor_batches (id TEXT PRIMARY KEY, from_execution_id TEXT NOT NULL, to_execution_id TEXT NOT NULL, execution_count INTEGER NOT NULL CHECK(execution_count > 0), merkle_root TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE REFERENCES public_chain_operations(id), created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tx_anchor_batches_created ON transaction_anchor_batches(created_at DESC);
`;

export async function appendBlock(db, signingKey, eventType, entityType, entityId, payload) {
  const previous = await db
    .prepare(
      "SELECT height,block_hash FROM blockchain_blocks ORDER BY height DESC LIMIT 1",
    )
    .get();
  const height = previous ? previous.height + 1 : 0;
  const previousHash = previous?.block_hash || "0".repeat(64);
  const createdAt = now();
  const payloadJson = canonicalJson(payload);
  const payloadHash = sha256(payloadJson);
  const blockHash = sha256(
    `${height}|${previousHash}|${payloadHash}|${eventType}|${entityType}|${entityId}|${createdAt}`,
  );
  const signature = sign(signingKey, blockHash);
  await db
    .prepare("INSERT INTO blockchain_blocks VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(
      height,
      previousHash,
      payloadHash,
      blockHash,
      signature,
      eventType,
      entityType,
      entityId,
      payloadJson,
      createdAt,
    );
  return {
    height,
    previousHash,
    payloadHash,
    blockHash,
    signature,
    eventType,
    entityType,
    entityId,
    createdAt,
  };
}

async function verifyBlockchain(db, signingKey) {
  const blocks = await db
    .prepare("SELECT * FROM blockchain_blocks ORDER BY height")
    .all();
  let previousHash = "0".repeat(64);
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    const expectedPayloadHash = sha256(block.payload_json);
    const expectedHash = sha256(
      `${block.height}|${previousHash}|${block.payload_hash}|${block.event_type}|${block.entity_type}|${block.entity_id}|${block.created_at}`,
    );
    if (
      block.height !== index ||
      block.previous_hash !== previousHash ||
      block.payload_hash !== expectedPayloadHash ||
      block.block_hash !== expectedHash ||
      block.signature !== sign(signingKey, block.block_hash)
    )
      return {
        valid: false,
        height: block.height,
        blockHash: block.block_hash,
        count: blocks.length,
      };
    previousHash = block.block_hash;
  }
  return { valid: true, count: blocks.length, latestHash: previousHash };
}

const txContext = new AsyncLocalStorage();
const sqlCache = new Map();
const toPositionalSql = (sql) => {
  let cached = sqlCache.get(sql);
  if (cached === undefined) {
    let index = 0;
    cached = sql.replace(/\?/g, () => `$${++index}`);
    sqlCache.set(sql, cached);
  }
  return cached;
};

function makeDb(pool) {
  const client = () => txContext.getStore() || pool;
  return {
    prepare(sql) {
      const text = toPositionalSql(sql);
      return {
        async get(...params) {
          const result = await client().query(text, params);
          return result.rows[0];
        },
        async all(...params) {
          const result = await client().query(text, params);
          return result.rows;
        },
        async run(...params) {
          const result = await client().query(text, params);
          return { changes: result.rowCount, rowCount: result.rowCount };
        },
      };
    },
    async exec(sql) {
      await client().query(sql);
    },
  };
}

async function transaction(pool, fn) {
  if (txContext.getStore()) return fn();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await txContext.run(client, fn);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken; nothing more to roll back
    }
    throw error;
  } finally {
    client.release();
  }
}

export function createDatabase(target = process.env.DATABASE_URL) {
  const isTestSchema = target === ":memory:";
  const connectionString = isTestSchema ? process.env.DATABASE_URL : target;
  if (!connectionString)
    throw new Error(
      "DATABASE_URL is required (set it in .env, e.g. postgres://user:pass@localhost:5432/green_link).",
    );
  const schemaName = isTestSchema
    ? `test_${randomBytes(8).toString("hex")}`
    : null;

  const pool = new Pool({
    connectionString,
    max: 5,
    // Every physical connection this pool opens gets search_path set as a
    // startup parameter, so it's guaranteed to be in effect before the first
    // query runs on it (a pool "connect" event listener can't guarantee that:
    // pg hands the client out without waiting for the listener's query).
    options: schemaName ? `-c search_path=${schemaName}` : undefined,
  });
  pool.on("error", (error) =>
    console.error("Unexpected PostgreSQL pool error", error),
  );

  const signingKey =
    process.env.LEDGER_SIGNING_KEY ||
    "green-link-local-development-key-change-before-deployment";

  const db = makeDb(pool);
  const initialize = async () => {
    if (schemaName) await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`);
    await pool.query(schema);
    const hasData = await pool.query("SELECT 1 FROM schema_migrations LIMIT 1");
    if (!hasData.rowCount && (isTestSchema || process.env.NODE_ENV !== "production"))
      await transaction(pool, () => seed(db, signingKey));
  };
  // A transient failure here (e.g. Postgres still starting up) must not wedge
  // every future query behind a permanently-rejected promise: clear the cache
  // on failure so the next call retries initialize() from scratch instead of
  // just re-throwing the same stale rejection forever.
  let readyPromise = null;
  const getReady = () => {
    if (!readyPromise)
      readyPromise = initialize().catch((error) => {
        readyPromise = null;
        throw error;
      });
    return readyPromise;
  };
  const withReady =
    (fn) =>
    (...args) =>
      getReady().then(() => fn(...args));

  return {
    db: {
      prepare(sql) {
        const statement = db.prepare(sql);
        return {
          get: withReady(statement.get),
          all: withReady(statement.all),
          run: withReady(statement.run),
        };
      },
    },
    transaction: withReady((fn) => transaction(pool, fn)),
    async audit(actorId, action, entityType, entityId, metadata = {}) {
      await getReady();
      await db
        .prepare("INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?)")
        .run(
          randomBytes(16).toString("hex"),
          actorId || null,
          action,
          entityType,
          entityId,
          JSON.stringify(metadata),
          now(),
        );
    },
    appendBlock: withReady((eventType, entityType, entityId, payload) =>
      appendBlock(db, signingKey, eventType, entityType, entityId, payload),
    ),
    enqueueChainOperation: withReady(
      async (operationType, entityType, entityId, payload) => {
        const id = `chain-${randomBytes(12).toString("hex")}`;
        const timestamp = now();
        await db
          .prepare(
            "INSERT INTO public_chain_operations (id,operation_type,entity_type,entity_id,payload_json,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)",
          )
          .run(
            id,
            operationType,
            entityType,
            entityId,
            canonicalJson(payload),
            timestamp,
            timestamp,
          );
        return {
          id,
          operationType,
          entityType,
          entityId,
          payload,
          status: "pending",
          createdAt: timestamp,
        };
      },
    ),
    verifyBlockchain: withReady(() => verifyBlockchain(db, signingKey)),
    async close() {
      // Don't gate shutdown on getReady() succeeding — if the DB was never
      // reachable, close() should still tear the pool down instead of
      // hanging or retrying schema init.
      try {
        if (schemaName)
          await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
      } catch (error) {
        console.error("Failed to drop schema during close()", error);
      }
      await pool.end();
    },
  };
}
