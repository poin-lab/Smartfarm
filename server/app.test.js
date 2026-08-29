import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createStore } from "./store.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const setup = () => createApp({ store: createStore(":memory:") });
const sessionFrom = (response) => {
  const cookie = response.headers["set-cookie"]?.[0] || "";
  const value = cookie.match(/(?:__Host-)?green_link_session=([^;]+)/)?.[1];
  return value ? decodeURIComponent(value) : "";
};
const login = async (app, email = "user@smartfarm.kr", password = "user1234") =>
  sessionFrom(
    await request(app).post("/api/auth/login").send({ email, password }),
  );

describe("Smart Farm API", () => {
  it("returns farms with calculated container counts", async () => {
    const res = await request(setup()).get("/api/farms");
    expect(res.status).toBe(200);
    expect(res.body[0].containerCount).toBe(3);
  });
  it("authenticates and protects wallet", async () => {
    const app = setup();
    expect((await request(app).get("/api/wallet")).status).toBe(401);
    const token = await login(app);
    const res = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalTokens).toBe(7);
    expect(res.body.positions[0]).toHaveProperty("settledQuantity");
  });
  it("backfills farm-owner issuers, positions and canonical token orders", () => {
    const store = createStore(":memory:");
    expect(
      store.db.prepare("SELECT owner_id FROM farms WHERE id='farm-a'").get()
        .owner_id,
    ).toBe("farmer-a");
    expect(
      store.db
        .prepare(
          "SELECT issuer_id FROM container_tokens WHERE container_id='a-01'",
        )
        .get().issuer_id,
    ).toBe("farmer-a");
    expect(
      store.db
        .prepare(
          "SELECT user_id,side,remaining_quantity,status FROM token_orders WHERE legacy_order_id='order-1'",
        )
        .get(),
    ).toMatchObject({
      user_id: "farmer-a",
      side: "SELL",
      remaining_quantity: 2,
      status: "open",
    });
    expect(
      store.db
        .prepare(
          "SELECT available_quantity,reserved_quantity,settled_quantity FROM token_positions WHERE user_id='farmer-a' AND token_id='SFC-A01'",
        )
        .get(),
    ).toMatchObject({
      available_quantity: 4,
      reserved_quantity: 2,
      settled_quantity: 6,
    });
    store.close();
  });
  it("purchases tokens and updates wallet", async () => {
    const app = setup(),
      token = await login(app);
    const purchase = await request(app)
      .post("/api/orders/order-1/purchase")
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 1 });
    expect(purchase.status).toBe(201);
    const wallet = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(wallet.body.totalTokens).toBe(8);
    expect(wallet.body.paymentProvider).toBe("mock");
    expect(wallet.body.mockCreditBalance).toBe(1880000);
  });
  it("makes purchase retries idempotent and writes execution ledgers", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const token = await login(app);
    const headers = {
      Authorization: `Bearer ${token}`,
      "Idempotency-Key": "purchase-order-1-once",
    };
    const first = await request(app)
      .post("/api/orders/order-1/purchase")
      .set(headers)
      .send({ quantity: 1 });
    const retry = await request(app)
      .post("/api/orders/order-1/purchase")
      .set(headers)
      .send({ quantity: 1 });
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).toBe(first.body.id);
    expect(
      store.db
        .prepare("SELECT quantity,status FROM orders WHERE id='order-1'")
        .get(),
    ).toMatchObject({ quantity: 1, status: "판매중" });
    expect(
      store.db.prepare("SELECT COUNT(*) AS count FROM token_executions").get()
        .count,
    ).toBe(1);
    expect(
      store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM settlements WHERE status='confirmed'",
        )
        .get().count,
    ).toBe(1);
    expect(
      store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM credit_ledger_entries WHERE execution_id=?",
        )
        .get(first.body.executionId).count,
    ).toBe(2);
    expect(
      store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM token_ledger_entries WHERE execution_id=?",
        )
        .get(first.body.executionId).count,
    ).toBe(4);
    const wallet = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(wallet.body.totalTokens).toBe(8);
    expect(wallet.body.mockCreditBalance).toBe(1880000);
    store.close();
  });
  it("exposes trading provider status, positions, open orders and quotes", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const token = await login(app);
    const auth = { Authorization: `Bearer ${token}` };
    const provider = await request(app).get("/api/trading/provider").set(auth);
    expect(provider.status).toBe(200);
    expect(provider.body.internal).toMatchObject({
      provider: "InternalTradingProvider",
      connected: true,
    });
    expect(provider.body.broker).toMatchObject({ connected: false });

    const positions = await request(app)
      .get("/api/trading/positions")
      .set(auth);
    expect(
      positions.body.find((position) => position.tokenId === "SFC-A01"),
    ).toMatchObject({ availableQuantity: 4, settledQuantity: 4 });

    const created = await request(app)
      .post("/api/trading/orders")
      .set(auth)
      .send({
        side: "BUY",
        orderType: "LIMIT",
        tokenId: "SFC-A03",
        quantity: 1,
        limitPrice: 80000,
        idempotencyKey: "open-buy-sfc-a03",
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      side: "BUY",
      status: "open",
      remainingQuantity: 1,
    });
    const quote = await request(app)
      .get("/api/trading/instruments/SFC-A03/quote")
      .set(auth);
    expect(quote.body).toMatchObject({
      tokenId: "SFC-A03",
      highestBid: 80000,
      initialPrice: 85000,
    });
    expect(
      (
        await request(app)
          .post(`/api/trading/orders/${created.body.id}/cancel`)
          .set(auth)
      ).status,
    ).toBe(204);
    expect(
      store.db
        .prepare("SELECT status FROM token_orders WHERE id=?")
        .get(created.body.id).status,
    ).toBe("cancelled");
    store.close();
  });
  it("completes an order when its final quantity is purchased", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const token = await login(app);
    const purchase = await request(app)
      .post("/api/orders/order-1/purchase")
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 2 });
    expect(purchase.status).toBe(201);
    expect(
      store.db
        .prepare("SELECT quantity,status FROM orders WHERE id='order-1'")
        .get(),
    ).toMatchObject({ quantity: 0, status: "거래완료" });
    store.close();
  });
  it("shows and cancels the user's open sell orders", async () => {
    const app = setup(),
      token = await login(app);
    const created = await request(app)
      .post("/api/orders")
      .set("Authorization", `Bearer ${token}`)
      .send({ tokenId: "SFC-A01", quantity: 1, unitPrice: 125000 });
    expect(created.status).toBe(201);

    const dashboard = await request(app)
      .get("/api/dashboard")
      .set("Authorization", `Bearer ${token}`);
    expect(dashboard.body.wallet.openOrderCount).toBe(1);
    expect(dashboard.body.wallet.openOrders[0].id).toBe(created.body.id);

    const sellingWallet = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(sellingWallet.body.openOrders[0].id).toBe(created.body.id);
    expect(sellingWallet.body.listedTokens).toBe(1);
    expect(sellingWallet.body.totalTokens).toBe(7);

    const cancelled = await request(app)
      .post(`/api/orders/${created.body.id}/cancel`)
      .set("Authorization", `Bearer ${token}`);
    expect(cancelled.status).toBe(204);
    const wallet = await request(app)
      .get("/api/wallet")
      .set("Authorization", `Bearer ${token}`);
    expect(
      wallet.body.holdings.find((holding) => holding.tokenId === "SFC-A01")
        .quantity,
    ).toBe(4);
    expect(wallet.body.openOrders).toHaveLength(0);
    expect(wallet.body.listedTokens).toBe(0);
    expect(wallet.body.totalTokens).toBe(7);
  });
  it("validates quantity and administrator role", async () => {
    const app = setup(),
      token = await login(app);
    expect(
      (
        await request(app)
          .post("/api/orders/order-1/purchase")
          .set("Authorization", `Bearer ${token}`)
          .send({ quantity: 99 })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .post("/api/admin/farms")
          .set("Authorization", `Bearer ${token}`)
          .send({ name: "X", address: "Y" })
      ).status,
    ).toBe(403);
  });
  it("lets farm owners control their container climate only", async () => {
    const app = setup(),
      token = await login(app, "farmer@smartfarm.kr", "farmer1234"),
      auth = { Authorization: `Bearer ${token}` };
    const allowed = await request(app)
      .post("/api/containers/a-01/climate/commands")
      .set(auth)
      .send({
        targetTemperature: 23.5,
        targetHumidity: 65,
        mode: "auto",
        fan: true,
      });
    expect(allowed.status).toBe(202);
    expect(allowed.body.command.targetTemperature).toBe(23.5);
    expect(allowed.body.command.targetHumidity).toBe(65);
    expect(
      (
        await request(app)
          .post("/api/containers/b-01/climate/commands")
          .set(auth)
          .send({
            targetTemperature: 24,
            targetHumidity: 65,
            mode: "auto",
            fan: true,
          })
      ).status,
    ).toBe(403);
  });
  it("allows an administrator to register a container", async () => {
    const app = setup(),
      token = await login(app, "admin@smartfarm.kr", "admin1234");
    const created = await request(app)
      .post("/api/admin/containers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        farmId: "farm-a",
        name: "A-04 테스트 컨테이너",
        cropName: "청경채",
        description: "등록 흐름 확인",
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      farmId: "farm-a",
      name: "A-04 테스트 컨테이너",
      cropName: "청경채",
    });
    const farm = await request(app).get("/api/farms/farm-a");
    expect(farm.body.containers).toHaveLength(4);
  });
  it("allows an administrator to edit container and rack page copy", async () => {
    const app = setup();
    const token = await login(app, "admin@smartfarm.kr", "admin1234");
    const rackViews = ["A", "B", "C", "D"].map((name) => ({
      label: `딸기 랙 ${name}`,
      detail: `${name}구역 카메라`,
    }));
    const updated = await request(app)
      .patch("/api/admin/containers/a-01/content")
      .set("Authorization", `Bearer ${token}`)
      .send({ description: "관리자가 수정한 소개입니다.", rackViews });
    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("관리자가 수정한 소개입니다.");
    expect(updated.body.rackViews[0]).toMatchObject({
      id: "rack-a",
      label: "딸기 랙 A",
      detail: "A구역 카메라",
    });
    const detail = await request(app).get("/api/containers/a-01");
    expect(detail.body.rackViews[3].label).toBe("딸기 랙 D");
  });
  it("uses a relational SQLite database with protected password hashes", async () => {
    const store = createStore(":memory:"),
      app = createApp({ store });
    expect(
      store.db.prepare("PRAGMA integrity_check").get().integrity_check,
    ).toBe("ok");
    const user = store.db
      .prepare("SELECT password_hash FROM users WHERE email=?")
      .get("user@smartfarm.kr");
    expect(user.password_hash).toMatch(/^scrypt\$/);
    expect(user.password_hash).not.toContain("user1234");
    expect(
      (
        await request(app)
          .post("/api/auth/login")
          .send({ email: "user@smartfarm.kr", password: "wrong" })
      ).status,
    ).toBe(401);
    store.close();
  });
  it("registers a general user and starts an HttpOnly cookie session", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const signup = await request(app).post("/api/auth/signup").send({
      name: "새 사용자",
      email: "new-user@example.com",
      phone: "010-9999-0000",
      password: "correct horse battery staple",
    });
    expect(signup.status).toBe(201);
    expect(signup.body.user).toMatchObject({
      email: "new-user@example.com",
      role: "user",
      status: "active",
    });
    expect(signup.body).not.toHaveProperty("token");
    expect(signup.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(signup.headers["set-cookie"][0]).toContain("SameSite=Lax");
    const saved = store.db
      .prepare("SELECT password_hash FROM users WHERE email=?")
      .get("new-user@example.com");
    expect(saved.password_hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(saved.password_hash).not.toContain("correct horse battery staple");
    expect(
      (
        await request(app).post("/api/auth/signup").send({
          name: "중복",
          email: "NEW-USER@example.com",
          password: "another correct horse phrase",
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app).post("/api/auth/signup").send({
          name: "짧은 암호",
          email: "weak@example.com",
          password: "1234567",
        })
      ).status,
    ).toBe(400);
    store.close();
  });
  it("uses cookie sessions with a custom-header CSRF check", async () => {
    const app = setup();
    const agent = request.agent(app);
    expect(
      (
        await agent.post("/api/auth/login").send({
          email: "user@smartfarm.kr",
          password: "user1234",
        })
      ).status,
    ).toBe(200);
    expect((await agent.get("/api/me")).status).toBe(200);
    expect(
      (await agent.patch("/api/me").send({ name: "변경", phone: "" })).status,
    ).toBe(403);
    expect(
      (
        await agent
          .patch("/api/me")
          .set("X-Green-Link-Request", "1")
          .send({ name: "변경", phone: "" })
      ).status,
    ).toBe(200);
    expect(
      (await agent.post("/api/auth/logout").set("X-Green-Link-Request", "1"))
        .status,
    ).toBe(204);
    expect((await agent.get("/api/me")).status).toBe(401);
  });
  it("changes a password and revokes the user's other sessions", async () => {
    const app = setup();
    const first = await login(app);
    const second = await login(app);
    expect(
      (
        await request(app)
          .patch("/api/me/password")
          .set("Authorization", `Bearer ${first}`)
          .send({
            currentPassword: "wrong",
            newPassword: "new correct horse battery staple",
          })
      ).status,
    ).toBe(401);
    const changed = await request(app)
      .patch("/api/me/password")
      .set("Authorization", `Bearer ${first}`)
      .send({
        currentPassword: "user1234",
        newPassword: "new correct horse battery staple",
      });
    expect(changed.status).toBe(204);
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Authorization", `Bearer ${second}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).post("/api/auth/login").send({
          email: "user@smartfarm.kr",
          password: "user1234",
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).post("/api/auth/login").send({
          email: "user@smartfarm.kr",
          password: "new correct horse battery staple",
        })
      ).status,
    ).toBe(200);
  });
  it("rejects suspended users and their existing sessions", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const token = await login(app);
    store.db.prepare("UPDATE users SET status='suspended' WHERE id='u1'").run();
    expect(
      (
        await request(app)
          .get("/api/me")
          .set("Authorization", `Bearer ${token}`)
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).post("/api/auth/login").send({
          email: "user@smartfarm.kr",
          password: "user1234",
        })
      ).status,
    ).toBe(401);
    store.close();
  });
  it("writes token purchases to a signed, verifiable blockchain ledger", async () => {
    const store = createStore(":memory:"),
      app = createApp({ store });
    const token = await login(app);
    expect(
      (
        await request(app)
          .get("/api/blockchain/verify")
          .set("Authorization", `Bearer ${token}`)
      ).body,
    ).toMatchObject({ valid: true, count: 1 });
    expect(
      (
        await request(app)
          .post("/api/orders/order-1/purchase")
          .set("Authorization", `Bearer ${token}`)
          .send({ quantity: 1 })
      ).status,
    ).toBe(201);
    const verified = await request(app)
      .get("/api/blockchain/verify")
      .set("Authorization", `Bearer ${token}`);
    expect(verified.body).toMatchObject({ valid: true, count: 2 });
    store.close();
  });
  it("detects payload and HMAC tampering in the private ledger", async () => {
    const store = createStore(":memory:"),
      app = createApp({ store });
    const token = await login(app);
    await request(app)
      .post("/api/orders/order-1/purchase")
      .set("Authorization", `Bearer ${token}`)
      .send({ quantity: 1 });
    store.db
      .prepare("UPDATE blockchain_blocks SET payload_json='{}' WHERE height=1")
      .run();
    expect(store.verifyBlockchain()).toMatchObject({ valid: false, height: 1 });
    store.close();
  });
  it("returns DB-calculated administrator operations summary", async () => {
    const app = setup();
    const token = await login(app, "admin@smartfarm.kr", "admin1234");
    const result = await request(app)
      .get("/api/admin/summary")
      .set("Authorization", `Bearer ${token}`);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      farmCount: 3,
      containerCount: 5,
      issuedTokens: 50,
      ledgerBlocks: 1,
    });
  });
  it("accepts authenticated hardware telemetry and queues climate controls", async () => {
    const store = createStore(":memory:"),
      app = createApp({ store });
    const adminToken = await login(app, "admin@smartfarm.kr", "admin1234");
    const admin = { Authorization: `Bearer ${adminToken}` };
    const sensorDevice = await request(app)
      .post("/api/admin/iot/devices")
      .set(admin)
      .send({ containerId: "a-01", name: "A01 ESP32", deviceType: "sensor" });
    expect(sensorDevice.status).toBe(201);
    const sensorKey = { "X-Device-Key": sensorDevice.body.apiKey };
    expect(
      (
        await request(app).post("/api/iot/ingest/sensors").set(sensorKey).send({
          temperature: 26.1,
          humidity: 67,
          light: 12000,
          co2: 730,
          soilMoisture: 55,
          ph: 6.3,
          ec: 1.9,
        })
      ).status,
    ).toBe(202);
    expect(
      (await request(app).get("/api/containers/a-01/sensors")).body.temperature,
    ).toBe(26.1);
    const controller = await request(app)
      .post("/api/admin/iot/devices")
      .set(admin)
      .send({
        containerId: "a-01",
        name: "A01 HVAC",
        deviceType: "controller",
      });
    const command = await request(app)
      .post("/api/containers/a-01/climate/commands")
      .set(admin)
      .send({
        targetTemperature: 23,
        targetHumidity: 65,
        mode: "cool",
        fan: true,
      });
    expect(command.status).toBe(202);
    expect(command.body.command.targetHumidity).toBe(65);
    const pending = await request(app)
      .get("/api/iot/commands/pending")
      .set("X-Device-Key", controller.body.apiKey);
    expect(pending.body.commands[0].id).toBe(command.body.id);
    expect(
      (
        await request(app)
          .post(`/api/iot/commands/${command.body.id}/ack`)
          .set("X-Device-Key", controller.body.apiKey)
          .send({ success: true, message: "relay on" })
      ).body.status,
    ).toBe("acknowledged");
    expect(store.verifyBlockchain().valid).toBe(true);
    store.close();
  });
  it("links an EVM wallet only after a valid challenge signature", async () => {
    const app = setup(),
      token = await login(app);
    const account = privateKeyToAccount(generatePrivateKey());
    const challenge = await request(app)
      .post("/api/me/wallet/challenge")
      .set("Authorization", `Bearer ${token}`);
    const signature = await account.signMessage({
      message: challenge.body.message,
    });
    const linked = await request(app)
      .post("/api/me/wallet/verify")
      .set("Authorization", `Bearer ${token}`)
      .send({ address: account.address, signature });
    expect(linked.status).toBe(200);
    expect(linked.body.walletAddress).toBe(account.address);
  });
  it("builds a sensor Merkle batch and queues an outbox anchor", async () => {
    const store = createStore(":memory:"),
      app = createApp({ store });
    const adminToken = await login(app, "admin@smartfarm.kr", "admin1234"),
      admin = { Authorization: `Bearer ${adminToken}` };
    const device = await request(app)
      .post("/api/admin/iot/devices")
      .set(admin)
      .send({
        containerId: "a-01",
        name: "Batch Sensor",
        deviceType: "sensor",
      });
    await request(app)
      .post("/api/iot/ingest/sensors")
      .set("X-Device-Key", device.body.apiKey)
      .send({
        temperature: 24,
        humidity: 60,
        light: 10000,
        co2: 700,
        soilMoisture: 50,
        ph: 6.2,
        ec: 1.8,
      });
    const batch = await request(app)
      .post("/api/admin/public-chain/sensor-batches")
      .set(admin)
      .send({ containerId: "a-01", maxReadings: 100 });
    expect(batch.status).toBe(202);
    expect(batch.body).toMatchObject({ containerId: "a-01", readingCount: 1 });
    expect(batch.body.merkleRoot).toMatch(/^0x[0-9a-f]{64}$/);
    expect(
      store.db
        .prepare("SELECT status FROM public_chain_operations WHERE id=?")
        .get(batch.body.operation.id).status,
    ).toBe("pending");
    store.close();
  });
  it("issues new container supply to the farm owner position", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const token = await login(app, "admin@smartfarm.kr", "admin1234");
    const admin = { Authorization: `Bearer ${token}` };
    const container = await request(app)
      .post("/api/admin/containers")
      .set(admin)
      .send({
        farmId: "farm-a",
        name: "Owner Issue Container",
        cropName: "루꼴라",
      });
    const issued = await request(app)
      .post("/api/admin/tokens")
      .set(admin)
      .send({ containerId: container.body.id, supply: 10, price: 77000 });
    expect(issued.status).toBe(200);
    expect(issued.body).toMatchObject({
      totalTokenSupply: 10,
      availableTokenQuantity: 0,
      issuerId: "farmer-a",
      tokenStatus: "issued",
    });
    expect(
      store.db
        .prepare(
          "SELECT quantity FROM holdings WHERE user_id='farmer-a' AND token_id=?",
        )
        .get(container.body.tokenId).quantity,
    ).toBe(10);
    expect(
      store.db
        .prepare("SELECT 1 FROM holdings WHERE user_id='admin' AND token_id=?")
        .get(container.body.tokenId),
    ).toBeUndefined();
    expect(
      store.db
        .prepare(
          "SELECT COUNT(*) AS count FROM token_ledger_entries WHERE user_id='farmer-a' AND token_id=? AND reason='ISSUE'",
        )
        .get(container.body.tokenId).count,
    ).toBe(2);
    store.close();
  });
  it("lets farm owners request token issuance and admins approve it", async () => {
    const store = createStore(":memory:");
    const app = createApp({ store });
    const adminToken = await login(app, "admin@smartfarm.kr", "admin1234");
    const admin = { Authorization: `Bearer ${adminToken}` };
    const container = await request(app)
      .post("/api/admin/containers")
      .set(admin)
      .send({
        farmId: "farm-a",
        name: "Requested Issue Container",
        cropName: "바질",
      });
    const farmerToken = await login(app, "farmer@smartfarm.kr", "farmer1234");
    const requested = await request(app)
      .post(`/api/containers/${container.body.id}/token-requests`)
      .set("Authorization", `Bearer ${farmerToken}`)
      .send({
        supply: 10,
        price: 66000,
        terms: { note: "농장주 신청" },
      });
    expect(requested.status).toBe(201);
    expect(requested.body).toMatchObject({
      issuerId: "farmer-a",
      status: "requested",
      totalSupply: 10,
    });
    const requests = await request(app)
      .get("/api/admin/token-requests")
      .set(admin);
    expect(requests.body[0]).toMatchObject({
      containerId: container.body.id,
      issuerId: "farmer-a",
      initialPrice: 66000,
    });
    const approved = await request(app)
      .post(`/api/admin/tokens/${container.body.id}/approve`)
      .set(admin)
      .send({});
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({
      issuerId: "farmer-a",
      totalTokenSupply: 10,
      tokenStatus: "issued",
    });
    expect(
      store.db
        .prepare(
          "SELECT available_quantity,settled_quantity FROM token_positions WHERE user_id='farmer-a' AND token_id=?",
        )
        .get(container.body.tokenId),
    ).toMatchObject({ available_quantity: 10, settled_quantity: 10 });
    store.close();
  });
  it("queues ERC-1155 issuance when public-chain mode is enabled", async () => {
    const store = createStore(":memory:");
    const publicChain = {
      enabled: true,
      relayerEnabled: true,
      status: () => ({
        enabled: true,
        relayerEnabled: true,
        mode: "evm",
        chainId: 31337,
        chainName: "local",
      }),
    };
    const app = createApp({ store, publicChain });
    const token = await login(app, "admin@smartfarm.kr", "admin1234"),
      admin = { Authorization: `Bearer ${token}` };
    const container = await request(app)
      .post("/api/admin/containers")
      .set(admin)
      .send({ farmId: "farm-a", name: "Chain Container", cropName: "케일" });
    const recipient = privateKeyToAccount(generatePrivateKey()).address;
    const issued = await request(app)
      .post("/api/admin/tokens")
      .set(admin)
      .send({
        containerId: container.body.id,
        supply: 100,
        price: 1000,
        recipientAddress: recipient,
      });
    expect(issued.status).toBe(200);
    expect(issued.body.publicChainOperation).toMatchObject({
      operationType: "ISSUE_CONTAINER_TOKEN",
      status: "pending",
    });
    store.close();
  });
});
