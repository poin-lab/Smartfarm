import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import {
  createDatabase,
  hashPasswordStrong,
  verifyPasswordAsync,
} from "./database.js";
import { createLoginAuthenticator } from "./login-authenticator.js";
import { requestLogger } from "./logger.js";
import { config } from "./config.js";
import { getAddress, isAddress, verifyMessage } from "viem";
import {
  containerTokenId,
  createPublicChain,
  merkleRoot,
  processNextChainOperation,
} from "./public-chain.js";
import {
  BrokerTradingProvider,
  createInternalTradingProvider,
} from "./trading-provider.js";

const text = (value, max = 120) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";
const positiveInt = (value) =>
  Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");
const now = () => new Date().toISOString();
const production = config.env === "production";
const sessionCookie = production
  ? "__Host-green_link_session"
  : "green_link_session";
const cookieOptions = Object.freeze({
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
  maxAge: config.sessionHours * 60 * 60 * 1000,
});
const cookieClearOptions = Object.freeze({
  httpOnly: true,
  sameSite: "lax",
  secure: production,
  path: "/",
});
const normalizeEmail = (value) => text(value, 160).toLowerCase();
const validEmail = (email) =>
  email.length <= 160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const passwordProblem = (value) => {
  if (typeof value !== "string") return "비밀번호를 입력해 주세요.";
  const password = value.normalize("NFC");
  const length = [...password].length;
  if (length < 8) return "비밀번호는 8자 이상이어야 합니다.";
  if (length > 128) return "비밀번호는 128자 이하여야 합니다.";
  return "";
};
const readCookie = (header, name) => {
  for (const part of String(header || "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      return "";
    }
  }
  return "";
};
const defaultRackViews = [
  { id: "rack-a", label: "재배 랙 A", detail: "좌측 상단 베드" },
  { id: "rack-b", label: "재배 랙 B", detail: "우측 상단 베드" },
  { id: "rack-c", label: "재배 랙 C", detail: "좌측 하단 베드" },
  { id: "rack-d", label: "재배 랙 D", detail: "우측 하단 베드" },
];
const publicUser = (record) => {
  return {
    id: record.id,
    name: record.name,
    email: record.email,
    role: record.role,
    phone: record.phone,
    status: record.status,
    walletAddress: record.wallet_address || null,
    mockCreditBalance: record.credit_balance,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
};
const sensorView = (row) =>
  row && {
    ...row,
    containerId: row.container_id,
    soilMoisture: row.soil_moisture,
    updatedAt: row.updated_at,
    history: JSON.parse(row.history_json),
  };
const containerView = (row) =>
  row && {
    ...row,
    farmId: row.farm_id,
    cropName: row.crop_name,
    plantedAt: row.planted_at,
    harvestAt: row.harvest_at,
    tokenId: row.token_id,
    totalTokenSupply: row.total_token_supply,
    availableTokenQuantity: row.available_token_quantity,
    tokenPrice: row.token_price,
    publicChainTokenId: containerTokenId(row.id).toString(),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
const farmView = (row) =>
  row && {
    ...row,
    ownerId: row.owner_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export function createApp({
  store = createDatabase(),
  publicChain = createPublicChain(),
  loginAuthenticator,
} = {}) {
  const app = express();
  const { db } = store;
  const accountAuth = loginAuthenticator || createLoginAuthenticator({ db });
  const trading = createInternalTradingProvider({ db, store });
  const brokerTrading = new BrokerTradingProvider();
  const realtime = new EventEmitter();
  const streamTickets = new Map();
  realtime.setMaxListeners(200);
  app.disable("x-powered-by");
  if (config.trustProxy) app.set("trust proxy", 1);
  app.use(requestLogger);
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "same-site" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(express.json({ limit: "100kb", strict: true }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60_000,
      limit: 240,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skipSuccessfulRequests: true,
  });
  const signupLimiter = rateLimit({
    windowMs: 60 * 60_000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });

  const getUser = (id) =>
    db
      .prepare(
        "SELECT id,name,email,role,phone,wallet_address,credit_balance,status,last_login_at,password_changed_at,created_at,updated_at,password_hash FROM users WHERE id=?",
      )
      .get(id);
  const createSession = (userId) => {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(
      Date.now() + config.sessionHours * 60 * 60 * 1000,
    ).toISOString();
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").run(now());
    db.prepare("INSERT INTO sessions VALUES (?,?,?,?)").run(
      tokenHash(token),
      userId,
      expiresAt,
      now(),
    );
    return { token, expiresAt };
  };
  const auth = (req, res, next) => {
    const cookieToken = readCookie(req.headers.cookie, sessionCookie);
    const bearerToken =
      req.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = cookieToken || bearerToken;
    if (!token)
      return res.status(401).json({ message: "로그인이 필요합니다." });
    const session = db
      .prepare(
        "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>? ",
      )
      .get(tokenHash(token), now());
    if (!session)
      return res.status(401).json({ message: "로그인이 만료되었습니다." });
    const user = getUser(session.user_id);
    if (!user || user.status !== "active")
      return res.status(401).json({ message: "로그인이 필요합니다." });
    if (
      cookieToken &&
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      req.headers["x-green-link-request"] !== "1"
    )
      return res.status(403).json({ message: "요청을 확인할 수 없습니다." });
    req.user = user;
    req.sessionTokenHash = tokenHash(token);
    next();
  };
  const admin = (req, res, next) =>
    req.user?.role === "admin"
      ? next()
      : res.status(403).json({ message: "관리자 권한이 필요합니다." });
  const getContainer = (id) =>
    db.prepare("SELECT * FROM containers WHERE id=?").get(id);
  const getFarm = (id) => db.prepare("SELECT * FROM farms WHERE id=?").get(id);
  const getRackViews = (containerId) => {
    const content = db
      .prepare(
        "SELECT rack_views_json FROM container_page_content WHERE container_id=?",
      )
      .get(containerId);
    if (!content) return defaultRackViews;
    try {
      const rackViews = JSON.parse(content.rack_views_json);
      return Array.isArray(rackViews) && rackViews.length === 4
        ? rackViews
        : defaultRackViews;
    } catch {
      return defaultRackViews;
    }
  };
  const containerMarketView = (container) => {
    const view = containerView(container);
    if (!view) return null;
    const orderStats = db
      .prepare(
        "SELECT COALESCE(SUM(quantity),0) AS open_sell_quantity,MIN(unit_price) AS lowest_ask_price FROM orders WHERE container_id=? AND status='판매중' AND quantity>0",
      )
      .get(view.id);
    const token = db
      .prepare("SELECT * FROM container_tokens WHERE container_id=?")
      .get(view.id);
    const lastExecution = db
      .prepare(
        "SELECT unit_price FROM token_executions WHERE token_id=? ORDER BY executed_at DESC LIMIT 1",
      )
      .get(view.tokenId);
    const marketAvailableQuantity = Number(orderStats.open_sell_quantity || 0);
    const lowestAskPrice = orderStats.lowest_ask_price || null;
    const lastExecutionPrice = lastExecution?.unit_price || null;
    const initialTokenPrice = token?.initial_price ?? view.tokenPrice;
    return {
      ...view,
      initialTokenPrice,
      tokenPrice: lowestAskPrice || lastExecutionPrice || initialTokenPrice,
      availableTokenQuantity: marketAvailableQuantity,
      marketAvailableQuantity,
      lowestAskPrice,
      lastExecutionPrice,
      issuerId: token?.issuer_id || null,
      tokenStatus:
        token?.status || (view.totalTokenSupply > 0 ? "issued" : "requested"),
      executionVenue: token?.execution_venue || "INTERNAL",
    };
  };
  const withFarm = (container) => {
    const view = containerMarketView(container);
    if (!view) return null;
    return {
      ...view,
      farm: farmView(getFarm(view.farmId)),
      rackViews: getRackViews(view.id),
    };
  };
  const orderView = (row) =>
    row && {
      ...row,
      sellerId: row.seller_id,
      tokenId: row.token_id,
      containerId: row.container_id,
      sellerName: row.seller_name,
      quantity: row.quantity,
      originalQuantity: row.original_quantity || row.quantity,
      remainingQuantity: row.quantity,
      unitPrice: row.unit_price,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      container: containerMarketView(getContainer(row.container_id)),
    };
  const holdingView = (row, reservedQuantity = 0) => {
    const quantity = Number(row.quantity);
    return {
      ...row,
      userId: row.user_id,
      tokenId: row.token_id,
      containerId: row.container_id,
      quantity,
      availableQuantity: quantity,
      reservedQuantity,
      settledQuantity: quantity + reservedQuantity,
      averagePrice: row.average_price,
      container: containerMarketView(getContainer(row.container_id)),
    };
  };
  const reservedByToken = (userId) =>
    new Map(
      db
        .prepare(
          "SELECT token_id,COALESCE(SUM(quantity),0) AS quantity FROM orders WHERE seller_id=? AND status='판매중' GROUP BY token_id",
        )
        .all(userId)
        .map((row) => [row.token_id, Number(row.quantity)]),
    );
  const idempotencyKey = (req) =>
    text(req.get("Idempotency-Key") || req.body?.idempotencyKey, 160);
  const sendTradingResult = (res, result) =>
    result.body === null
      ? res.status(result.status).end()
      : res.status(result.status).json(result.body);
  const tradingError = (res, error, fallback) =>
    res.status(error.code || 500).json({
      message: error.code ? error.message : fallback,
    });
  const audit = (req, action, type, id, metadata) =>
    store.audit(req.user?.id, action, type, id, metadata);
  const publish = (containerId, type, payload) =>
    realtime.emit(`container:${containerId}`, {
      type,
      payload,
      timestamp: now(),
    });
  const deviceAuth = (types) => (req, res, next) => {
    const key = text(req.headers["x-device-key"], 200);
    if (!key)
      return res.status(401).json({ message: "장비 인증키가 필요합니다." });
    const device = db
      .prepare(
        "SELECT * FROM iot_devices WHERE api_key_hash=? AND status!='disabled'",
      )
      .get(tokenHash(key));
    if (!device || (types && !types.includes(device.device_type)))
      return res
        .status(401)
        .json({ message: "유효하지 않은 장비 인증키입니다." });
    db.prepare(
      "UPDATE iot_devices SET status='online',last_seen_at=?,updated_at=? WHERE id=?",
    ).run(now(), now(), device.id);
    req.device = device;
    next();
  };
  const sensorPayload = (body) => {
    const ranges = {
      temperature: [-30, 70],
      humidity: [0, 100],
      light: [0, 250000],
      co2: [0, 10000],
      soilMoisture: [0, 100],
      ph: [0, 14],
      ec: [0, 20],
    };
    const payload = {};
    for (const [key, [min, max]] of Object.entries(ranges)) {
      const value = Number(body?.[key]);
      if (!Number.isFinite(value) || value < min || value > max) return null;
      payload[key] = value;
    }
    return payload;
  };
  const liveTicketAuth = (req, res, next) => {
    const ticket = text(req.query.ticket, 160);
    const record = ticket && streamTickets.get(ticket);
    if (
      record &&
      record.expiresAt > Date.now() &&
      record.containerId === req.params.id
    ) {
      streamTickets.delete(ticket);
      req.user = getUser(record.userId);
      return next();
    }
    if (ticket) streamTickets.delete(ticket);
    return auth(req, res, next);
  };

  app.get("/api/health", (_req, res) => {
    const check = db.prepare("PRAGMA integrity_check").get();
    const blockchain = store.verifyBlockchain();
    const ok = check.integrity_check === "ok" && blockchain.valid;
    res.status(ok ? 200 : 503).json({
      ok,
      service: "smartfarm-api",
      database: "sqlite",
      blockchain,
      timestamp: now(),
    });
  });
  app.post("/api/auth/signup", signupLimiter, async (req, res) => {
    const name = text(req.body?.name, 30);
    const phone = text(req.body?.phone, 20);
    const email = normalizeEmail(req.body?.email);
    const password =
      typeof req.body?.password === "string"
        ? req.body.password.normalize("NFC")
        : "";
    if (!name)
      return res.status(400).json({ message: "이름을 입력해 주세요." });
    if (!validEmail(email))
      return res
        .status(400)
        .json({ message: "올바른 이메일을 입력해 주세요." });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ message: problem });
    if (db.prepare("SELECT 1 FROM users WHERE email=?").get(email))
      return res.status(409).json({ message: "이미 가입된 이메일입니다." });

    const id = `user-${randomUUID()}`;
    const createdAt = now();
    const passwordHash = await hashPasswordStrong(password);
    let session;
    try {
      store.transaction(() => {
        db.prepare(
          "INSERT INTO users (id,name,email,password_hash,role,phone,status,password_changed_at,created_at,updated_at) VALUES (?,?,?,?,'user',?,'active',?,?,?)",
        ).run(
          id,
          name,
          email,
          passwordHash,
          phone,
          createdAt,
          createdAt,
          createdAt,
        );
        session = createSession(id);
        store.audit(id, "REGISTER", "user", id, {});
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE"))
        return res.status(409).json({ message: "이미 가입된 이메일입니다." });
      throw error;
    }
    res.cookie(sessionCookie, session.token, cookieOptions);
    return res.status(201).json({
      user: publicUser(getUser(id)),
      expiresAt: session.expiresAt,
    });
  });
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password =
      typeof req.body?.password === "string" && req.body.password.length <= 1024
        ? req.body.password
        : "";
    let account;
    try {
      account = await accountAuth.authenticate(email, password);
    } catch (error) {
      console.error("Failed to authenticate login account:", error.message);
      return res
        .status(503)
        .json({ message: "로그인 계정 설정을 확인해 주세요." });
    }
    let user = account && getUser(account.id);
    if (!user || user.role !== account.role || user.status !== "active")
      return res
        .status(401)
        .json({ message: "이메일 또는 비밀번호를 확인해 주세요." });
    let session;
    store.transaction(() => {
      session = createSession(user.id);
      db.prepare(
        "UPDATE users SET last_login_at=?,updated_at=? WHERE id=?",
      ).run(now(), now(), user.id);
      store.audit(user.id, "LOGIN", "user", user.id, {});
    });
    user = getUser(user.id);
    res.cookie(sessionCookie, session.token, cookieOptions);
    res.json({ user: publicUser(user), expiresAt: session.expiresAt });
  });
  app.post("/api/auth/logout", auth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE token_hash=?").run(
      req.sessionTokenHash,
    );
    audit(req, "LOGOUT", "user", req.user.id, {});
    res.clearCookie(sessionCookie, cookieClearOptions);
    res.status(204).end();
  });
  app.get("/api/me", auth, (req, res) => res.json(publicUser(req.user)));
  app.get("/api/public-chain/status", (_req, res) =>
    res.json(publicChain.status()),
  );
  app.post("/api/me/wallet/challenge", auth, (req, res) => {
    const nonce = randomBytes(24).toString("base64url"),
      createdAt = now();
    const message = `GREEN LINK wallet link\nUser: ${req.user.id}\nNonce: ${nonce}`;
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    db.prepare(
      "INSERT INTO wallet_challenges VALUES (?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET nonce=excluded.nonce,message=excluded.message,expires_at=excluded.expires_at,created_at=excluded.created_at",
    ).run(req.user.id, nonce, message, expiresAt, createdAt);
    res.json({ message, expiresAt });
  });
  app.post("/api/me/wallet/verify", auth, async (req, res) => {
    const address = text(req.body?.address, 50),
      signature = text(req.body?.signature, 160);
    const challenge = db
      .prepare(
        "SELECT * FROM wallet_challenges WHERE user_id=? AND expires_at>?",
      )
      .get(req.user.id, now());
    if (
      !challenge ||
      !isAddress(address) ||
      !/^0x[0-9a-fA-F]{130}$/.test(signature)
    )
      return res
        .status(400)
        .json({ message: "유효한 지갑 서명 요청이 아닙니다." });
    const valid = await verifyMessage({
      address: getAddress(address),
      message: challenge.message,
      signature,
    });
    if (!valid)
      return res
        .status(401)
        .json({ message: "지갑 서명이 일치하지 않습니다." });
    store.transaction(() => {
      db.prepare(
        "UPDATE users SET wallet_address=?,updated_at=? WHERE id=?",
      ).run(getAddress(address), now(), req.user.id);
      db.prepare("DELETE FROM wallet_challenges WHERE user_id=?").run(
        req.user.id,
      );
      audit(req, "LINK_PUBLIC_WALLET", "user", req.user.id, {
        address: getAddress(address),
      });
    });
    res.json(publicUser(getUser(req.user.id)));
  });
  app.patch("/api/me", auth, (req, res) => {
    const name = text(req.body?.name, 30),
      phone = text(req.body?.phone, 20);
    if (!name)
      return res.status(400).json({ message: "이름을 입력해 주세요." });
    db.prepare("UPDATE users SET name=?,phone=?,updated_at=? WHERE id=?").run(
      name,
      phone,
      now(),
      req.user.id,
    );
    audit(req, "UPDATE_PROFILE", "user", req.user.id, {});
    res.json(publicUser(getUser(req.user.id)));
  });
  app.patch("/api/me/password", auth, async (req, res) => {
    const currentPassword =
      typeof req.body?.currentPassword === "string"
        ? req.body.currentPassword
        : "";
    const newPassword =
      typeof req.body?.newPassword === "string"
        ? req.body.newPassword.normalize("NFC")
        : "";
    const problem = passwordProblem(newPassword);
    if (problem) return res.status(400).json({ message: problem });
    if (!(await verifyPasswordAsync(currentPassword, req.user.password_hash)))
      return res
        .status(401)
        .json({ message: "현재 비밀번호가 일치하지 않습니다." });
    if (currentPassword.normalize("NFC") === newPassword)
      return res
        .status(400)
        .json({ message: "기존과 다른 비밀번호를 사용해 주세요." });

    const passwordHash = await hashPasswordStrong(newPassword);
    const changedAt = now();
    store.transaction(() => {
      db.prepare(
        "UPDATE users SET password_hash=?,password_changed_at=?,updated_at=? WHERE id=?",
      ).run(passwordHash, changedAt, changedAt, req.user.id);
      db.prepare("DELETE FROM sessions WHERE user_id=? AND token_hash<>?").run(
        req.user.id,
        req.sessionTokenHash,
      );
      audit(req, "CHANGE_PASSWORD", "user", req.user.id, {});
    });
    res.status(204).end();
  });

  app.get("/api/farms", (req, res) => {
    const query = text(req.query.q, 80).toLowerCase(),
      status = text(req.query.status, 20);
    const rows = db
      .prepare(
        `SELECT f.*,COUNT(c.id) AS containerCount FROM farms f LEFT JOIN containers c ON c.farm_id=f.id WHERE (?='' OR lower(f.name||' '||f.address) LIKE '%'||?||'%') AND (?='' OR ?='전체' OR f.status=?) GROUP BY f.id ORDER BY f.created_at`,
      )
      .all(query, query, status, status, status);
    res.json(
      rows.map((row) => ({
        ...farmView(row),
        containerCount: Number(row.containerCount),
      })),
    );
  });
  app.get("/api/farms/:id", (req, res) => {
    const farm = getFarm(req.params.id);
    if (!farm)
      return res.status(404).json({ message: "농장을 찾을 수 없습니다." });
    res.json({
      ...farmView(farm),
      containers: db
        .prepare("SELECT * FROM containers WHERE farm_id=? ORDER BY id")
        .all(farm.id)
        .map(containerMarketView),
    });
  });
  app.get("/api/containers", (req, res) => {
    const query = text(req.query.q, 80).toLowerCase(),
      farmId = text(req.query.farmId, 50);
    const rows = db
      .prepare(
        "SELECT * FROM containers WHERE (?='' OR farm_id=?) AND (?='' OR lower(name||' '||crop_name||' '||token_id) LIKE '%'||?||'%') ORDER BY id",
      )
      .all(farmId, farmId, query, query);
    res.json(rows.map(withFarm));
  });
  app.get("/api/containers/:id", (req, res) => {
    const row = withFarm(getContainer(req.params.id));
    if (!row)
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    res.json(row);
  });
  app.post("/api/containers/:id/token-requests", auth, (req, res) => {
    try {
      const requested = trading.requestIssuance({
        userId: req.user.id,
        containerId: req.params.id,
        supply: positiveInt(req.body?.supply),
        price: positiveInt(req.body?.price),
        terms: req.body?.terms || {},
      });
      res.status(201).json(requested);
    } catch (error) {
      tradingError(res, error, "토큰 발행 신청 중 오류가 발생했습니다.");
    }
  });
  app.get("/api/containers/:id/sensors", (req, res) => {
    const row = sensorView(
      db
        .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
        .get(req.params.id),
    );
    if (!row)
      return res
        .status(404)
        .json({ message: "센서 데이터를 찾을 수 없습니다." });
    res.json(row);
  });

  app.get("/api/orders", (req, res) => {
    res.json(
      trading
        .listPublicSellOrders({ query: req.query.q })
        .map((row) => orderView(row)),
    );
  });
  app.post("/api/orders/:id/purchase", auth, (req, res) => {
    try {
      const result = trading.purchaseSellOrder({
        buyerId: req.user.id,
        orderId: req.params.id,
        quantity: positiveInt(req.body?.quantity),
        key: idempotencyKey(req),
      });
      return sendTradingResult(res, result);
    } catch (error) {
      return tradingError(res, error, "주문 처리 중 오류가 발생했습니다.");
    }
  });
  app.post("/api/orders", auth, (req, res) => {
    try {
      const result = trading.placeSellOrder({
        userId: req.user.id,
        tokenId: text(req.body?.tokenId, 30),
        quantity: positiveInt(req.body?.quantity),
        unitPrice: positiveInt(req.body?.unitPrice),
        key: idempotencyKey(req),
      });
      const body =
        orderView(
          db.prepare("SELECT * FROM orders WHERE id=?").get(result.body.id),
        ) || result.body;
      return res.status(result.status).json(body);
    } catch (error) {
      return tradingError(res, error, "판매 주문 처리 중 오류가 발생했습니다.");
    }
  });
  app.post("/api/orders/:id/cancel", auth, (req, res) => {
    try {
      const result = trading.cancelSellOrder({
        userId: req.user.id,
        orderId: req.params.id,
      });
      return sendTradingResult(res, result);
    } catch (error) {
      return tradingError(res, error, "판매 주문 취소 중 오류가 발생했습니다.");
    }
  });
  app.get("/api/trading/provider", auth, (req, res) => {
    res.json({
      internal: {
        provider: trading.name,
        executionVenue: trading.executionVenue,
        connected: true,
        mode: "internal-db",
      },
      broker: brokerTrading.capabilities(),
      paymentProvider: "mock",
      disclaimers: [
        "결제는 원화 입출금이 아닌 개발용 모의 크레딧입니다.",
        "토큰은 농장 소유권, 증권, 배당권 또는 수익 보장을 의미하지 않습니다.",
      ],
    });
  });
  app.get("/api/trading/instruments", auth, (req, res) => {
    res.json(trading.listInstruments());
  });
  app.get("/api/trading/instruments/:tokenId/quote", auth, (req, res) => {
    res.json(trading.getQuote(req.params.tokenId));
  });
  app.get("/api/trading/positions", auth, (req, res) => {
    res.json(trading.listPositions(req.user.id));
  });
  app.get("/api/trading/orders", auth, (req, res) => {
    const userId =
      req.user.role === "admin" && req.query.all === "1" ? "" : req.user.id;
    res.json(
      trading.listOrders({
        userId,
        tokenId: text(req.query.tokenId, 40),
      }),
    );
  });
  app.post("/api/trading/orders", auth, (req, res) => {
    try {
      const result = trading.placeOrder({
        userId: req.user.id,
        body: { ...req.body, idempotencyKey: idempotencyKey(req) },
      });
      return sendTradingResult(res, result);
    } catch (error) {
      return tradingError(res, error, "거래 주문 처리 중 오류가 발생했습니다.");
    }
  });
  app.get("/api/trading/orders/:id", auth, (req, res) => {
    const order = trading.getOrder(req.params.id);
    if (!order)
      return res.status(404).json({ message: "주문을 찾을 수 없습니다." });
    if (req.user.role !== "admin" && order.userId !== req.user.id)
      return res.status(403).json({ message: "접근 권한이 없습니다." });
    res.json(order);
  });
  app.post("/api/trading/orders/:id/cancel", auth, (req, res) => {
    try {
      const result = trading.cancelOrder({
        userId: req.user.id,
        orderId: req.params.id,
      });
      return sendTradingResult(res, result);
    } catch (error) {
      return tradingError(res, error, "주문 취소 중 오류가 발생했습니다.");
    }
  });
  app.get("/api/trading/executions", auth, (req, res) => {
    const userId =
      req.user.role === "admin" && req.query.all === "1" ? "" : req.user.id;
    res.json(
      trading.listExecutions({
        userId,
        tokenId: text(req.query.tokenId, 40),
      }),
    );
  });
  app.get("/api/wallet", auth, (req, res) => {
    const openOrders = db
      .prepare(
        "SELECT * FROM orders WHERE seller_id=? AND status='판매중' ORDER BY created_at DESC",
      )
      .all(req.user.id)
      .map(orderView);
    const positions = trading.listPositions(req.user.id);
    const positionByToken = new Map(
      positions.map((position) => [position.tokenId, position]),
    );
    const reserved = reservedByToken(req.user.id);
    const holdings = db
      .prepare(
        "SELECT * FROM holdings WHERE user_id=? AND quantity>0 ORDER BY token_id",
      )
      .all(req.user.id)
      .map((row) => {
        const position = positionByToken.get(row.token_id);
        return {
          ...holdingView(
            row,
            position?.reservedQuantity ?? reserved.get(row.token_id) ?? 0,
          ),
          availableQuantity: position?.availableQuantity ?? row.quantity,
          reservedQuantity:
            position?.reservedQuantity ?? reserved.get(row.token_id) ?? 0,
          unsettledQuantity: position?.unsettledQuantity ?? 0,
          settledQuantity: position?.settledQuantity ?? row.quantity,
        };
      });
    const transactions = db
      .prepare(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 20",
      )
      .all(req.user.id)
      .map((row) => ({
        ...row,
        userId: row.user_id,
        tokenId: row.token_id,
        unitPrice: row.unit_price,
        createdAt: row.created_at,
      }));
    const availableTokens = holdings.reduce((sum, h) => sum + h.quantity, 0);
    const listedTokens = openOrders.reduce(
      (sum, order) => sum + order.quantity,
      0,
    );
    res.json({
      holdings,
      openOrders,
      positions,
      availableTokens,
      listedTokens,
      totalTokens: availableTokens + listedTokens,
      settledTokens: positions.reduce(
        (sum, position) => sum + position.settledQuantity,
        0,
      ),
      unsettledTokens: positions.reduce(
        (sum, position) => sum + position.unsettledQuantity,
        0,
      ),
      totalValue:
        holdings.reduce((sum, h) => sum + h.quantity * h.averagePrice, 0) +
        openOrders.reduce(
          (sum, order) => sum + order.quantity * order.unitPrice,
          0,
        ),
      mockCreditBalance: getUser(req.user.id).credit_balance,
      paymentProvider: "mock",
      transactions,
    });
  });
  app.get("/api/dashboard", auth, (req, res) => {
    const farms = db
      .prepare("SELECT * FROM farms WHERE owner_id=? ORDER BY created_at")
      .all(req.user.id)
      .map(farmView);
    const ids = farms.map((farm) => farm.id);
    const containers = ids.length
      ? db
          .prepare(
            `SELECT * FROM containers WHERE farm_id IN (${ids.map(() => "?").join(",")})`,
          )
          .all(...ids)
          .map(withFarm)
      : [];
    const alerts = containers.flatMap((container) => {
      const sensor = sensorView(
        db
          .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
          .get(container.id),
      );
      return sensor && (sensor.temperature > 27 || sensor.soilMoisture < 45)
        ? [
            {
              id: container.id,
              message: `${container.name} 환경 수치를 확인해 주세요.`,
              level: "warning",
            },
          ]
        : [];
    });
    const allOpenOrders = db
      .prepare(
        "SELECT * FROM orders WHERE seller_id=? AND status='판매중' ORDER BY created_at DESC",
      )
      .all(req.user.id)
      .map(orderView);
    const reserved = reservedByToken(req.user.id);
    const holdings = db
      .prepare(
        "SELECT * FROM holdings WHERE user_id=? AND quantity>0 ORDER BY token_id",
      )
      .all(req.user.id)
      .map((row) => holdingView(row, reserved.get(row.token_id) || 0));
    const holdingValue =
      holdings.reduce(
        (sum, holding) => sum + holding.quantity * holding.averagePrice,
        0,
      ) +
      allOpenOrders.reduce(
        (sum, order) => sum + order.quantity * order.unitPrice,
        0,
      );
    const mockCreditBalance = getUser(req.user.id).credit_balance;
    const openOrderCount = allOpenOrders.length;
    const openOrders = allOpenOrders.slice(0, 3);
    const recentTransactions = db
      .prepare(
        "SELECT * FROM transactions WHERE user_id=? ORDER BY created_at DESC LIMIT 3",
      )
      .all(req.user.id)
      .map((row) => ({
        ...row,
        userId: row.user_id,
        tokenId: row.token_id,
        unitPrice: row.unit_price,
        createdAt: row.created_at,
      }));
    res.json({
      wallet: {
        linkedAccount: null,
        totalAssets: mockCreditBalance + holdingValue,
        mockCreditBalance,
        holdingValue,
        totalTokens:
          holdings.reduce((sum, holding) => sum + holding.quantity, 0) +
          allOpenOrders.reduce((sum, order) => sum + order.quantity, 0),
        openOrderCount,
        openOrders,
        recentTransactions,
        holdings,
      },
      farmCount: farms.length,
      containerCount: containers.length,
      alerts,
    });
  });
  // Real-time browser channel. A connected browser receives a sensor snapshot,
  // device updates and controller acknowledgements as Server-Sent Events.
  app.post("/api/containers/:id/live-ticket", auth, (req, res) => {
    if (!getContainer(req.params.id))
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    const ticket = randomBytes(24).toString("base64url");
    streamTickets.set(ticket, {
      containerId: req.params.id,
      userId: req.user.id,
      expiresAt: Date.now() + 60_000,
    });
    res.json({ ticket, expiresIn: 60 });
  });
  app.get("/api/containers/:id/live", liveTicketAuth, (req, res) => {
    if (!getContainer(req.params.id))
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event) =>
      res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    const sensor = sensorView(
      db
        .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
        .get(req.params.id),
    );
    send({ type: "snapshot", payload: { sensor }, timestamp: now() });
    const listener = (event) => send(event);
    realtime.on(`container:${req.params.id}`, listener);
    const heartbeat = setInterval(
      () =>
        res.write(
          `event: ping\ndata: ${JSON.stringify({ timestamp: now() })}\n\n`,
        ),
      25000,
    );
    req.on("close", () => {
      clearInterval(heartbeat);
      realtime.off(`container:${req.params.id}`, listener);
    });
  });
  app.get("/api/containers/:id/camera", auth, (req, res) => {
    if (!getContainer(req.params.id))
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    const camera = db
      .prepare("SELECT * FROM camera_streams WHERE container_id=?")
      .get(req.params.id);
    res.json(
      camera
        ? {
            containerId: camera.container_id,
            hlsUrl: camera.hls_url,
            status: camera.status,
            updatedAt: camera.updated_at,
          }
        : {
            containerId: req.params.id,
            hlsUrl: null,
            status: "offline",
            updatedAt: null,
          },
    );
  });
  // Hardware gateway endpoints: sensor firmware sends readings here using a
  // per-device key; controllers poll their command queue and acknowledge work.
  app.post("/api/iot/ingest/sensors", deviceAuth(["sensor"]), (req, res) => {
    const payload = sensorPayload(req.body);
    if (!payload)
      return res
        .status(400)
        .json({ message: "센서 값 범위가 올바르지 않습니다." });
    const device = req.device;
    const timestamp = now();
    store.transaction(() => {
      const current = sensorView(
        db
          .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
          .get(device.container_id),
      );
      const history = [
        ...(current?.history || []).slice(-7),
        payload.temperature,
      ];
      db.prepare(
        "INSERT INTO sensor_readings (container_id,temperature,humidity,light,co2,soil_moisture,ph,ec,history_json,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET temperature=excluded.temperature,humidity=excluded.humidity,light=excluded.light,co2=excluded.co2,soil_moisture=excluded.soil_moisture,ph=excluded.ph,ec=excluded.ec,history_json=excluded.history_json,updated_at=excluded.updated_at",
      ).run(
        device.container_id,
        payload.temperature,
        payload.humidity,
        payload.light,
        payload.co2,
        payload.soilMoisture,
        payload.ph,
        payload.ec,
        JSON.stringify(history),
        timestamp,
      );
      const eventId = randomUUID();
      db.prepare(
        "INSERT INTO sensor_events (id,container_id,device_id,payload_json,created_at) VALUES (?,?,?,?,?)",
      ).run(
        eventId,
        device.container_id,
        device.id,
        JSON.stringify(payload),
        timestamp,
      );
      store.appendBlock("SENSOR_READING", "sensor_event", eventId, {
        containerId: device.container_id,
        deviceId: device.id,
        ...payload,
        timestamp,
      });
    });
    const sensor = sensorView(
      db
        .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
        .get(device.container_id),
    );
    publish(device.container_id, "sensor", sensor);
    res.status(202).json({ accepted: true, timestamp });
  });
  app.get(
    "/api/iot/commands/pending",
    deviceAuth(["controller"]),
    (req, res) => {
      const commands = db
        .prepare(
          "SELECT * FROM control_commands WHERE container_id=? AND status='queued' ORDER BY requested_at LIMIT 20",
        )
        .all(req.device.container_id)
        .map((row) => ({
          id: row.id,
          containerId: row.container_id,
          command: JSON.parse(row.command_json),
          requestedAt: row.requested_at,
        }));
      res.json({ commands, serverTime: now() });
    },
  );
  app.post(
    "/api/iot/commands/:id/ack",
    deviceAuth(["controller"]),
    (req, res) => {
      const command = db
        .prepare(
          "SELECT * FROM control_commands WHERE id=? AND container_id=? AND status='queued'",
        )
        .get(req.params.id, req.device.container_id);
      if (!command)
        return res
          .status(404)
          .json({ message: "처리 대기 명령을 찾을 수 없습니다." });
      const status = req.body?.success === false ? "failed" : "acknowledged";
      const result = text(req.body?.message, 300);
      const acknowledgedAt = now();
      store.transaction(() => {
        db.prepare(
          "UPDATE control_commands SET status=?,acknowledged_at=?,result_json=? WHERE id=?",
        ).run(
          status,
          acknowledgedAt,
          JSON.stringify({ message: result }),
          command.id,
        );
        store.appendBlock("CONTROL_ACK", "control_command", command.id, {
          deviceId: req.device.id,
          status,
          result,
          acknowledgedAt,
        });
      });
      publish(command.container_id, "control_ack", {
        id: command.id,
        status,
        result,
        acknowledgedAt,
      });
      res.json({ ok: true, status });
    },
  );

  app.get("/api/blockchain/verify", auth, (_req, res) =>
    res.json(store.verifyBlockchain()),
  );
  app.get("/api/blockchain/blocks", auth, admin, (req, res) => {
    const limit = Math.min(100, positiveInt(req.query.limit) || 30);
    const blocks = db
      .prepare(
        "SELECT height,previous_hash,payload_hash,block_hash,signature,event_type,entity_type,entity_id,created_at FROM blockchain_blocks ORDER BY height DESC LIMIT ?",
      )
      .all(limit)
      .map((block) => ({
        height: block.height,
        previousHash: block.previous_hash,
        payloadHash: block.payload_hash,
        blockHash: block.block_hash,
        signature: block.signature,
        eventType: block.event_type,
        entityType: block.entity_type,
        entityId: block.entity_id,
        createdAt: block.created_at,
      }));
    res.json({ verification: store.verifyBlockchain(), blocks });
  });
  app.get("/api/public-chain/operations", auth, admin, (req, res) => {
    const limit = Math.min(100, positiveInt(req.query.limit) || 30);
    const rows = db
      .prepare(
        "SELECT * FROM public_chain_operations ORDER BY created_at DESC LIMIT ?",
      )
      .all(limit);
    res.json(
      rows.map((row) => ({
        id: row.id,
        operationType: row.operation_type,
        entityType: row.entity_type,
        entityId: row.entity_id,
        payload: JSON.parse(row.payload_json),
        status: row.status,
        txHash: row.tx_hash,
        blockNumber: row.block_number,
        attempts: row.attempts,
        error: row.error_message,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    );
  });
  app.post("/api/public-chain/marketplace/confirm", auth, async (req, res) => {
    const txHash = text(req.body?.txHash, 70);
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash))
      return res
        .status(400)
        .json({ message: "유효한 EVM transaction hash가 필요합니다." });
    const duplicate = db
      .prepare("SELECT * FROM public_chain_operations WHERE tx_hash=?")
      .get(txHash);
    if (duplicate)
      return res.json({
        status: duplicate.status,
        txHash: duplicate.tx_hash,
        blockNumber: duplicate.block_number,
      });
    try {
      const result = await publicChain.confirmMarketplaceTransaction(txHash);
      const id = `chain-${randomUUID().slice(0, 12)}`,
        timestamp = now();
      store.transaction(() => {
        db.prepare(
          "INSERT INTO public_chain_operations (id,operation_type,entity_type,entity_id,payload_json,status,tx_hash,block_number,attempts,created_at,updated_at) VALUES (?,?,?,?,?,'confirmed',?,?,1,?,?)",
        ).run(
          id,
          `MARKETPLACE_${result.eventName.toUpperCase()}`,
          "marketplace_transaction",
          txHash,
          JSON.stringify({ actorId: req.user.id, ...result }),
          txHash,
          result.blockNumber,
          timestamp,
          timestamp,
        );
        store.appendBlock(
          "PUBLIC_MARKETPLACE_CONFIRMED",
          "marketplace_transaction",
          txHash,
          { actorId: req.user.id, ...result },
        );
      });
      res.json({ status: "confirmed", ...result });
    } catch (error) {
      res.status(422).json({ message: String(error.message || error) });
    }
  });
  app.post(
    "/api/admin/public-chain/process-next",
    auth,
    admin,
    async (_req, res) => {
      if (!publicChain.relayerEnabled)
        return res.status(503).json({
          message: "퍼블릭 체인 환경변수가 설정되지 않았습니다.",
          chain: publicChain.status(),
        });
      const result = await processNextChainOperation(store, publicChain);
      res.json(
        result || { status: "idle", message: "처리할 outbox 작업이 없습니다." },
      );
    },
  );
  app.post(
    "/api/admin/public-chain/sensor-batches",
    auth,
    admin,
    (req, res) => {
      const containerId = text(req.body?.containerId, 50),
        maxReadings = Math.min(500, positiveInt(req.body?.maxReadings) || 100);
      if (!getContainer(containerId))
        return res
          .status(404)
          .json({ message: "컨테이너를 찾을 수 없습니다." });
      const events = db
        .prepare(
          "SELECT id,container_id,device_id,payload_json,created_at FROM sensor_events WHERE container_id=? AND anchored_batch_id IS NULL ORDER BY created_at,id LIMIT ?",
        )
        .all(containerId, maxReadings);
      if (!events.length)
        return res
          .status(409)
          .json({ message: "아직 anchor하지 않은 센서 기록이 없습니다." });
      const records = events.map((event) => ({
        id: event.id,
        containerId: event.container_id,
        deviceId: event.device_id,
        payload: JSON.parse(event.payload_json),
        createdAt: event.created_at,
      }));
      const root = merkleRoot(records),
        batchId = `batch-${randomUUID().slice(0, 12)}`,
        createdAt = now();
      const operation = store.transaction(() => {
        const queued = store.enqueueChainOperation(
          "ANCHOR_SENSOR_BATCH",
          "sensor_batch",
          batchId,
          {
            containerId,
            merkleRoot: root,
            fromTimestamp: events[0].created_at,
            toTimestamp: events.at(-1).created_at,
            readingCount: events.length,
          },
        );
        db.prepare(
          "INSERT INTO sensor_anchor_batches VALUES (?,?,?,?,?,?,?,?,?,?)",
        ).run(
          batchId,
          containerId,
          events[0].id,
          events.at(-1).id,
          events[0].created_at,
          events.at(-1).created_at,
          events.length,
          root,
          queued.id,
          createdAt,
        );
        const placeholders = events.map(() => "?").join(",");
        db.prepare(
          `UPDATE sensor_events SET anchored_batch_id=? WHERE id IN (${placeholders})`,
        ).run(batchId, ...events.map((event) => event.id));
        store.appendBlock("SENSOR_BATCH_QUEUED", "sensor_batch", batchId, {
          containerId,
          merkleRoot: root,
          readingCount: events.length,
          operationId: queued.id,
        });
        return queued;
      });
      res.status(202).json({
        batchId,
        containerId,
        merkleRoot: root,
        readingCount: events.length,
        operation,
      });
    },
  );

  app.post("/api/admin/iot/devices", auth, admin, (req, res) => {
    const containerId = text(req.body?.containerId, 50),
      name = text(req.body?.name, 60),
      deviceType = text(req.body?.deviceType, 20);
    if (
      !getContainer(containerId) ||
      !name ||
      !["sensor", "controller", "camera"].includes(deviceType)
    )
      return res
        .status(400)
        .json({ message: "컨테이너, 장비명, 장비 유형을 확인해 주세요." });
    const rawKey = `glk_${randomBytes(32).toString("base64url")}`;
    const timestamp = now();
    const id = `dev-${randomUUID().slice(0, 12)}`;
    db.prepare(
      "INSERT INTO iot_devices VALUES (?,?,?,?,?,?,'offline',NULL,?,?)",
    ).run(
      id,
      containerId,
      name,
      deviceType,
      tokenHash(rawKey),
      rawKey.slice(0, 12),
      timestamp,
      timestamp,
    );
    audit(req, "PROVISION_IOT_DEVICE", "iot_device", id, {
      containerId,
      deviceType,
    });
    store.appendBlock("DEVICE_PROVISIONED", "iot_device", id, {
      containerId,
      deviceType,
      keyPrefix: rawKey.slice(0, 12),
    });
    res.status(201).json({
      id,
      containerId,
      name,
      deviceType,
      apiKey: rawKey,
      message:
        "이 인증키는 지금 한 번만 표시됩니다. 장비의 안전한 저장소에 보관하세요.",
    });
  });
  app.get("/api/admin/iot/devices", auth, admin, (_req, res) => {
    const devices = db
      .prepare(
        "SELECT id,container_id,name,device_type,key_prefix,status,last_seen_at,created_at,updated_at FROM iot_devices ORDER BY created_at DESC",
      )
      .all()
      .map((row) => ({
        id: row.id,
        containerId: row.container_id,
        name: row.name,
        deviceType: row.device_type,
        keyPrefix: row.key_prefix,
        status: row.status,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    res.json(devices);
  });
  app.get("/api/admin/summary", auth, admin, (_req, res) => {
    const scalar = (sql) => Number(Object.values(db.prepare(sql).get())[0]);
    res.json({
      farmCount: scalar("SELECT COUNT(*) FROM farms"),
      containerCount: scalar("SELECT COUNT(*) FROM containers"),
      issuedTokens: scalar(
        "SELECT COALESCE(SUM(total_token_supply),0) FROM containers",
      ),
      onlineDevices: scalar(
        "SELECT COUNT(*) FROM iot_devices WHERE status='online'",
      ),
      queuedCommands: scalar(
        "SELECT COUNT(*) FROM control_commands WHERE status='queued'",
      ),
      ledgerBlocks: scalar("SELECT COUNT(*) FROM blockchain_blocks"),
    });
  });
  app.get("/api/admin/control-commands", auth, admin, (_req, res) => {
    const rows = db
      .prepare(
        "SELECT id,container_id,command_json,status,requested_at,acknowledged_at,result_json FROM control_commands ORDER BY requested_at DESC LIMIT 50",
      )
      .all();
    res.json(
      rows.map((row) => ({
        id: row.id,
        containerId: row.container_id,
        command: JSON.parse(row.command_json),
        status: row.status,
        requestedAt: row.requested_at,
        acknowledgedAt: row.acknowledged_at,
        result: row.result_json ? JSON.parse(row.result_json) : null,
      })),
    );
  });
  app.post("/api/containers/:id/climate/commands", auth, (req, res) => {
    const container = getContainer(req.params.id);
    if (!container)
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    const farm = getFarm(container.farm_id);
    if (req.user.role !== "admin" && farm?.owner_id !== req.user.id)
      return res
        .status(403)
        .json({ message: "이 컨테이너의 환경 제어 권한이 없습니다." });
    const targetTemperature = Number(req.body?.targetTemperature),
      hasHumidity =
        req.body?.targetHumidity !== undefined &&
        req.body?.targetHumidity !== null &&
        req.body?.targetHumidity !== "",
      targetHumidity = hasHumidity
        ? Number(req.body.targetHumidity)
        : undefined,
      mode = text(req.body?.mode, 20),
      fan = Boolean(req.body?.fan);
    if (
      !Number.isFinite(targetTemperature) ||
      targetTemperature < 5 ||
      targetTemperature > 45 ||
      (hasHumidity &&
        (!Number.isFinite(targetHumidity) ||
          targetHumidity < 30 ||
          targetHumidity > 95)) ||
      !["auto", "cool", "heat", "ventilate", "off"].includes(mode)
    )
      return res.status(400).json({
        message: "제어 온도(5~45℃), 습도(30~95%)와 모드를 확인해 주세요.",
      });
    const command = {
      targetTemperature,
      ...(hasHumidity ? { targetHumidity } : {}),
      mode,
      fan,
    };
    const id = `cmd-${randomUUID().slice(0, 12)}`,
      requestedAt = now();
    store.transaction(() => {
      db.prepare(
        "INSERT INTO control_commands (id,container_id,requested_by,command_json,status,requested_at) VALUES (?,?,?,?,?,?)",
      ).run(
        id,
        req.params.id,
        req.user.id,
        JSON.stringify(command),
        "queued",
        requestedAt,
      );
      store.appendBlock("CLIMATE_CONTROL_COMMAND", "control_command", id, {
        containerId: req.params.id,
        requestedBy: req.user.id,
        ...command,
        requestedAt,
      });
      audit(req, "CLIMATE_CONTROL_COMMAND", "control_command", id, command);
    });
    publish(req.params.id, "control_command", {
      id,
      ...command,
      status: "queued",
      requestedAt,
    });
    res.status(202).json({
      id,
      containerId: req.params.id,
      command,
      status: "queued",
      requestedAt,
    });
  });
  app.put("/api/admin/cameras/:containerId", auth, admin, (req, res) => {
    if (!getContainer(req.params.containerId))
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    const hlsUrl = text(req.body?.hlsUrl, 500);
    let url;
    try {
      url = new URL(hlsUrl);
    } catch {
      return res
        .status(400)
        .json({ message: "유효한 HLS 주소를 입력해 주세요." });
    }
    if (
      !/^https?:$/.test(url.protocol) ||
      !url.pathname.toLowerCase().includes(".m3u8")
    )
      return res.status(400).json({
        message:
          "브라우저 송출용 HTTP(S) HLS(.m3u8) 주소만 등록할 수 있습니다.",
      });
    const status = req.body?.status === "offline" ? "offline" : "online",
      timestamp = now();
    db.prepare(
      "INSERT INTO camera_streams VALUES (?,?,?,?) ON CONFLICT(container_id) DO UPDATE SET hls_url=excluded.hls_url,status=excluded.status,updated_at=excluded.updated_at",
    ).run(req.params.containerId, hlsUrl, status, timestamp);
    audit(req, "CONFIGURE_CAMERA", "camera", req.params.containerId, {
      hlsUrl,
      status,
    });
    res.json({
      containerId: req.params.containerId,
      hlsUrl,
      status,
      updatedAt: timestamp,
    });
  });

  app.post("/api/admin/farms", auth, admin, (req, res) => {
    const name = text(req.body?.name, 60),
      address = text(req.body?.address, 120),
      ownerId = text(req.body?.ownerId, 40) || "admin";
    if (!name || !address || !getUser(ownerId))
      return res
        .status(400)
        .json({ message: "농장명, 주소, 운영자를 확인해 주세요." });
    const id = `farm-${randomUUID().slice(0, 8)}`,
      createdAt = now();
    const row = {
      id,
      name,
      address,
      latitude: Number(req.body?.latitude) || 35.87,
      longitude: Number(req.body?.longitude) || 128.65,
      status: "운영중",
      description: text(req.body?.description, 300),
      ownerId,
      createdAt,
      updatedAt: createdAt,
    };
    db.prepare("INSERT INTO farms VALUES (?,?,?,?,?,?,?,?,?,?)").run(
      row.id,
      row.name,
      row.address,
      row.latitude,
      row.longitude,
      row.status,
      row.description,
      row.ownerId,
      row.createdAt,
      row.updatedAt,
    );
    audit(req, "CREATE", "farm", id, row);
    res.status(201).json(row);
  });
  app.post("/api/admin/containers", auth, admin, (req, res) => {
    const farmId = text(req.body?.farmId, 50),
      name = text(req.body?.name, 60),
      cropName = text(req.body?.cropName, 40);
    if (!getFarm(farmId) || !name || !cropName)
      return res
        .status(400)
        .json({ message: "농장과 컨테이너 정보를 확인해 주세요." });
    const id = `${farmId}-${randomUUID().slice(0, 5)}`,
      createdAt = now();
    const row = {
      id,
      farmId,
      name,
      cropName,
      status: "파종대기",
      description: text(req.body?.description, 300),
      plantedAt: "",
      harvestAt: "",
      tokenId: `SFC-${id.toUpperCase()}`,
      totalTokenSupply: 0,
      availableTokenQuantity: 0,
      tokenPrice: 0,
      createdAt,
      updatedAt: createdAt,
    };
    store.transaction(() => {
      db.prepare(
        "INSERT INTO containers VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        row.id,
        row.farmId,
        row.name,
        row.cropName,
        row.status,
        row.description,
        row.plantedAt,
        row.harvestAt,
        row.tokenId,
        row.totalTokenSupply,
        row.availableTokenQuantity,
        row.tokenPrice,
        row.createdAt,
        row.updatedAt,
      );
      db.prepare(
        "INSERT INTO sensor_readings VALUES (?,?,?,?,?,?,?,?,?,?)",
      ).run(row.id, 0, 0, 0, 0, 0, 0, 0, "[]", createdAt);
      audit(req, "CREATE", "container", id, row);
    });
    res.status(201).json(row);
  });
  app.patch("/api/admin/containers/:id/content", auth, admin, (req, res) => {
    const container = getContainer(req.params.id);
    if (!container)
      return res.status(404).json({ message: "컨테이너를 찾을 수 없습니다." });
    const description = text(req.body?.description, 500);
    const rackViews = Array.isArray(req.body?.rackViews)
      ? req.body.rackViews.map((rack, index) => ({
          id: `rack-${String.fromCharCode(97 + index)}`,
          label: text(rack?.label, 40),
          detail: text(rack?.detail, 80),
        }))
      : [];
    if (
      rackViews.length !== 4 ||
      rackViews.some((rack) => !rack.label || !rack.detail)
    )
      return res
        .status(400)
        .json({ message: "랙 4개의 이름과 설명을 모두 입력해 주세요." });
    const updatedAt = now();
    store.transaction(() => {
      db.prepare(
        "UPDATE containers SET description=?,updated_at=? WHERE id=?",
      ).run(description, updatedAt, container.id);
      db.prepare(
        "INSERT INTO container_page_content (container_id,rack_views_json,updated_at) VALUES (?,?,?) ON CONFLICT(container_id) DO UPDATE SET rack_views_json=excluded.rack_views_json,updated_at=excluded.updated_at",
      ).run(container.id, JSON.stringify(rackViews), updatedAt);
      audit(req, "UPDATE_PAGE_CONTENT", "container", container.id, {
        description,
        rackViews,
      });
    });
    res.json(withFarm(getContainer(container.id)));
  });
  app.get("/api/admin/token-requests", auth, admin, (req, res) => {
    const rows = db
      .prepare(
        `SELECT t.*,c.name AS container_name,c.crop_name,f.name AS farm_name,u.name AS issuer_name
           FROM container_tokens t
           JOIN containers c ON c.id=t.container_id
           JOIN farms f ON f.id=c.farm_id
           JOIN users u ON u.id=t.issuer_id
          WHERE t.status='requested'
          ORDER BY t.created_at DESC`,
      )
      .all()
      .map((row) => ({
        id: row.id,
        containerId: row.container_id,
        containerName: row.container_name,
        cropName: row.crop_name,
        farmName: row.farm_name,
        issuerId: row.issuer_id,
        issuerName: row.issuer_name,
        symbol: row.symbol,
        totalSupply: row.total_supply,
        initialPrice: row.initial_price,
        status: row.status,
        executionVenue: row.execution_venue,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
    res.json(rows);
  });
  const approveTokenRequest = (
    req,
    res,
    containerId = req.body?.containerId,
  ) => {
    const id = text(containerId, 50);
    const requestedToken = db
      .prepare(
        "SELECT total_supply,initial_price FROM container_tokens WHERE container_id=? AND status='requested'",
      )
      .get(id);
    const supply =
      positiveInt(req.body?.supply) || requestedToken?.total_supply;
    const price = positiveInt(req.body?.price) || requestedToken?.initial_price;
    const container = getContainer(id);
    const owner = container
      ? db
          .prepare(
            "SELECT f.owner_id,u.name AS owner_name,u.wallet_address FROM containers c JOIN farms f ON f.id=c.farm_id JOIN users u ON u.id=f.owner_id WHERE c.id=?",
          )
          .get(id)
      : null;
    const recipient =
      text(req.body?.recipientAddress, 50) || owner?.wallet_address;
    if (publicChain.relayerEnabled && (!recipient || !isAddress(recipient)))
      return res.status(400).json({
        message:
          "퍼블릭 체인 발행에는 농장 소유자의 연결된 EVM 지갑 또는 recipientAddress가 필요합니다.",
      });
    try {
      const issued = trading.approveIssuance({
        approverId: req.user.id,
        containerId: id,
        supply,
        price,
        queueChainOperation: publicChain.relayerEnabled
          ? ({ container: issuedContainer, supply: issuedSupply }) =>
              store.enqueueChainOperation(
                "ISSUE_CONTAINER_TOKEN",
                "container",
                id,
                {
                  containerId: id,
                  tokenId: issuedContainer.token_id,
                  supply: issuedSupply,
                  recipient: getAddress(recipient),
                },
              )
          : null,
      });
      res.json({
        ...containerMarketView(getContainer(id)),
        publicChainOperation: issued.publicChainOperation,
      });
    } catch (error) {
      tradingError(res, error, "토큰 발행 중 오류가 발생했습니다.");
    }
  };
  app.post("/api/admin/tokens", auth, admin, (req, res) => {
    approveTokenRequest(req, res);
  });
  app.post(
    "/api/admin/tokens/:containerId/approve",
    auth,
    admin,
    (req, res) => {
      approveTokenRequest(req, res, req.params.containerId);
    },
  );
  app.patch("/api/admin/sensors/:containerId", auth, admin, (req, res) => {
    const current = sensorView(
      db
        .prepare("SELECT * FROM sensor_readings WHERE container_id=?")
        .get(req.params.containerId),
    );
    if (!current)
      return res
        .status(404)
        .json({ message: "센서 데이터를 찾을 수 없습니다." });
    const next = { ...current };
    for (const key of [
      "temperature",
      "humidity",
      "light",
      "co2",
      "soilMoisture",
      "ph",
      "ec",
    ])
      if (Number.isFinite(Number(req.body?.[key])))
        next[key] = Number(req.body[key]);
    next.updatedAt = now();
    next.history = [...next.history.slice(-7), next.temperature];
    db.prepare(
      "UPDATE sensor_readings SET temperature=?,humidity=?,light=?,co2=?,soil_moisture=?,ph=?,ec=?,history_json=?,updated_at=? WHERE container_id=?",
    ).run(
      next.temperature,
      next.humidity,
      next.light,
      next.co2,
      next.soilMoisture,
      next.ph,
      next.ec,
      JSON.stringify(next.history),
      next.updatedAt,
      req.params.containerId,
    );
    audit(req, "UPDATE_SENSOR", "container", req.params.containerId, {});
    res.json(next);
  });

  app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  });
  return app;
}
