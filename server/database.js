import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const defaultPath = resolve(here, "data", "smartfarm.sqlite");
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
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
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

const fixtures = {
  users: [
    ["u1", "김지원", "user@smartfarm.kr", "user1234", "user", "010-1234-5678"],
    [
      "farmer-a",
      "박농장주",
      "farmer@smartfarm.kr",
      "farmer1234",
      "user",
      "010-2222-3333",
    ],
    [
      "admin",
      "운영 관리자",
      "admin@smartfarm.kr",
      "admin1234",
      "admin",
      "02-555-0123",
    ],
  ],
  farms: [
    [
      "farm-a",
      "그린밸리 A팜",
      "경상북도 경산시 하양읍",
      35.913,
      128.817,
      "운영중",
      "딸기와 엽채류를 재배하는 친환경 컨테이너 스마트팜입니다.",
      "farmer-a",
    ],
    [
      "farm-b",
      "달성 B팜",
      "대구광역시 달성군",
      35.774,
      128.431,
      "운영중",
      "에너지 절감형 환경 제어 시스템을 운영합니다.",
      "admin",
    ],
    [
      "farm-c",
      "영천 C팜",
      "경상북도 영천시 금호읍",
      35.971,
      128.938,
      "점검중",
      "토마토 특화 자동화 스마트팜입니다.",
      "admin",
    ],
  ],
  containers: [
    [
      "a-01",
      "farm-a",
      "A-01 컨테이너",
      "설향 딸기",
      "생육중",
      "프리미엄 설향 딸기를 수경 재배하고 있습니다.",
      "2026-06-18",
      "2026-09-25",
      "SFC-A01",
      10,
      3,
      120000,
    ],
    [
      "a-02",
      "farm-a",
      "A-02 컨테이너",
      "대추방울토마토",
      "생육중",
      "저탄소 방식으로 고당도 토마토를 재배합니다.",
      "2026-05-30",
      "2026-09-10",
      "SFC-A02",
      10,
      2,
      95000,
    ],
    [
      "a-03",
      "farm-a",
      "A-03 컨테이너",
      "바질",
      "파종대기",
      "친환경 잎채소 재배를 준비하고 있습니다.",
      "2026-08-25",
      "2026-10-05",
      "SFC-A03",
      10,
      0,
      85000,
    ],
    [
      "b-01",
      "farm-b",
      "B-01 컨테이너",
      "버터헤드 상추",
      "수확중",
      "신선한 샐러드 채소를 연중 재배합니다.",
      "2026-07-01",
      "2026-08-22",
      "SFC-B01",
      10,
      1,
      80000,
    ],
    [
      "c-01",
      "farm-c",
      "C-01 컨테이너",
      "완숙 토마토",
      "점검중",
      "설비 정기 점검이 진행 중입니다.",
      "2026-06-10",
      "2026-09-18",
      "SFC-C01",
      10,
      3,
      108000,
    ],
  ],
  sensors: [
    [
      "a-01",
      24.6,
      68,
      12400,
      720,
      54,
      6.2,
      1.8,
      [22.1, 22.8, 23.4, 24, 24.6, 25.1, 24.8, 24.6],
    ],
    [
      "a-02",
      25.2,
      64,
      13100,
      690,
      51,
      6.4,
      2.1,
      [23, 23.5, 24.1, 24.8, 25.4, 25.8, 25.5, 25.2],
    ],
    [
      "a-03",
      23.8,
      70,
      8000,
      750,
      58,
      6.1,
      1.5,
      [22, 22.4, 22.9, 23.2, 23.6, 24, 23.9, 23.8],
    ],
    [
      "b-01",
      22.9,
      72,
      11800,
      680,
      61,
      6.3,
      1.7,
      [21.8, 22.1, 22.4, 22.7, 23, 23.2, 23, 22.9],
    ],
    [
      "c-01",
      27.8,
      59,
      14200,
      810,
      42,
      6.8,
      2.5,
      [24.1, 24.9, 25.8, 26.5, 27.1, 27.9, 28.2, 27.8],
    ],
  ],
};

const schema = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL COLLATE NOCASE UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('user','admin')), phone TEXT NOT NULL DEFAULT '', credit_balance INTEGER NOT NULL DEFAULT 2000000 CHECK(credit_balance >= 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','withdrawn')), last_login_at TEXT, password_changed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS farms (id TEXT PRIMARY KEY, name TEXT NOT NULL, address TEXT NOT NULL, latitude REAL NOT NULL, longitude REAL NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS containers (id TEXT PRIMARY KEY, farm_id TEXT NOT NULL REFERENCES farms(id) ON DELETE CASCADE, name TEXT NOT NULL, crop_name TEXT NOT NULL, status TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', planted_at TEXT NOT NULL DEFAULT '', harvest_at TEXT NOT NULL DEFAULT '', token_id TEXT NOT NULL UNIQUE, total_token_supply INTEGER NOT NULL DEFAULT 0 CHECK(total_token_supply >= 0), available_token_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_token_quantity >= 0 AND available_token_quantity <= total_token_supply), token_price INTEGER NOT NULL DEFAULT 0 CHECK(token_price >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS container_page_content (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, rack_views_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sensor_readings (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, temperature REAL NOT NULL, humidity REAL NOT NULL, light REAL NOT NULL, co2 REAL NOT NULL, soil_moisture REAL NOT NULL, ph REAL NOT NULL, ec REAL NOT NULL, history_json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS holdings (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), quantity INTEGER NOT NULL CHECK(quantity >= 0), average_price INTEGER NOT NULL CHECK(average_price >= 0), UNIQUE(user_id, token_id));
CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, seller_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), seller_name TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity >= 0), unit_price INTEGER NOT NULL CHECK(unit_price > 0), status TEXT NOT NULL CHECK(status IN ('판매중','거래완료','취소')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), type TEXT NOT NULL CHECK(type IN ('구매','판매')), token_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price INTEGER NOT NULL CHECK(unit_price > 0), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS container_tokens (id TEXT PRIMARY KEY, container_id TEXT NOT NULL UNIQUE REFERENCES containers(id) ON DELETE CASCADE, issuer_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL UNIQUE, total_supply INTEGER NOT NULL CHECK(total_supply >= 0), initial_price INTEGER NOT NULL CHECK(initial_price >= 0), status TEXT NOT NULL CHECK(status IN ('requested','approved','issued','suspended')), terms_json TEXT NOT NULL DEFAULT '{}', terms_hash TEXT NOT NULL DEFAULT '', execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER','PUBLIC_CHAIN')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_positions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity >= 0), reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0), unsettled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(unsettled_quantity >= 0), settled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(settled_quantity >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, token_id));
CREATE TABLE IF NOT EXISTS token_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), side TEXT NOT NULL CHECK(side IN ('BUY','SELL')), order_type TEXT NOT NULL CHECK(order_type IN ('MARKET','LIMIT')), limit_price INTEGER CHECK(limit_price IS NULL OR limit_price > 0), original_quantity INTEGER NOT NULL CHECK(original_quantity > 0), remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0 AND remaining_quantity <= original_quantity), status TEXT NOT NULL CHECK(status IN ('pending','open','partially_filled','filled','cancelled','rejected')), execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER','PUBLIC_CHAIN')), external_order_id TEXT, idempotency_key TEXT, legacy_order_id TEXT UNIQUE REFERENCES orders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_executions (id TEXT PRIMARY KEY, buy_order_id TEXT, sell_order_id TEXT NOT NULL REFERENCES orders(id), buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price INTEGER NOT NULL CHECK(unit_price > 0), external_execution_id TEXT, executed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE REFERENCES token_executions(id), cash_status TEXT NOT NULL CHECK(cash_status IN ('pending','confirmed','failed','reversed')), asset_status TEXT NOT NULL CHECK(asset_status IN ('pending','confirmed','failed','reversed')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed','reversed')), external_settlement_id TEXT, settled_at TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS credit_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount INTEGER NOT NULL CHECK(amount > 0), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS token_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), position_bucket TEXT NOT NULL CHECK(position_bucket IN ('available','reserved','unsettled','settled')), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), quantity INTEGER NOT NULL CHECK(quantity > 0), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, scope, idempotency_key));
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS blockchain_blocks (height INTEGER PRIMARY KEY, previous_hash TEXT NOT NULL, payload_hash TEXT NOT NULL, block_hash TEXT NOT NULL UNIQUE, signature TEXT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS iot_devices (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, name TEXT NOT NULL, device_type TEXT NOT NULL CHECK(device_type IN ('sensor','controller','camera')), api_key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline','disabled')), last_seen_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sensor_events (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, device_id TEXT REFERENCES iot_devices(id), payload_json TEXT NOT NULL, created_at TEXT NOT NULL, anchored_batch_id TEXT);
CREATE TABLE IF NOT EXISTS control_commands (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id) ON DELETE CASCADE, requested_by TEXT NOT NULL REFERENCES users(id), command_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('queued','acknowledged','failed','cancelled')), requested_at TEXT NOT NULL, acknowledged_at TEXT, result_json TEXT);
CREATE TABLE IF NOT EXISTS camera_streams (container_id TEXT PRIMARY KEY REFERENCES containers(id) ON DELETE CASCADE, hls_url TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'offline' CHECK(status IN ('online','offline')), updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS public_chain_operations (id TEXT PRIMARY KEY, operation_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','submitting','submitted','confirmed','failed')), tx_hash TEXT, block_number INTEGER, attempts INTEGER NOT NULL DEFAULT 0, error_message TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sensor_anchor_batches (id TEXT PRIMARY KEY, container_id TEXT NOT NULL REFERENCES containers(id), from_event_id TEXT NOT NULL, to_event_id TEXT NOT NULL, from_timestamp TEXT NOT NULL, to_timestamp TEXT NOT NULL, reading_count INTEGER NOT NULL CHECK(reading_count > 0), merkle_root TEXT NOT NULL UNIQUE, operation_id TEXT NOT NULL UNIQUE REFERENCES public_chain_operations(id), created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS wallet_challenges (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, nonce TEXT NOT NULL, message TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_farms_owner ON farms(owner_id);
CREATE INDEX IF NOT EXISTS idx_containers_farm ON containers(farm_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_container_tokens_container ON container_tokens(container_id);
CREATE INDEX IF NOT EXISTS idx_token_positions_user ON token_positions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_orders_book ON token_orders(token_id,side,status,limit_price,created_at);
CREATE INDEX IF NOT EXISTS idx_token_orders_user ON token_orders(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_executions_token_time ON token_executions(token_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger_entries(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_token_ledger_user_token ON token_ledger_entries(user_id, token_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_blockchain_entity ON blockchain_blocks(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_iot_devices_container ON iot_devices(container_id);
CREATE INDEX IF NOT EXISTS idx_control_commands_pending ON control_commands(container_id,status,requested_at);
CREATE INDEX IF NOT EXISTS idx_sensor_events_container ON sensor_events(container_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chain_operations_status ON public_chain_operations(status,created_at);
CREATE INDEX IF NOT EXISTS idx_sensor_batches_container ON sensor_anchor_batches(container_id,created_at DESC);
`;

function appendBlock(db, signingKey, eventType, entityType, entityId, payload) {
  const previous = db
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
  db.prepare("INSERT INTO blockchain_blocks VALUES (?,?,?,?,?,?,?,?,?,?)").run(
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

function verifyBlockchain(db, signingKey) {
  const blocks = db
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

function seed(db) {
  const t = now();
  const insertUser = db.prepare(
    "INSERT OR IGNORE INTO users (id,name,email,password_hash,role,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const [id, name, email, password, role, phone] of fixtures.users)
    insertUser.run(id, name, email, hashPassword(password), role, phone, t, t);
  const insertFarm = db.prepare(
    "INSERT OR IGNORE INTO farms VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const row of fixtures.farms) insertFarm.run(...row, t, t);
  const insertContainer = db.prepare(
    "INSERT OR IGNORE INTO containers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  );
  for (const row of fixtures.containers) insertContainer.run(...row, t, t);
  const insertSensor = db.prepare(
    "INSERT OR IGNORE INTO sensor_readings VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const [
    id,
    temperature,
    humidity,
    light,
    co2,
    soilMoisture,
    ph,
    ec,
    history,
  ] of fixtures.sensors)
    insertSensor.run(
      id,
      temperature,
      humidity,
      light,
      co2,
      soilMoisture,
      ph,
      ec,
      JSON.stringify(history),
      t,
    );
  const insertHolding = db.prepare(
    "INSERT OR IGNORE INTO holdings VALUES (?,?,?,?,?,?)",
  );
  [
    ["h1", "u1", "SFC-A01", "a-01", 4, 115000],
    ["h2", "u1", "SFC-A02", "a-02", 2, 92000],
    ["h3", "u1", "SFC-B01", "b-01", 1, 80000],
    ["h4", "farmer-a", "SFC-A01", "a-01", 4, 120000],
    ["h5", "farmer-a", "SFC-A02", "a-02", 7, 95000],
    ["h6", "farmer-a", "SFC-A03", "a-03", 10, 85000],
    ["h7", "admin", "SFC-B01", "b-01", 8, 80000],
    ["h8", "admin", "SFC-C01", "c-01", 7, 108000],
  ].forEach((row) => insertHolding.run(...row));
  const insertOrder = db.prepare(
    "INSERT OR IGNORE INTO orders VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  [
    [
      "order-1",
      "farmer-a",
      "SFC-A01",
      "a-01",
      "그린밸리팜",
      2,
      120000,
      "판매중",
      "2026-08-17T01:00:00.000Z",
      "2026-08-17T01:00:00.000Z",
    ],
    [
      "order-2",
      "farmer-a",
      "SFC-A02",
      "a-02",
      "그린루트",
      1,
      95000,
      "판매중",
      "2026-08-16T05:00:00.000Z",
      "2026-08-16T05:00:00.000Z",
    ],
    [
      "order-3",
      "admin",
      "SFC-C01",
      "c-01",
      "스마트팜",
      3,
      108000,
      "판매중",
      "2026-08-15T08:00:00.000Z",
      "2026-08-15T08:00:00.000Z",
    ],
  ].forEach((row) => insertOrder.run(...row));
}

export function createDatabase(
  filePath = process.env.SMARTFARM_DB || defaultPath,
) {
  if (filePath !== ":memory:")
    mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec(
    "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;",
  );
  db.exec(schema);
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 1").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      if (filePath === ":memory:" || process.env.NODE_ENV !== "production")
        seed(db);
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(1, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  const signingKey =
    process.env.BLOCKCHAIN_SIGNING_KEY ||
    "green-link-local-development-key-change-before-deployment";
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 2").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      appendBlock(db, signingKey, "GENESIS", "network", "green-link", {
        network: "GREEN LINK",
        version: 1,
      });
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(2, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 3").get()) {
    db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(3, now());
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 4").get()) {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    if (!columns.some((column) => column.name === "credit_balance"))
      db.exec(
        "ALTER TABLE users ADD COLUMN credit_balance INTEGER NOT NULL DEFAULT 2000000 CHECK(credit_balance >= 0)",
      );
    db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(4, now());
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 5").get()) {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    if (!columns.some((column) => column.name === "wallet_address"))
      db.exec("ALTER TABLE users ADD COLUMN wallet_address TEXT");
    db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(5, now());
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 6").get()) {
    const columns = db.prepare("PRAGMA table_info(sensor_events)").all();
    if (!columns.some((column) => column.name === "anchored_batch_id"))
      db.exec("ALTER TABLE sensor_events ADD COLUMN anchored_batch_id TEXT");
    db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(6, now());
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 7").get()) {
    const columns = db.prepare("PRAGMA table_info(users)").all();
    if (!columns.some((column) => column.name === "status"))
      db.exec(
        "ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended','withdrawn'))",
      );
    if (!columns.some((column) => column.name === "last_login_at"))
      db.exec("ALTER TABLE users ADD COLUMN last_login_at TEXT");
    if (!columns.some((column) => column.name === "password_changed_at"))
      db.exec("ALTER TABLE users ADD COLUMN password_changed_at TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)");
    db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(7, now());
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 8").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(`
        CREATE TABLE orders_v8 (
          id TEXT PRIMARY KEY,
          seller_id TEXT NOT NULL REFERENCES users(id),
          token_id TEXT NOT NULL REFERENCES containers(token_id),
          container_id TEXT NOT NULL REFERENCES containers(id),
          seller_name TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity >= 0),
          unit_price INTEGER NOT NULL CHECK(unit_price > 0),
          status TEXT NOT NULL CHECK(status IN ('판매중','거래완료','취소')),
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        INSERT INTO orders_v8 SELECT * FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_v8 RENAME TO orders;
        CREATE INDEX idx_orders_status ON orders(status, created_at DESC);
      `);
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(8, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 9").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const orderColumns = db.prepare("PRAGMA table_info(orders)").all();
      if (!orderColumns.some((column) => column.name === "original_quantity"))
        db.exec(
          "ALTER TABLE orders ADD COLUMN original_quantity INTEGER NOT NULL DEFAULT 0 CHECK(original_quantity >= 0)",
        );
      if (!orderColumns.some((column) => column.name === "idempotency_key"))
        db.exec("ALTER TABLE orders ADD COLUMN idempotency_key TEXT");
      db.prepare(
        "UPDATE orders SET original_quantity=quantity WHERE original_quantity=0",
      ).run();
      db.exec(`
        CREATE TABLE IF NOT EXISTS container_tokens (id TEXT PRIMARY KEY, container_id TEXT NOT NULL UNIQUE REFERENCES containers(id) ON DELETE CASCADE, issuer_id TEXT NOT NULL REFERENCES users(id), symbol TEXT NOT NULL UNIQUE, total_supply INTEGER NOT NULL CHECK(total_supply >= 0), initial_price INTEGER NOT NULL CHECK(initial_price >= 0), status TEXT NOT NULL CHECK(status IN ('requested','approved','issued','suspended')), terms_json TEXT NOT NULL DEFAULT '{}', terms_hash TEXT NOT NULL DEFAULT '', execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER','PUBLIC_CHAIN')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS token_executions (id TEXT PRIMARY KEY, buy_order_id TEXT, sell_order_id TEXT NOT NULL REFERENCES orders(id), buyer_id TEXT NOT NULL REFERENCES users(id), seller_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), quantity INTEGER NOT NULL CHECK(quantity > 0), unit_price INTEGER NOT NULL CHECK(unit_price > 0), external_execution_id TEXT, executed_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settlements (id TEXT PRIMARY KEY, execution_id TEXT NOT NULL UNIQUE REFERENCES token_executions(id), cash_status TEXT NOT NULL CHECK(cash_status IN ('pending','confirmed','failed','reversed')), asset_status TEXT NOT NULL CHECK(asset_status IN ('pending','confirmed','failed','reversed')), status TEXT NOT NULL CHECK(status IN ('pending','confirmed','failed','reversed')), external_settlement_id TEXT, settled_at TEXT, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS credit_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), amount INTEGER NOT NULL CHECK(amount > 0), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS token_ledger_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), position_bucket TEXT NOT NULL CHECK(position_bucket IN ('available','reserved','unsettled','settled')), direction TEXT NOT NULL CHECK(direction IN ('DEBIT','CREDIT')), quantity INTEGER NOT NULL CHECK(quantity > 0), reason TEXT NOT NULL, execution_id TEXT REFERENCES token_executions(id), settlement_id TEXT REFERENCES settlements(id), created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS idempotency_keys (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, idempotency_key TEXT NOT NULL, response_status INTEGER NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (user_id, scope, idempotency_key));
        CREATE INDEX IF NOT EXISTS idx_orders_seller_idempotency ON orders(seller_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_container_tokens_container ON container_tokens(container_id);
        CREATE INDEX IF NOT EXISTS idx_executions_token_time ON token_executions(token_id, executed_at DESC);
        CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_credit_ledger_user ON credit_ledger_entries(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_token_ledger_user_token ON token_ledger_entries(user_id, token_id, created_at DESC);
      `);
      const timestamp = now();
      const termsJson = "{}";
      db.prepare(
        `INSERT OR IGNORE INTO container_tokens (id,container_id,issuer_id,symbol,total_supply,initial_price,status,terms_json,terms_hash,execution_venue,created_at,updated_at)
         SELECT c.token_id,c.id,f.owner_id,c.token_id,c.total_token_supply,c.token_price,
                CASE WHEN c.total_token_supply > 0 THEN 'issued' ELSE 'requested' END,
                ?,?,'INTERNAL',c.created_at,c.updated_at
           FROM containers c JOIN farms f ON f.id=c.farm_id`,
      ).run(termsJson, sha256(termsJson));
      const creditSnapshot = db.prepare(
        "INSERT INTO credit_ledger_entries VALUES (?,?,?,?,?,?,?,?)",
      );
      for (const user of db
        .prepare("SELECT id,credit_balance FROM users WHERE credit_balance > 0")
        .all())
        creditSnapshot.run(
          randomBytes(16).toString("hex"),
          user.id,
          "CREDIT",
          user.credit_balance,
          "SNAPSHOT",
          null,
          null,
          timestamp,
        );
      const tokenSnapshot = db.prepare(
        "INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      for (const holding of db
        .prepare(
          "SELECT user_id,token_id,quantity FROM holdings WHERE quantity > 0",
        )
        .all())
        tokenSnapshot.run(
          randomBytes(16).toString("hex"),
          holding.user_id,
          holding.token_id,
          "available",
          "CREDIT",
          holding.quantity,
          "SNAPSHOT",
          null,
          null,
          timestamp,
        );
      for (const order of db
        .prepare(
          "SELECT seller_id,token_id,quantity FROM orders WHERE status='판매중' AND quantity > 0",
        )
        .all())
        tokenSnapshot.run(
          randomBytes(16).toString("hex"),
          order.seller_id,
          order.token_id,
          "reserved",
          "CREDIT",
          order.quantity,
          "SNAPSHOT",
          null,
          null,
          timestamp,
        );
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(9, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  if (!db.prepare("SELECT 1 FROM schema_migrations WHERE version = 10").get()) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const timestamp = now();
      db.prepare(
        "INSERT OR IGNORE INTO users (id,name,email,password_hash,role,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        "farmer-a",
        "박농장주",
        "farmer@smartfarm.kr",
        hashPassword("farmer1234"),
        "user",
        "010-2222-3333",
        timestamp,
        timestamp,
      );
      db.prepare(
        "UPDATE farms SET owner_id=?,updated_at=? WHERE id='farm-a' AND owner_id='u1'",
      ).run("farmer-a", timestamp);
      db.prepare(
        "UPDATE orders SET seller_id=?,seller_name=?,updated_at=? WHERE id IN ('order-1','order-2') AND seller_id='admin'",
      ).run("farmer-a", "그린밸리팜", timestamp);
      db.exec(`
        CREATE TABLE IF NOT EXISTS token_positions (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity >= 0), reserved_quantity INTEGER NOT NULL DEFAULT 0 CHECK(reserved_quantity >= 0), unsettled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(unsettled_quantity >= 0), settled_quantity INTEGER NOT NULL DEFAULT 0 CHECK(settled_quantity >= 0), updated_at TEXT NOT NULL, PRIMARY KEY (user_id, token_id));
        CREATE TABLE IF NOT EXISTS token_orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), token_id TEXT NOT NULL REFERENCES containers(token_id), container_id TEXT NOT NULL REFERENCES containers(id), side TEXT NOT NULL CHECK(side IN ('BUY','SELL')), order_type TEXT NOT NULL CHECK(order_type IN ('MARKET','LIMIT')), limit_price INTEGER CHECK(limit_price IS NULL OR limit_price > 0), original_quantity INTEGER NOT NULL CHECK(original_quantity > 0), remaining_quantity INTEGER NOT NULL CHECK(remaining_quantity >= 0 AND remaining_quantity <= original_quantity), status TEXT NOT NULL CHECK(status IN ('pending','open','partially_filled','filled','cancelled','rejected')), execution_venue TEXT NOT NULL DEFAULT 'INTERNAL' CHECK(execution_venue IN ('INTERNAL','BROKER','PUBLIC_CHAIN')), external_order_id TEXT, idempotency_key TEXT, legacy_order_id TEXT UNIQUE REFERENCES orders(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS idx_token_positions_user ON token_positions(user_id);
        CREATE INDEX IF NOT EXISTS idx_token_orders_book ON token_orders(token_id,side,status,limit_price,created_at);
        CREATE INDEX IF NOT EXISTS idx_token_orders_user ON token_orders(user_id,created_at DESC);
      `);
      db.prepare(
        `UPDATE container_tokens
            SET issuer_id=(SELECT f.owner_id FROM containers c JOIN farms f ON f.id=c.farm_id WHERE c.id=container_tokens.container_id),
                updated_at=?
          WHERE EXISTS (SELECT 1 FROM containers c JOIN farms f ON f.id=c.farm_id WHERE c.id=container_tokens.container_id AND f.owner_id<>container_tokens.issuer_id)`,
      ).run(timestamp);

      const upsertHolding = db.prepare(
        `INSERT INTO holdings (id,user_id,token_id,container_id,quantity,average_price)
         VALUES (?,?,?,?,?,?)
         ON CONFLICT(user_id,token_id) DO UPDATE SET
           quantity=holdings.quantity+excluded.quantity,
           average_price=CASE
             WHEN holdings.quantity+excluded.quantity=0 THEN excluded.average_price
             ELSE ROUND((holdings.average_price*holdings.quantity + excluded.average_price*excluded.quantity) / (holdings.quantity+excluded.quantity))
           END`,
      );
      const issueLedger = db.prepare(
        "INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      for (const container of db
        .prepare(
          `SELECT c.id,c.token_id,c.total_token_supply,c.token_price,f.owner_id
             FROM containers c JOIN farms f ON f.id=c.farm_id
            WHERE c.total_token_supply > 0`,
        )
        .all()) {
        const accounted = db
          .prepare(
            `SELECT
                COALESCE((SELECT SUM(quantity) FROM holdings WHERE token_id=?),0) +
                COALESCE((SELECT SUM(quantity) FROM orders WHERE token_id=? AND status='판매중'),0)
              AS quantity`,
          )
          .get(container.token_id, container.token_id).quantity;
        const missing = container.total_token_supply - Number(accounted || 0);
        if (missing > 0) {
          upsertHolding.run(
            randomBytes(16).toString("hex"),
            container.owner_id,
            container.token_id,
            container.id,
            missing,
            container.token_price,
          );
          issueLedger.run(
            randomBytes(16).toString("hex"),
            container.owner_id,
            container.token_id,
            "available",
            "CREDIT",
            missing,
            "ISSUE",
            null,
            null,
            timestamp,
          );
          issueLedger.run(
            randomBytes(16).toString("hex"),
            container.owner_id,
            container.token_id,
            "settled",
            "CREDIT",
            missing,
            "ISSUE",
            null,
            null,
            timestamp,
          );
        }
      }

      db.prepare(
        `INSERT OR IGNORE INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
         SELECT id,seller_id,token_id,container_id,'SELL','LIMIT',unit_price,
                CASE
                  WHEN original_quantity > 0 THEN original_quantity
                  WHEN quantity > 0 THEN quantity
                  ELSE 1
                END,
                quantity,
                CASE status
                  WHEN '판매중' THEN CASE WHEN quantity < original_quantity AND quantity > 0 THEN 'partially_filled' ELSE 'open' END
                  WHEN '거래완료' THEN 'filled'
                  WHEN '취소' THEN 'cancelled'
                  ELSE 'rejected'
                END,
                'INTERNAL',
                NULL,
                idempotency_key,
                id,
                created_at,
                updated_at
           FROM orders`,
      ).run();

      db.prepare("DELETE FROM token_positions").run();
      const upsertPosition = db.prepare(
        `INSERT INTO token_positions (user_id,token_id,container_id,available_quantity,reserved_quantity,unsettled_quantity,settled_quantity,updated_at)
         VALUES (?,?,?,?,0,0,?,?)
         ON CONFLICT(user_id,token_id) DO UPDATE SET
           available_quantity=excluded.available_quantity,
           settled_quantity=excluded.settled_quantity,
           updated_at=excluded.updated_at`,
      );
      for (const holding of db
        .prepare(
          "SELECT user_id,token_id,container_id,quantity FROM holdings WHERE quantity > 0",
        )
        .all())
        upsertPosition.run(
          holding.user_id,
          holding.token_id,
          holding.container_id,
          holding.quantity,
          holding.quantity,
          timestamp,
        );
      const upsertReserved = db.prepare(
        `INSERT INTO token_positions (user_id,token_id,container_id,available_quantity,reserved_quantity,unsettled_quantity,settled_quantity,updated_at)
         VALUES (?,?,?,0,?,0,?,?)
         ON CONFLICT(user_id,token_id) DO UPDATE SET
           reserved_quantity=excluded.reserved_quantity,
           settled_quantity=token_positions.available_quantity+excluded.reserved_quantity,
           updated_at=excluded.updated_at`,
      );
      for (const order of db
        .prepare(
          "SELECT seller_id,token_id,container_id,SUM(quantity) AS quantity FROM orders WHERE status='판매중' GROUP BY seller_id,token_id,container_id",
        )
        .all())
        upsertReserved.run(
          order.seller_id,
          order.token_id,
          order.container_id,
          order.quantity,
          order.quantity,
          timestamp,
        );
      const settledSnapshot = db.prepare(
        "INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
      );
      for (const position of db
        .prepare(
          "SELECT user_id,token_id,settled_quantity FROM token_positions WHERE settled_quantity > 0",
        )
        .all()) {
        const exists = db
          .prepare(
            "SELECT 1 FROM token_ledger_entries WHERE user_id=? AND token_id=? AND position_bucket='settled' AND reason='SNAPSHOT'",
          )
          .get(position.user_id, position.token_id);
        if (!exists)
          settledSnapshot.run(
            randomBytes(16).toString("hex"),
            position.user_id,
            position.token_id,
            "settled",
            "CREDIT",
            position.settled_quantity,
            "SNAPSHOT",
            null,
            null,
            timestamp,
          );
      }
      db.prepare("INSERT INTO schema_migrations VALUES (?,?)").run(10, now());
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return {
    db,
    transaction(fn) {
      db.exec("BEGIN IMMEDIATE");
      try {
        const value = fn();
        db.exec("COMMIT");
        return value;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    },
    audit(actorId, action, entityType, entityId, metadata = {}) {
      db.prepare("INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?)").run(
        randomBytes(16).toString("hex"),
        actorId || null,
        action,
        entityType,
        entityId,
        JSON.stringify(metadata),
        now(),
      );
    },
    appendBlock(eventType, entityType, entityId, payload) {
      return appendBlock(
        db,
        signingKey,
        eventType,
        entityType,
        entityId,
        payload,
      );
    },
    enqueueChainOperation(operationType, entityType, entityId, payload) {
      const id = `chain-${randomBytes(12).toString("hex")}`;
      const timestamp = now();
      db.prepare(
        "INSERT INTO public_chain_operations (id,operation_type,entity_type,entity_id,payload_json,status,created_at,updated_at) VALUES (?,?,?,?,?,'pending',?,?)",
      ).run(
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
    verifyBlockchain() {
      return verifyBlockchain(db, signingKey);
    },
    close() {
      db.close();
    },
  };
}
