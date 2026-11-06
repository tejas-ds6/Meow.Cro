import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAccountService } from "../server/account-service.js";

const customerTabId = "a".repeat(32);
const adminTabId = "b".repeat(32);

function handleSessionQuery(sql, values, sessions, adminSessions, customers = new Map()) {
  const isAdmin = sql.includes("admin_sessions");
  const store = isAdmin ? adminSessions : sessions;
  if (sql.includes("INSERT INTO customer_sessions")) {
    const [token_hash, customer_id, role, expires_at, customer_email, idle_expires_at, tab_id] = values;
    store.set(token_hash, { token_hash, customer_id, role, expires_at, customer_email, idle_expires_at, tab_id });
    return { rows: [] };
  }
  if (sql.includes("INSERT INTO admin_sessions")) {
    const [token_hash, expires_at, idle_expires_at, tab_id] = values;
    store.set(token_hash, { token_hash, role: "admin", expires_at, idle_expires_at, tab_id });
    return { rows: [] };
  }
  if (sql.includes("UPDATE customer_sessions") && sql.includes("idle_expires_at")) {
    const [tokenHash, role, tabId, idleMinutes] = values;
    const session = store.get(tokenHash);
    if (!session || session.role !== role || session.tab_id !== tabId ||
      session.expires_at <= new Date() || session.idle_expires_at <= new Date()) return { rows: [] };
    session.idle_expires_at = new Date(Math.min(Date.now() + idleMinutes * 60_000, session.expires_at.getTime()));
    return { rows: [{ token_hash: tokenHash }] };
  }
  if (sql.includes("UPDATE admin_sessions") && sql.includes("idle_expires_at")) {
    const [tokenHash, tabId, idleMinutes] = values;
    const session = store.get(tokenHash);
    if (!session || session.tab_id !== tabId ||
      session.expires_at <= new Date() || session.idle_expires_at <= new Date()) return { rows: [] };
    session.idle_expires_at = new Date(Math.min(Date.now() + idleMinutes * 60_000, session.expires_at.getTime()));
    return { rows: [{ token_hash: tokenHash }] };
  }
  if (sql.includes("FROM customer_sessions s")) {
    const [tokenHash, role, tabId] = values;
    const session = store.get(tokenHash);
    const customer = [...customers.values()].find((item) => item.id === session?.customer_id);
    return {
      rows: session && session.role === role && session.tab_id === tabId &&
        session.expires_at > new Date() && session.idle_expires_at > new Date()
        ? [{ ...session, name: customer?.name || null, email: customer?.email || session.customer_email || null }]
        : []
    };
  }
  if (sql.includes("SELECT 'admin'")) {
    const [tokenHash, tabId] = values;
    const session = store.get(tokenHash);
    return {
        rows: session && session.tab_id === tabId &&
          session.expires_at > new Date() && session.idle_expires_at > new Date()
          ? [{ ...session, customer_id: null, customer_email: null, email: null, name: null }]
          : []
    };
  }
  if (sql.includes("DELETE FROM customer_sessions WHERE token_hash")) {
    sessions.delete(values[0]);
    return { rows: [] };
  }
  if (sql.includes("DELETE FROM admin_sessions WHERE token_hash")) {
    adminSessions.delete(values[0]);
    return { rows: [] };
  }
  if (sql.includes("DELETE FROM customer_sessions WHERE customer_id")) {
    for (const [hash, session] of sessions) {
      if (session.customer_id === values[0]) sessions.delete(hash);
    }
    return { rows: [] };
  }
  return null;
}

function createMemoryDatabase() {
  const customers = new Map();
  const orders = new Map();
  const sessions = new Map();
  const adminSessions = new Map();
  return {
    customers,
    orders,
    sessions,
    adminSessions,
    async query(sql, values = []) {
      const sessionResult = handleSessionQuery(sql, values, sessions, adminSessions, customers);
      if (sessionResult) return sessionResult;
      if (sql.includes("INSERT INTO customers")) {
        const [id, name, email, phone, password_hash] = values;
        const customer = { id, name, email: email.toLowerCase(), phone, password_hash };
        customers.set(customer.email, customer);
        return { rows: [{ id, name, email: customer.email, phone }] };
      }
      if (sql.includes("UPDATE orders SET customer_id")) {
        const [customerId, email] = values;
        for (const order of orders.values()) {
          if (order.customer_id === null && order.customer_email.trim().toLowerCase() === email) {
            order.customer_id = customerId;
          }
        }
        return { rows: [] };
      }
      if (sql.includes("SELECT id, name, email, phone, password_hash FROM customers")) {
        const customer = customers.get(String(values[0]).trim().toLowerCase());
        return { rows: customer ? [customer] : [] };
      }
      throw new Error(`Unexpected SQL in account service test: ${sql}`);
    }
  };
}

function createOrderMemoryDatabase() {
  const orders = new Map();
  const events = [];
  function recordEvent(values) {
    const [id, order_id, status, note] = values;
    events.push({ id, order_id, status, note });
    return { rows: [] };
  }
  function recordOrder(values) {
    const [
      id, number, customer_id, customer_email, name, phone, address, city, pin, note, items,
      subtotal, shipping, total, payment_method, payment_status, razorpay_order_id, checkout_key
    ] = values;
    if (checkout_key && [...orders.values()].some((order) => order.checkout_key === checkout_key)) {
      return { rows: [] };
    }
    const now = new Date().toISOString();
    const order = {
      id, number, customer_id, customer_email: customer_email.trim().toLowerCase(), name, phone, address, city, pin, note,
      items: JSON.parse(items), subtotal, shipping, discount: 0, total, payment_method, payment_status,
      payment_reference: null, razorpay_order_id, checkout_key, order_status: "Order Placed", created_at: now, updated_at: now,
      delivery_method: null, courier_name: null, tracking_id: null, tracking_url: null, courier_status: null,
      estimated_delivery: null, cancellation_requested: false, cancellation_request_status: null
    };
    orders.set(number, order);
    return { rows: [order] };
  }
  return {
    orders,
    events,
    async query(sql, values = []) {
      if (sql.includes("UPDATE orders SET payment_status")) {
        const [payment_status, payment_reference, number] = values;
        const order = orders.get(number);
        if (!order) return { rows: [] };
        order.payment_status = payment_status;
        order.payment_reference = payment_reference;
        order.order_status = payment_status === "Paid" && order.order_status === "Order Placed"
          ? "Order Confirmed"
          : order.order_status;
        return { rows: [order] };
      }
      if (sql.includes("INSERT INTO order_status_events")) return recordEvent(values);
      if (sql.includes("SELECT * FROM orders WHERE number")) {
        const order = orders.get(values[0]);
        return { rows: order ? [order] : [] };
      }
      if (sql.includes("LOWER(BTRIM(customer_email))")) {
        const customerId = values.length > 1 ? values[0] : null;
        const email = String(values.length > 1 ? values[1] : values[0]).trim().toLowerCase();
        return {
          rows: [...orders.values()].filter((order) =>
            (customerId !== null && order.customer_id === customerId) ||
            order.customer_email.trim().toLowerCase() === email)
        };
      }
      if (sql.includes("FROM orders o LEFT JOIN order_status_events")) {
        const [id, second, third] = values;
        const customerId = third === undefined ? null : second;
        const email = third === undefined ? second : third;
        const order = [...orders.values()].find((item) => item.id === id && (
          (customerId && item.customer_id === customerId) ||
          (email && item.customer_email.trim().toLowerCase() === String(email).toLowerCase())
        ));
        return { rows: order ? [{ ...order, events: events.filter((event) => event.order_id === order.id) }] : [] };
      }
      if (sql.includes("SELECT * FROM orders WHERE id = $1")) {
        const order = [...orders.values()].find((item) => item.id === values[0]);
        return { rows: order ? [order] : [] };
      }
      throw new Error(`Unexpected SQL in order persistence test: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
          if (sql.includes("INSERT INTO orders")) return recordOrder(values);
          if (sql.includes("SELECT * FROM orders WHERE checkout_key = $1")) {
            const order = [...orders.values()].find((item) => item.checkout_key === values[0]);
            return { rows: order ? [order] : [] };
          }
          if (sql.includes("INSERT INTO order_status_events")) return recordEvent(values);
          if (sql.includes("SELECT * FROM orders WHERE id = $1 FOR UPDATE")) {
            const order = [...orders.values()].find((item) => item.id === values[0]);
            return { rows: order ? [order] : [] };
          }
          if (sql.includes("UPDATE orders SET nimbuspost_order_id")) {
            const order = [...orders.values()].find((item) => item.id === values[1]);
            if (!order) return { rows: [] };
            order.nimbuspost_order_id = values[0];
            return { rows: [order] };
          }
          if (sql.includes("UPDATE orders SET delivery_method = 'NimbusPost'")) {
            const order = [...orders.values()].find((item) => item.id === values[5]);
            if (!order) return { rows: [] };
            [
              order.courier_name, order.tracking_id, order.tracking_url, order.courier_status,
              order.nimbuspost_awb, order.nimbuspost_label_url
            ] = [values[0], values[1], values[2], values[3], values[1], values[4]];
            order.delivery_method = "NimbusPost";
            return { rows: [order] };
          }
          throw new Error(`Unexpected transaction SQL in order persistence test: ${sql}`);
        },
        release() {}
      };
    }
  };
}

function createOtpMemoryDatabase() {
  const challenges = [];
  const sessions = new Map();
  const adminSessions = new Map();
  return {
    challenges,
    sessions,
    adminSessions,
    async query(sql, values = []) {
      const sessionResult = handleSessionQuery(sql, values, sessions, adminSessions);
      if (sessionResult) return sessionResult;
      if (sql.includes("UPDATE customer_email_otp_tokens SET used_at = NOW() WHERE email = $1")) {
        for (const challenge of challenges) {
          if (challenge.email === values[0] && !challenge.used_at && challenge.expires_at > new Date()) {
            challenge.used_at = new Date();
          }
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO customer_email_otp_tokens")) {
        const [id, email, otp_hash, expires_at] = values;
        challenges.push({ id, email, otp_hash, attempts: 0, expires_at, used_at: null, created_at: new Date() });
        return { rows: [] };
      }
      if (sql.includes("FROM customer_email_otp_tokens") && sql.includes("ORDER BY created_at DESC")) {
        const challenge = [...challenges].reverse().find((item) =>
          item.email === values[0] && item.expires_at > new Date() && !item.used_at);
        return { rows: challenge ? [challenge] : [] };
      }
      if (sql.includes("UPDATE customer_email_otp_tokens SET attempts = $1")) {
        const challenge = challenges.find((item) => item.id === values[1]);
        if (challenge) challenge.attempts = values[0];
        return { rows: [] };
      }
      if (sql.includes("UPDATE customer_email_otp_tokens SET used_at = NOW() WHERE id = $1")) {
        const challenge = challenges.find((item) => item.id === values[0]);
        if (challenge) challenge.used_at = new Date();
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in OTP test: ${sql}`);
    }
  };
}

test("email OTP is cryptographically generated, hashed, expiring, and creates a scoped email session", async () => {
  const database = createOtpMemoryDatabase();
  const messages = [];
  const service = createAccountService({
    database,
    emailService: { send: async (message) => { messages.push(message); return { id: "email_test" }; } },
    environment: { OTP_SECRET: "a-secure-otp-hmac-secret-that-is-at-least-32-characters" }
  });

  const challenge = await service.requestEmailOtp(" Buyer@Example.test ");
  assert.equal(challenge.email, "buyer@example.test");
  assert.equal("otp" in challenge, false);
  assert.equal(database.challenges[0].email, "buyer@example.test");
  assert.notEqual(database.challenges[0].otp_hash, messages[0].text.match(/\d{6}/)[0]);
  const otp = messages[0].text.match(/\b(\d{6})\b/)[1];
  const incorrectOtp = otp === "000001" ? "000002" : "000001";
  const rejected = await service.verifyEmailOtp("BUYER@example.test", incorrectOtp, customerTabId);
  assert.equal(rejected.ok, false);

  const verified = await service.verifyEmailOtp(" Buyer@example.test ", otp, customerTabId);
  assert.equal(verified.ok, true);
  assert.equal(verified.customer.email, "buyer@example.test");
  assert.equal(database.challenges[0].used_at instanceof Date, true);
  const session = [...database.sessions.values()][0];
  assert.equal(session.customer_id, null);
  assert.equal(session.customer_email, "buyer@example.test");
  assert.equal(session.tab_id, customerTabId);
});

test("email OTP attempts are limited and expired codes cannot authenticate", async () => {
  const database = createOtpMemoryDatabase();
  const messages = [];
  const service = createAccountService({
    database,
    emailService: { send: async (message) => { messages.push(message); return { id: "email_test" }; } },
    environment: { OTP_SECRET: "a-secure-otp-hmac-secret-that-is-at-least-32-characters" }
  });

  await service.requestEmailOtp("buyer@example.test");
  const code = messages[0].text.match(/\b(\d{6})\b/)[1];
  const wrongCode = code === "999999" ? "999998" : "999999";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const invalid = await service.verifyEmailOtp("buyer@example.test", wrongCode, customerTabId);
    assert.equal(invalid.ok, false);
  }
  const locked = await service.verifyEmailOtp("buyer@example.test", code, customerTabId);
  assert.equal(locked.locked, true);
  assert.equal(database.sessions.size, 0);

  await service.requestEmailOtp("buyer@example.test");
  database.challenges.at(-1).expires_at = new Date(Date.now() - 1);
  assert.equal(await service.verifyEmailOtp("buyer@example.test", messages[1].text.match(/\b(\d{6})\b/)[1], customerTabId), null);
});

test("whitespace-only OTP secrets and admin passwords are rejected", async () => {
  const otpDatabase = createOtpMemoryDatabase();
  const otpService = createAccountService({
    database: otpDatabase,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: { OTP_SECRET: "   " }
  });
  await assert.rejects(() => otpService.requestEmailOtp("buyer@example.test"), /OTP_SECRET/);

  const adminService = createAccountService({
    database: createMemoryDatabase(),
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: { ADMIN_EMAIL: "studio@example.test", ADMIN_PASSWORD: "   " }
  });
  assert.equal(await adminService.adminLogin("studio@example.test", "admin-pass-12345", adminTabId), null);
});

test("invalid session timeout configuration is rejected", () => {
  assert.throws(() => createAccountService({
    database: createMemoryDatabase(),
    emailService: null,
    environment: { ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: "0" }
  }), /ADMIN_SESSION_IDLE_TIMEOUT_MINUTES/);
});

test("customer and admin sessions are role- and tab-scoped with idle and absolute expiry", async () => {
  const database = createMemoryDatabase();
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {
      ADMIN_EMAIL: "studio@example.test",
      ADMIN_PASSWORD: "admin-password-with-at-least-16-chars",
      CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES: "1",
      CUSTOMER_SESSION_MAX_LIFETIME_HOURS: "1",
      ADMIN_SESSION_IDLE_TIMEOUT_MINUTES: "1",
      ADMIN_SESSION_MAX_LIFETIME_HOURS: "1"
    }
  });
  const customer = await service.register({
    name: "Meow Buyer",
    email: "buyer@example.test",
    phone: "9876543210",
    password: "a-secure-customer-password"
  }, customerTabId);
  const customerHash = createHash("sha256").update(customer.session.token).digest("hex");
  const customerRecord = database.sessions.get(customerHash);

  assert.equal((await service.resolveSession(customer.session.token, "customer", customerTabId)).role, "customer");
  assert.equal(await service.resolveSession(customer.session.token, "admin", customerTabId), null);
  assert.equal(await service.resolveSession(customer.session.token, "customer", "c".repeat(32)), null);
  const idleBeforeRead = customerRecord.idle_expires_at.getTime();
  await service.resolveSession(customer.session.token, "customer", customerTabId);
  assert.equal(customerRecord.idle_expires_at.getTime(), idleBeforeRead, "ordinary requests must not extend idle expiry");

  customerRecord.expires_at = new Date(Date.now() + 60_000);
  customerRecord.idle_expires_at = new Date(Date.now() + 500);
  await service.resolveSession(customer.session.token, "customer", customerTabId, true);
  assert.ok(customerRecord.idle_expires_at <= customerRecord.expires_at, "activity must not exceed the absolute lifetime");

  const admin = await service.adminLogin("studio@example.test", "admin-password-with-at-least-16-chars", adminTabId);
  const adminHash = createHash("sha256").update(admin.session.token).digest("hex");
  assert.equal(database.adminSessions.has(adminHash), true);
  assert.equal(database.sessions.has(adminHash), false);
  assert.equal((await service.resolveSession(admin.session.token, "admin", adminTabId)).role, "admin");
  await service.logout(admin.session.token, "admin");
  assert.equal(await service.resolveSession(admin.session.token, "admin", adminTabId), null);
  assert.equal(database.adminSessions.has(adminHash), false);
  assert.equal((await service.resolveSession(customer.session.token, "customer", customerTabId)).role, "customer");
  customerRecord.idle_expires_at = new Date(Date.now() - 1);
  assert.equal(await service.resolveSession(customer.session.token, "customer", customerTabId, true), null);
  customerRecord.idle_expires_at = new Date(Date.now() + 60_000);
  customerRecord.expires_at = new Date(Date.now() - 1);
  assert.equal(await service.resolveSession(customer.session.token, "customer", customerTabId, true), null);
  await service.logout(customer.session.token);
  assert.equal(database.sessions.has(customerHash), false);
  assert.equal((await service.resolveSession(customer.session.token, "customer", customerTabId)), null);
});

test("customer account passwords are hashed and sessions are opaque, expiring server records", async () => {
  const database = createMemoryDatabase();
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {}
  });

  const registered = await service.register({
    name: "Meow Buyer",
    email: "buyer@example.test",
    phone: "+91 98765 43210",
    password: "a-secure-customer-password"
  }, customerTabId);
  const savedCustomer = database.customers.get("buyer@example.test");
  assert.match(savedCustomer.password_hash, /^scrypt\$/);
  assert.notEqual(savedCustomer.password_hash, "a-secure-customer-password");
  assert.ok(registered.session.expiresAt > new Date());
  assert.equal(database.sessions.size, 1);
  const [storedTokenHash] = [...database.sessions.entries()][0];
  assert.equal(storedTokenHash, createHash("sha256").update(registered.session.token).digest("hex"));
  assert.notEqual(storedTokenHash, registered.session.token);
  assert.equal((await service.resolveSession(registered.session.token, "customer", customerTabId)).role, "customer");
  assert.equal(await service.resolveSession("not-a-session-token", "customer", customerTabId), null);
});

test("registering with an order email links unclaimed guest orders to the account", async () => {
  const database = createMemoryDatabase();
  const previousOrder = {
    id: "guest-order-id",
    customer_id: null,
    customer_email: "buyer@example.test"
  };
  const unrelatedOrder = {
    id: "unrelated-order-id",
    customer_id: null,
    customer_email: "someone-else@example.test"
  };
  const alreadyOwnedOrder = {
    id: "already-owned-order-id",
    customer_id: "another-customer-id",
    customer_email: "buyer@example.test"
  };
  const lateGuestOrder = {
    id: "late-guest-order-id",
    customer_id: null,
    customer_email: "buyer@example.test"
  };
  database.orders.set(previousOrder.id, previousOrder);
  database.orders.set(unrelatedOrder.id, unrelatedOrder);
  database.orders.set(alreadyOwnedOrder.id, alreadyOwnedOrder);
  const service = createAccountService({
    database,
    emailService: null,
    environment: {}
  });

  const registered = await service.register({
    name: "Meow Buyer",
    email: "Buyer@Example.Test",
    phone: "9876543210",
    password: "a-secure-customer-password"
  }, customerTabId);

  assert.equal(previousOrder.customer_id, registered.customer.id);
  assert.equal(unrelatedOrder.customer_id, null);
  assert.equal(alreadyOwnedOrder.customer_id, "another-customer-id");

  database.orders.set(lateGuestOrder.id, lateGuestOrder);
  const loggedIn = await service.login(" Buyer@Example.Test ", "a-secure-customer-password", customerTabId);
  assert.equal(loggedIn.customer.id, registered.customer.id);
  assert.equal(lateGuestOrder.customer_id, registered.customer.id);
});

test("customer login verifies passwords and admin login cannot create a customer session", async () => {
  const database = createMemoryDatabase();
  const adminPassword = "admin-pass-12345";
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: { ADMIN_EMAIL: "studio@example.test", ADMIN_PASSWORD: adminPassword }
  });
  await service.register({
    name: "Meow Buyer",
    email: "buyer@example.test",
    phone: "9876543210",
    password: "a-secure-customer-password"
  }, customerTabId);

  assert.equal(await service.login("buyer@example.test", "wrong-password", customerTabId), null);
  const login = await service.login("buyer@example.test", "a-secure-customer-password", customerTabId);
  assert.equal(login.customer.email, "buyer@example.test");
  assert.equal(await service.adminLogin("buyer@example.test", "a-secure-customer-password", adminTabId), null);
  assert.equal(await service.adminLogin("studio@example.test", "admin-pass-1234", adminTabId), null);
  const admin = await service.adminLogin("studio@example.test", adminPassword, adminTabId);
  assert.equal((await service.resolveSession(admin.session.token, "admin", adminTabId)).role, "admin");
  assert.equal((await service.resolveSession(admin.session.token, "admin", adminTabId)).customer_id, null);
});

test("UPI order details are stored and payment verification updates the persisted order", async () => {
  const database = createOrderMemoryDatabase();
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {}
  });
  const order = {
    number: "MC-TEST-ORDER",
    name: "Test buyer",
    email: " Buyer@Example.Test ",
    phone: "+91 98765 43210",
    address: "1 Test Street",
    city: "Test City",
    pin: "123456",
    note: "Leave at the door",
    items: [{ id: "flower-keychain", name: "Flower keychain", qty: 2, unitPrice: 250 }],
    subtotal: 500,
    shipping: 29,
    total: 529,
    payment: "UPI"
  };

  const saved = await service.saveOrder(order, {
    razorpayOrderId: "order_test_123",
    paymentStatus: "Pending"
  });

  assert.equal(saved.number, order.number);
  assert.equal(saved.email, "buyer@example.test");
  assert.equal(database.orders.get(order.number).customer_email, "buyer@example.test");
  assert.equal(saved.paymentMethod, "UPI");
  assert.equal(saved.paymentStatus, "Pending");
  assert.equal(saved.total, order.total);
  assert.deepEqual(saved.items, order.items);
  assert.equal(database.orders.get(order.number).razorpay_order_id, "order_test_123");
  assert.equal(database.events[0].status, "Order Placed");
  assert.equal((await service.listCustomerOrdersByEmail(" BUYER@example.test ")).length, 1);
  assert.equal((await service.getOrderForSession({ customer_email: "buyer@example.test" }, saved.id)).id, saved.id);
  const accountSession = { customer_id: "registered-customer-id", customer_email: "buyer@example.test" };
  assert.equal((await service.listOrdersForSession(accountSession)).length, 1);
  assert.equal((await service.getOrderForSession(accountSession, saved.id)).id, saved.id);
  assert.equal(await service.getOrderForSession({ customer_id: "registered-customer-id", customer_email: "another@example.test" }, saved.id), null);
  assert.equal(await service.getOrderForSession({ customer_email: "another@example.test" }, saved.id), null);

  const paid = await service.updatePayment(order.number, "Paid", "pay_test_456");

  assert.equal(paid.paymentStatus, "Paid");
  assert.equal(paid.paymentReference, "pay_test_456");
  assert.equal(paid.status, "Order Confirmed");
  assert.equal(database.events[1].status, "Order Confirmed");
});

test("cash-on-delivery order creation is idempotent and preserves the original order", async () => {
  const database = createOrderMemoryDatabase();
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {}
  });
  const order = {
    number: "MC-COD-ORIGINAL",
    name: "Test buyer",
    email: " Buyer@Example.Test ",
    phone: "9876543210",
    address: "1 Test Street",
    city: "Test City",
    pin: "123456",
    items: [{ id: "flower-keychain", name: "Flower keychain", qty: 1, unitPrice: 250 }],
    subtotal: 250,
    shipping: 29,
    total: 279,
    payment: "COD"
  };
  const idempotencyKey = "00000000-0000-4000-8000-000000000002";
  const first = await service.saveOrder(order, { paymentStatus: "Due on delivery", idempotencyKey });
  const replay = await service.saveOrder({ ...order, number: "MC-COD-RETRY", name: "Changed retry" }, {
    paymentStatus: "Due on delivery",
    idempotencyKey
  });

  assert.equal(first.id, replay.id);
  assert.equal(replay.number, "MC-COD-ORIGINAL");
  assert.equal(replay.name, "Test buyer");
  assert.equal(replay.paymentMethod, "COD");
  assert.equal(replay.paymentStatus, "Due on delivery");
  assert.equal(database.orders.size, 1);
  assert.equal(database.events.length, 1);
});

test("NimbusPost orders are created once and booking details are saved to order tracking", async () => {
  const database = createOrderMemoryDatabase();
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {}
  });
  const order = {
    number: "MC-TEST-NIMBUS",
    name: "Test buyer",
    email: "buyer@example.test",
    phone: "9876543210",
    address: "1 Test Street",
    city: "Test City",
    pin: "123456",
    items: [{ id: "flower-keychain", name: "Flower keychain", qty: 1, unitPrice: 250 }],
    subtotal: 250,
    shipping: 29,
    total: 279,
    payment: "UPI"
  };
  const saved = await service.saveOrder(order, { paymentStatus: "Paid" });
  let createCalls = 0;
  const createOrder = async (currentOrder) => {
    createCalls += 1;
    assert.equal(currentOrder.number, order.number);
    return "np_order_123";
  };

  assert.equal(await service.createNimbusPostOrder(saved.id, createOrder), "np_order_123");
  assert.equal(await service.createNimbusPostOrder(saved.id, createOrder), "np_order_123");
  assert.equal(createCalls, 1);
  let bookCalls = 0;
  const booked = await service.bookNimbusPostOrder(saved.id, async (partnerOrderId) => {
    bookCalls += 1;
    assert.equal(partnerOrderId, "np_order_123");
    return {
      awb: "AWB123456789",
      courierName: "Courier Partner",
      trackingUrl: "https://track.example.test/AWB123456789",
      labelUrl: "https://labels.example.test/AWB123456789.pdf",
      status: "booked"
    };
  });
  const repeat = await service.bookNimbusPostOrder(saved.id, async () => {
    bookCalls += 1;
    throw new Error("A booked shipment must not be sent again.");
  });

  assert.equal(bookCalls, 1);
  assert.equal(booked.deliveryMethod, "NimbusPost");
  assert.equal(booked.courierName, "Courier Partner");
  assert.equal(booked.trackingId, "AWB123456789");
  assert.equal(booked.nimbuspostAwb, "AWB123456789");
  assert.equal(booked.nimbuspostLabelUrl, "https://labels.example.test/AWB123456789.pdf");
  assert.equal(repeat.trackingId, "AWB123456789");
  assert.equal(database.events.at(-1).status, "NimbusPost shipment booked");
});
