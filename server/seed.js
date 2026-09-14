import { randomBytes } from "node:crypto";
import { appendBlock, hashPassword, sha256 } from "./database.js";

// Local development / test fixtures only (see createDatabase in database.js:
// only inserted when the schema is empty and NODE_ENV isn't "production").
// Fake demo accounts and sample farms, not real user data.
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

const demoAccountLabels = {
  u1: "일반 유저",
  "farmer-a": "농장주",
  admin: "관리자",
};

// Single source of truth for the admin.html "데모 계정" reference table —
// these are the *originally seeded* credentials, not necessarily whatever a
// password is right now (there's no way to show that; see /api/me/password
// and /api/admin/users/:id/reset-password, which both only ever overwrite a
// hash, never read one back).
export const demoAccounts = fixtures.users.map(([id, name, email, password]) => ({
  id,
  label: demoAccountLabels[id] || name,
  email,
  password,
}));

export async function seed(db, signingKey) {
  const t = new Date().toISOString();
  const insertUser = db.prepare(
    "INSERT INTO users (id,name,email,password_hash,role,phone,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const [id, name, email, password, role, phone] of fixtures.users)
    await insertUser.run(id, name, email, hashPassword(password), role, phone, t, t);
  const insertFarm = db.prepare(
    "INSERT INTO farms VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const row of fixtures.farms) await insertFarm.run(...row, t, t);
  const insertContainer = db.prepare(
    "INSERT INTO containers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const row of fixtures.containers) await insertContainer.run(...row, t, t);
  const insertSensor = db.prepare(
    "INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
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
    await insertSensor.run(
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
    "INSERT INTO holdings VALUES (?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const row of [
    ["h1", "u1", "SFC-A01", "a-01", 4, 115000],
    ["h2", "u1", "SFC-A02", "a-02", 2, 92000],
    ["h3", "u1", "SFC-B01", "b-01", 1, 80000],
    ["h4", "farmer-a", "SFC-A01", "a-01", 4, 120000],
    ["h5", "farmer-a", "SFC-A02", "a-02", 7, 95000],
    ["h6", "farmer-a", "SFC-A03", "a-03", 10, 85000],
    ["h7", "admin", "SFC-B01", "b-01", 8, 80000],
    ["h8", "admin", "SFC-C01", "c-01", 7, 108000],
  ])
    await insertHolding.run(...row);
  const insertOrder = db.prepare(
    "INSERT INTO orders VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING",
  );
  for (const row of [
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
  ])
    await insertOrder.run(...row);

  await appendBlock(db, signingKey, "GENESIS", "network", "green-link", {
    network: "GREEN LINK",
    version: 1,
  });

  // Derive the trading-engine tables (container_tokens, token_positions,
  // token_orders, ledger snapshots) from the base fixtures above. Mirrors what
  // the old SQLite migrations backfilled from pre-existing data, run once here
  // since a fresh database has no pre-existing rows to migrate.
  const termsJson = "{}";
  await db
    .prepare(
      `INSERT INTO container_tokens (id,container_id,issuer_id,symbol,total_supply,initial_price,status,terms_json,terms_hash,execution_venue,created_at,updated_at)
       SELECT c.token_id,c.id,f.owner_id,c.token_id,c.total_token_supply,c.token_price,
              CASE WHEN c.total_token_supply > 0 THEN 'issued' ELSE 'requested' END,
              ?,?,'INTERNAL',c.created_at,c.updated_at
         FROM containers c JOIN farms f ON f.id=c.farm_id
       ON CONFLICT DO NOTHING`,
    )
    .run(termsJson, sha256(termsJson));

  const creditSnapshot = db.prepare(
    "INSERT INTO credit_ledger_entries VALUES (?,?,?,?,?,?,?,?)",
  );
  for (const user of await db
    .prepare("SELECT id,credit_balance FROM users WHERE credit_balance > 0")
    .all())
    await creditSnapshot.run(
      randomBytes(16).toString("hex"),
      user.id,
      "CREDIT",
      user.credit_balance,
      "SNAPSHOT",
      null,
      null,
      t,
    );

  const tokenSnapshot = db.prepare(
    "INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const holding of await db
    .prepare("SELECT user_id,token_id,quantity FROM holdings WHERE quantity > 0")
    .all())
    await tokenSnapshot.run(
      randomBytes(16).toString("hex"),
      holding.user_id,
      holding.token_id,
      "available",
      "CREDIT",
      holding.quantity,
      "SNAPSHOT",
      null,
      null,
      t,
    );
  for (const order of await db
    .prepare(
      "SELECT seller_id,token_id,quantity FROM orders WHERE status='판매중' AND quantity > 0",
    )
    .all())
    await tokenSnapshot.run(
      randomBytes(16).toString("hex"),
      order.seller_id,
      order.token_id,
      "reserved",
      "CREDIT",
      order.quantity,
      "SNAPSHOT",
      null,
      null,
      t,
    );

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
  for (const container of await db
    .prepare(
      `SELECT c.id,c.token_id,c.total_token_supply,c.token_price,f.owner_id
         FROM containers c JOIN farms f ON f.id=c.farm_id
        WHERE c.total_token_supply > 0`,
    )
    .all()) {
    const accounted = (
      await db
        .prepare(
          `SELECT
              COALESCE((SELECT SUM(quantity) FROM holdings WHERE token_id=?),0) +
              COALESCE((SELECT SUM(quantity) FROM orders WHERE token_id=? AND status='판매중'),0)
            AS quantity`,
        )
        .get(container.token_id, container.token_id)
    ).quantity;
    const missing = container.total_token_supply - Number(accounted || 0);
    if (missing > 0) {
      await upsertHolding.run(
        randomBytes(16).toString("hex"),
        container.owner_id,
        container.token_id,
        container.id,
        missing,
        container.token_price,
      );
      await issueLedger.run(
        randomBytes(16).toString("hex"),
        container.owner_id,
        container.token_id,
        "available",
        "CREDIT",
        missing,
        "ISSUE",
        null,
        null,
        t,
      );
      await issueLedger.run(
        randomBytes(16).toString("hex"),
        container.owner_id,
        container.token_id,
        "settled",
        "CREDIT",
        missing,
        "ISSUE",
        null,
        null,
        t,
      );
    }
  }

  await db
    .prepare(
      `INSERT INTO token_orders (id,user_id,token_id,container_id,side,order_type,limit_price,original_quantity,remaining_quantity,status,execution_venue,external_order_id,idempotency_key,legacy_order_id,created_at,updated_at)
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
         FROM orders
       ON CONFLICT DO NOTHING`,
    )
    .run();

  const upsertPosition = db.prepare(
    `INSERT INTO token_positions (user_id,token_id,container_id,available_quantity,reserved_quantity,unsettled_quantity,settled_quantity,updated_at)
     VALUES (?,?,?,?,0,0,?,?)
     ON CONFLICT(user_id,token_id) DO UPDATE SET
       available_quantity=excluded.available_quantity,
       settled_quantity=excluded.settled_quantity,
       updated_at=excluded.updated_at`,
  );
  for (const holding of await db
    .prepare("SELECT user_id,token_id,container_id,quantity FROM holdings WHERE quantity > 0")
    .all())
    await upsertPosition.run(
      holding.user_id,
      holding.token_id,
      holding.container_id,
      holding.quantity,
      holding.quantity,
      t,
    );
  const upsertReserved = db.prepare(
    `INSERT INTO token_positions (user_id,token_id,container_id,available_quantity,reserved_quantity,unsettled_quantity,settled_quantity,updated_at)
     VALUES (?,?,?,0,?,0,?,?)
     ON CONFLICT(user_id,token_id) DO UPDATE SET
       reserved_quantity=excluded.reserved_quantity,
       settled_quantity=token_positions.available_quantity+excluded.reserved_quantity,
       updated_at=excluded.updated_at`,
  );
  for (const order of await db
    .prepare(
      "SELECT seller_id,token_id,container_id,SUM(quantity) AS quantity FROM orders WHERE status='판매중' GROUP BY seller_id,token_id,container_id",
    )
    .all())
    await upsertReserved.run(
      order.seller_id,
      order.token_id,
      order.container_id,
      order.quantity,
      order.quantity,
      t,
    );

  const settledSnapshot = db.prepare(
    "INSERT INTO token_ledger_entries VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  for (const position of await db
    .prepare("SELECT user_id,token_id,settled_quantity FROM token_positions WHERE settled_quantity > 0")
    .all())
    await settledSnapshot.run(
      randomBytes(16).toString("hex"),
      position.user_id,
      position.token_id,
      "settled",
      "CREDIT",
      position.settled_quantity,
      "SNAPSHOT",
      null,
      null,
      t,
    );

  await db
    .prepare("INSERT INTO schema_migrations VALUES (?,?) ON CONFLICT DO NOTHING")
    .run(1, t);
}
