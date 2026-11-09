import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { createOrderNumber } from "./payment-service.js";

const scrypt = promisify(callbackScrypt);
const resetLifetimeMs = 60 * 60 * 1000;
const orderStatuses = new Set([
  "Order Placed",
  "Order Confirmed",
  "Processing",
  "Ready for Delivery",
  "Shipped / Out for Delivery",
  "Delivered",
  "Cancelled",
  "Failed Delivery",
  "Returned"
]);
const terminalStatuses = new Set(["Delivered", "Cancelled", "Returned"]);

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  const [algorithm, saltHex, hashHex, ...extra] = String(storedHash).split("$");
  if (algorithm !== "scrypt" || !/^[\da-f]{32}$/i.test(saltHex) || !/^[\da-f]{128}$/i.test(hashHex) || extra.length) return false;
  const expected = Buffer.from(hashHex, "hex");
  const supplied = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}

const dummyPasswordHash = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

function safeOrder(row) {
  return {
    id: row.id,
    number: row.number,
    name: row.name,
    email: row.customer_email,
    phone: row.phone,
    address: row.address,
    city: row.city,
    pin: row.pin,
    note: row.note,
    items: row.items,
    subtotal: Number(row.subtotal),
    shipping: Number(row.shipping),
    discount: Number(row.discount),
    total: Number(row.total),
    paymentMethod: row.payment_method,
    paymentStatus: row.payment_status,
    paymentReference: row.payment_reference,
    customOrderId: row.custom_order_id || null,
    status: row.order_status,
    deliveryMethod: row.delivery_method,
    courierName: row.courier_name,
    trackingId: row.tracking_id,
    trackingUrl: row.tracking_url,
    courierStatus: row.courier_status,
    estimatedDelivery: row.estimated_delivery,
    cancellationRequested: row.cancellation_requested,
    cancellationRequestStatus: row.cancellation_request_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    events: row.events || []
  };
}

function safeAdminOrder(row) {
  return {
    ...safeOrder(row),
    nimbuspostOrderId: row.nimbuspost_order_id,
    nimbuspostAwb: row.nimbuspost_awb,
    nimbuspostLabelUrl: row.nimbuspost_label_url
  };
}

function safeReview(row) {
  return {
    id: row.id,
    productId: row.product_id,
    customerId: row.customer_id,
    orderId: row.order_id,
    customerName: row.customer_name,
    rating: Number(row.rating),
    reviewTitle: row.review_title || "",
    reviewText: row.review_text,
    status: row.status,
    isFeatured: Boolean(row.is_featured),
    adminNote: row.admin_note || "",
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderNumber: row.order_number || "",
    orderCustomerName: row.order_customer_name || "",
    productName: row.product_name || "",
    photos: Array.isArray(row.photos) ? row.photos : [],
    moderationHistory: Array.isArray(row.moderation_history) ? row.moderation_history : []
  };
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hashOtpCode(code, secret) {
  return createHmac("sha256", secret).update(String(code)).digest("hex");
}

function timeoutValue(environment, name, fallback, maximum) {
  const value = environment[name] === undefined || environment[name] === ""
    ? fallback
    : Number(environment[name]);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be a whole number between 1 and ${maximum}.`);
  }
  return value;
}

export function createAccountService({ database, emailService, environment }) {
  const otpSecret = String(environment.OTP_SECRET ?? "");
  const sessionTimeouts = {
    customer: {
      idleMinutes: timeoutValue(environment, "CUSTOMER_SESSION_IDLE_TIMEOUT_MINUTES", 30, 1440),
      maxHours: timeoutValue(environment, "CUSTOMER_SESSION_MAX_LIFETIME_HOURS", 8, 168)
    },
    admin: {
      idleMinutes: timeoutValue(environment, "ADMIN_SESSION_IDLE_TIMEOUT_MINUTES", 30, 1440),
      maxHours: timeoutValue(environment, "ADMIN_SESSION_MAX_LIFETIME_HOURS", 8, 168)
    }
  };

  async function createSession(customerId, role, customerEmail, tabId) {
    if (!sessionTimeouts[role]) throw new Error("Cannot create a session for an unsupported role.");
    if (!/^[\da-f]{32}$/i.test(tabId || "")) throw new Error("A valid tab session identifier is required.");
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const expiresAt = new Date(now + sessionTimeouts[role].maxHours * 60 * 60 * 1000);
    const idleExpiresAt = new Date(Math.min(now + sessionTimeouts[role].idleMinutes * 60 * 1000, expiresAt.getTime()));
    const normalizedEmail = customerEmail ? normalizeEmail(customerEmail) : null;
    if (role === "admin") {
      await database.query(
        `INSERT INTO admin_sessions (token_hash, expires_at, idle_expires_at, tab_id)
         VALUES ($1, $2, $3, $4)`,
        [hashToken(token), expiresAt, idleExpiresAt, tabId]
      );
    } else {
      await database.query(
        `INSERT INTO customer_sessions
         (token_hash, customer_id, role, expires_at, customer_email, idle_expires_at, tab_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [hashToken(token), customerId, role, expiresAt, normalizedEmail, idleExpiresAt, tabId]
      );
    }
    return { token, expiresAt, idleExpiresAt };
  }

  async function resolveSession(token, role, tabId, userActivity = false) {
    if (!token || !sessionTimeouts[role] || !/^[\da-f]{32}$/i.test(tabId || "")) return null;
    const tokenHash = hashToken(token);
    if (role === "admin") {
      if (userActivity) {
        const active = await database.query(
          `UPDATE admin_sessions
           SET idle_expires_at = LEAST(NOW() + ($3 * INTERVAL '1 minute'), expires_at)
           WHERE token_hash = $1 AND tab_id = $2
             AND expires_at > NOW() AND idle_expires_at > NOW()
           RETURNING token_hash`,
          [tokenHash, tabId, sessionTimeouts.admin.idleMinutes]
        );
        if (!active.rows.length) return null;
      }
      const result = await database.query(
        `SELECT 'admin' AS role, NULL::uuid AS customer_id, NULL::text AS customer_email,
          expires_at, idle_expires_at, NULL::text AS name, NULL::text AS email
         FROM admin_sessions
         WHERE token_hash = $1 AND tab_id = $2 AND expires_at > NOW() AND idle_expires_at > NOW()`,
        [tokenHash, tabId]
      );
      return result.rows[0] || null;
    }
    if (userActivity) {
      const active = await database.query(
        `UPDATE customer_sessions
         SET idle_expires_at = LEAST(NOW() + ($4 * INTERVAL '1 minute'), expires_at)
         WHERE token_hash = $1 AND role = $2 AND tab_id = $3
           AND expires_at > NOW() AND idle_expires_at > NOW()
         RETURNING token_hash`,
        [tokenHash, role, tabId, sessionTimeouts[role].idleMinutes]
      );
      if (!active.rows.length) return null;
    }
    const result = await database.query(
      `SELECT s.role, s.customer_id, s.customer_email, s.expires_at, s.idle_expires_at, c.name, c.email
       FROM customer_sessions s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = $1 AND s.role = $2 AND s.tab_id = $3
         AND s.expires_at > NOW() AND s.idle_expires_at > NOW()`,
      [tokenHash, role, tabId]
    );
    const session = result.rows[0];
    if (!session) return null;
    return {
      ...session,
      email: session.customer_email || session.email || null,
      customer_email: session.customer_email || session.email || null
    };
  }

  async function linkOrdersToCustomer(customerId, email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return;
    await database.query(
      `UPDATE orders SET customer_id = $1, updated_at = NOW()
       WHERE LOWER(BTRIM(customer_email)) = $2 AND customer_id IS NULL`,
      [customerId, normalizedEmail]
    );
  }

  async function register({ name, email, phone, password }, tabId) {
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const result = await database.query(
      `INSERT INTO customers (id, name, email, phone, password_hash)
       VALUES ($1, $2, LOWER(BTRIM($3)), $4, $5)
       RETURNING id, name, email, phone`,
      [id, name, email, phone, passwordHash]
    );
    await linkOrdersToCustomer(result.rows[0].id, result.rows[0].email);
    const session = await createSession(id, "customer", result.rows[0].email, tabId);
    return { customer: result.rows[0], session };
  }

  async function login(email, password, tabId) {
    const result = await database.query(
      "SELECT id, name, email, phone, password_hash FROM customers WHERE email = LOWER(BTRIM($1))",
      [email]
    );
    const customer = result.rows[0];
    if (!customer) {
      await verifyPassword(password, dummyPasswordHash);
      return null;
    }
    if (!await verifyPassword(password, customer.password_hash)) return null;
    await linkOrdersToCustomer(customer.id, customer.email);
    const session = await createSession(customer.id, "customer", customer.email, tabId);
    return {
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
      session
    };
  }

  async function adminLogin(email, password, tabId) {
    const configuredEmail = String(environment.ADMIN_EMAIL ?? "").trim().toLowerCase();
    const configuredPassword = String(environment.ADMIN_PASSWORD ?? "");
    if (!configuredEmail || configuredPassword.trim().length < 16) return null;
    const suppliedEmail = Buffer.from(String(email || "").trim().toLowerCase());
    const expectedEmail = Buffer.from(configuredEmail);
    const suppliedPassword = createHash("sha256").update(String(password || "")).digest();
    const expectedPassword = createHash("sha256").update(configuredPassword).digest();
    const emailMatches = suppliedEmail.length === expectedEmail.length && timingSafeEqual(suppliedEmail, expectedEmail);
    const passwordMatches = timingSafeEqual(suppliedPassword, expectedPassword);
    if (!emailMatches || !passwordMatches) return null;
    return { session: await createSession(null, "admin", null, tabId) };
  }

  async function requestEmailOtp(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Enter a valid email address.");
    }
    if (otpSecret.trim().length < 32) {
      throw new Error("Email verification is not configured. Set OTP_SECRET to a random value of at least 32 characters.");
    }
    if (typeof emailService?.send !== "function") {
      throw new Error("Email verification is unavailable because email delivery is not configured.");
    }
    const otp = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const otpHash = hashOtpCode(otp, otpSecret);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await database.query(
      "UPDATE customer_email_otp_tokens SET used_at = NOW() WHERE email = $1 AND used_at IS NULL AND expires_at > NOW()",
      [normalizedEmail]
    );
    await database.query(
      "INSERT INTO customer_email_otp_tokens (id, email, otp_hash, attempts, expires_at, created_at) VALUES ($1, $2, $3, 0, $4, NOW())",
      [randomUUID(), normalizedEmail, otpHash, expiresAt]
    );
    await emailService.send({
      to: normalizedEmail,
      subject: "Your Meow.Cro verification code",
      text: `Your Meow.Cro verification code is ${otp}. This code expires in 5 minutes.`
    });
    return { email: normalizedEmail, expiresAt };
  }

  async function verifyEmailOtp(email, otp, tabId) {
    const normalizedEmail = normalizeEmail(email);
    const inputOtp = String(otp ?? "").replace(/\D/g, "");
    const result = await database.query(
      `SELECT * FROM customer_email_otp_tokens
       WHERE email = $1 AND expires_at > NOW() AND used_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail]
    );
    const challenge = result.rows[0];
    if (!challenge) return null;
    if (Number(challenge.attempts) >= 5) {
      await database.query("UPDATE customer_email_otp_tokens SET used_at = NOW() WHERE id = $1", [challenge.id]);
      return { ok: false, attempts: Number(challenge.attempts), maxAttempts: 5, locked: true };
    }
    const expected = Buffer.from(hashOtpCode(inputOtp, otpSecret), "hex");
    const storedHash = Buffer.from(challenge.otp_hash, "hex");
    if (expected.length !== storedHash.length || !timingSafeEqual(expected, storedHash)) {
      const attempts = Number(challenge.attempts) + 1;
      await database.query(
        "UPDATE customer_email_otp_tokens SET attempts = $1 WHERE id = $2",
        [attempts, challenge.id]
      );
      return { ok: false, attempts, maxAttempts: 5 };
    }
    await database.query(
      "UPDATE customer_email_otp_tokens SET used_at = NOW() WHERE id = $1",
      [challenge.id]
    );
    const session = await createSession(null, "customer", normalizedEmail, tabId);
    return { ok: true, session, customer: { email: normalizedEmail } };
  }

  async function checkEmailOtpRateLimit(email) {
    const normalizedEmail = normalizeEmail(email);
    const result = await database.query(
      `SELECT MAX(created_at) AS last_requested_at
       FROM customer_email_otp_tokens WHERE email = $1`,
      [normalizedEmail]
    );
    const lastRequested = result.rows[0]?.last_requested_at;
    if (!lastRequested) return false;
    return Date.now() - new Date(lastRequested).getTime() < 30_000;
  }

  async function logout(token, role = "customer") {
    if (!token) return;
    if (role === "admin") {
      await database.query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
      return;
    }
    await database.query("DELETE FROM customer_sessions WHERE token_hash = $1", [hashToken(token)]);
  }

  async function requestPasswordReset(email) {
    const result = await database.query("SELECT id, name, email FROM customers WHERE email = LOWER($1)", [email]);
    if (!result.rows[0]) return;
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + resetLifetimeMs);
    await database.query(
      "INSERT INTO password_reset_tokens (token_hash, customer_id, expires_at) VALUES ($1, $2, $3)",
      [hashToken(token), result.rows[0].id, expiresAt]
    );
    const baseUrl = (environment.APP_BASE_URL || "https://meowcro.in").replace(/\/+$/, "");
    await emailService.send({
      to: result.rows[0].email,
      subject: "Reset your Meow.Cro password",
      text: [
        `Hi ${result.rows[0].name},`,
        "",
        "Use this link within one hour to reset your password:",
        `${baseUrl}/account.html?reset=${encodeURIComponent(token)}`,
        "",
        "If you did not request this, you can ignore this email."
      ].join("\n")
    });
  }

  async function resetPassword(token, password) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "SELECT customer_id FROM password_reset_tokens WHERE token_hash = $1 AND expires_at > NOW() FOR UPDATE",
        [hashToken(token)]
      );
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return false;
      }
      const passwordHash = await hashPassword(password);
      await client.query("UPDATE customers SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, result.rows[0].customer_id]);
      await client.query("DELETE FROM password_reset_tokens WHERE customer_id = $1", [result.rows[0].customer_id]);
      await client.query("DELETE FROM customer_sessions WHERE customer_id = $1", [result.rows[0].customer_id]);
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getProfile(customerId) {
    const [customer, addresses, orders] = await Promise.all([
      database.query("SELECT id, name, email, phone FROM customers WHERE id = $1", [customerId]),
      database.query(
        "SELECT id, label, recipient_name AS \"recipientName\", phone, address, city, pin FROM customer_addresses WHERE customer_id = $1 ORDER BY created_at DESC",
        [customerId]
      ),
      database.query(
        `SELECT order_status, COUNT(*)::int AS count FROM orders
         WHERE customer_id = $1
           OR LOWER(BTRIM(customer_email)) = (
             SELECT LOWER(BTRIM(email)) FROM customers WHERE id = $1
           )
         GROUP BY order_status`,
        [customerId]
      )
    ]);
    const orderCounts = Object.fromEntries(orders.rows.map((row) => [row.order_status, row.count]));
    const totalOrders = Object.values(orderCounts).reduce((sum, count) => sum + count, 0);
    return {
      customer: customer.rows[0],
      addresses: addresses.rows,
      overview: {
        total: totalOrders,
        pending: (orderCounts["Order Placed"] || 0) +
          (orderCounts["Order Confirmed"] || 0) +
          (orderCounts.Processing || 0) +
          (orderCounts["Ready for Delivery"] || 0),
        inTransit: orderCounts["Shipped / Out for Delivery"] || 0,
        delivered: orderCounts.Delivered || 0
      }
    };
  }

  async function updateProfile(customerId, { name, phone }) {
    const result = await database.query(
      "UPDATE customers SET name = $1, phone = $2, updated_at = NOW() WHERE id = $3 RETURNING id, name, email, phone",
      [name, phone, customerId]
    );
    return result.rows[0];
  }

  async function changePassword(customerId, currentPassword, newPassword) {
    const result = await database.query("SELECT password_hash FROM customers WHERE id = $1", [customerId]);
    if (!result.rows[0] || !await verifyPassword(currentPassword, result.rows[0].password_hash)) return false;
    const passwordHash = await hashPassword(newPassword);
    await database.query("UPDATE customers SET password_hash = $1, updated_at = NOW() WHERE id = $2", [passwordHash, customerId]);
    await database.query("DELETE FROM customer_sessions WHERE customer_id = $1", [customerId]);
    return true;
  }

  async function saveAddress(customerId, address, id = randomUUID()) {
    const result = await database.query(
      `INSERT INTO customer_addresses (id, customer_id, label, recipient_name, phone, address, city, pin)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, recipient_name = EXCLUDED.recipient_name,
         phone = EXCLUDED.phone, address = EXCLUDED.address, city = EXCLUDED.city, pin = EXCLUDED.pin,
         updated_at = NOW()
       WHERE customer_addresses.customer_id = EXCLUDED.customer_id
       RETURNING id, label, recipient_name AS "recipientName", phone, address, city, pin`,
      [id, customerId, address.label, address.recipientName, address.phone, address.address, address.city, address.pin]
    );
    return result.rows[0] || null;
  }

  async function deleteAddress(customerId, id) {
    const result = await database.query("DELETE FROM customer_addresses WHERE id = $1 AND customer_id = $2", [id, customerId]);
    return result.rowCount > 0;
  }

  async function saveOrder(order, {
    customerId = null,
    razorpayOrderId = null,
    paymentStatus = "Pending",
    idempotencyKey = null
  } = {}) {
    const id = randomUUID();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `INSERT INTO orders (
          id, number, customer_id, customer_email, name, phone, address, city, pin, note, items,
          subtotal, shipping, total, payment_method, payment_status, razorpay_order_id, checkout_key
        ) VALUES ($1, $2, $3, LOWER(BTRIM($4)), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (checkout_key) WHERE checkout_key IS NOT NULL DO NOTHING
        RETURNING *`,
        [
          id, order.number, customerId, order.email, order.name, order.phone, order.address, order.city, order.pin,
          order.note || "", JSON.stringify(order.items), order.subtotal, order.shipping, order.total,
          order.payment, paymentStatus, razorpayOrderId, idempotencyKey
        ]
      );
      if (!result.rows[0] && idempotencyKey) {
        const existing = await client.query("SELECT * FROM orders WHERE checkout_key = $1", [idempotencyKey]);
        if (!existing.rows[0]) throw new Error("The checkout request could not be saved.");
        await client.query("COMMIT");
        return safeOrder(existing.rows[0]);
      }
      if (!result.rows[0]) throw new Error("The checkout request could not be saved.");
      await client.query(
        "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
        [randomUUID(), id, "Order Placed", paymentStatus === "Pending" ? "Awaiting payment or studio confirmation." : "Order received."]
      );
      await client.query("COMMIT");
      return safeOrder(result.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function startCustomOrderPayment(token, checkout, customerId, createPaymentOrder) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const requestResult = await client.query(
        `SELECT * FROM custom_order_requests
         WHERE quote_token_hash = $1 AND status = 'offered' AND quote_expires_at > NOW()
         FOR UPDATE`,
        [hashToken(token)]
      );
      const request = requestResult.rows[0];
      if (!request) {
        await client.query("ROLLBACK");
        return null;
      }

      const existingOrderResult = await client.query(
        "SELECT * FROM orders WHERE custom_order_id = $1 FOR UPDATE",
        [request.id]
      );
      const existingOrder = existingOrderResult.rows[0];
      const total = Number(request.quoted_amount);
      const order = {
        number: existingOrder?.number || createOrderNumber(),
        customerId,
        customOrderId: request.id,
        email: request.email,
        name: request.name,
        phone: request.whatsapp,
        address: checkout.address,
        city: checkout.city,
        pin: checkout.pin,
        note: [request.idea, request.details && `Details: ${request.details}`, checkout.note]
          .filter(Boolean).join("\n"),
        items: [{
          productId: `custom-${request.id}`,
          name: "Custom crochet order",
          qty: 1,
          unitPrice: total,
          variant: request.idea.slice(0, 160),
          customDescription: [request.idea, request.details && `Details: ${request.details}`]
            .filter(Boolean).join("\n")
        }],
        subtotal: total,
        shipping: 0,
        discount: 0,
        total,
        payment: "UPI"
      };
      const paymentOrder = await createPaymentOrder(order);
      const saved = await client.query(
        `INSERT INTO orders (
          id, number, customer_id, customer_email, name, phone, address, city, pin, note, items,
          subtotal, shipping, discount, total, payment_method, payment_status, razorpay_order_id, custom_order_id
        ) VALUES ($1, $2, $3, LOWER(BTRIM($4)), $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 'Pending', $17, $18)
        ON CONFLICT (custom_order_id) DO UPDATE SET
          customer_id = EXCLUDED.customer_id, name = EXCLUDED.name, phone = EXCLUDED.phone,
          address = EXCLUDED.address, city = EXCLUDED.city, pin = EXCLUDED.pin, note = EXCLUDED.note,
          items = EXCLUDED.items, subtotal = EXCLUDED.subtotal, shipping = EXCLUDED.shipping,
          discount = EXCLUDED.discount, total = EXCLUDED.total, payment_method = EXCLUDED.payment_method,
          payment_status = 'Pending', razorpay_order_id = EXCLUDED.razorpay_order_id,
          updated_at = NOW()
        WHERE orders.payment_status <> 'Paid'
        RETURNING *`,
        [
          randomUUID(), order.number, customerId, order.email, order.name, order.phone, order.address,
          order.city, order.pin, order.note, JSON.stringify(order.items), order.subtotal, order.shipping,
          order.discount, order.total, order.payment, paymentOrder.orderId, request.id
        ]
      );
      if (!saved.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      if (!existingOrder) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), saved.rows[0].id, "Order Placed", "Custom order awaiting payment."]
        );
      }
      await client.query("COMMIT");
      return { paymentOrder, order: safeOrder(saved.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function isCustomPaymentOrderCurrent(number, razorpayOrderId, paymentId) {
    const result = await database.query(
      `SELECT 1 FROM orders
       WHERE number = $1 AND custom_order_id IS NOT NULL AND razorpay_order_id = $2
         AND (payment_status <> 'Paid' OR payment_reference = $3)`,
      [number, razorpayOrderId, paymentId]
    );
    return result.rows.length > 0;
  }

  async function updatePayment(number, paymentStatus, paymentReference, razorpayOrderId = null) {
    const result = await database.query(
      `UPDATE orders SET payment_status = $1, payment_reference = $2,
       order_status = CASE WHEN $1 = 'Paid' AND order_status = 'Order Placed' THEN 'Order Confirmed' ELSE order_status END,
       updated_at = NOW() WHERE number = $3
         AND (custom_order_id IS NULL OR $4::text IS NULL OR razorpay_order_id = $4)
         AND payment_status NOT IN ('Paid', 'Refund required (manual)') RETURNING *`,
      [paymentStatus, paymentReference, number, razorpayOrderId]
    );
    if (result.rows[0]?.custom_order_id && paymentStatus === "Paid") {
      await database.query(
        `UPDATE custom_order_requests SET status = 'paid', quote_token_hash = NULL,
         quote_expires_at = NULL, updated_at = NOW() WHERE id = $1`,
        [result.rows[0].custom_order_id]
      );
    }
    if (result.rows[0] && paymentStatus === "Paid") {
      const eventStatus = result.rows[0].order_status === "Order Confirmed" ? "Order Confirmed" : "Payment Captured";
      await database.query(
        "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
        [randomUUID(), result.rows[0].id, eventStatus, "Payment captured and verified."]
      );
    }
    if (result.rows[0]) return safeOrder(result.rows[0]);
    const existing = await database.query("SELECT * FROM orders WHERE number = $1", [number]);
    return existing.rows[0] ? safeOrder(existing.rows[0]) : null;
  }

  async function listCustomerOrders(customerId, email = null) {
    const result = await database.query(
      `SELECT * FROM orders
       WHERE (customer_id = $1
          OR ($2::text IS NOT NULL AND LOWER(BTRIM(customer_email)) = $2))
         AND (custom_order_id IS NULL OR payment_status = 'Paid')
       ORDER BY created_at DESC`,
      [customerId, normalizeEmail(email) || null]
    );
    return result.rows.map(safeOrder);
  }

  async function listCustomerOrdersByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const result = await database.query(
      `SELECT * FROM orders WHERE LOWER(BTRIM(customer_email)) = $1
       AND (custom_order_id IS NULL OR payment_status = 'Paid') ORDER BY created_at DESC`,
      [normalizedEmail]
    );
    return result.rows.map(safeOrder);
  }

  async function listOrdersForSession(session) {
    if (session?.customer_id) return listCustomerOrders(session.customer_id, session.customer_email);
    if (session?.customer_email) return listCustomerOrdersByEmail(session.customer_email);
    return [];
  }

  async function getCustomerOrder(customerId, id, email = null) {
    const result = await database.query(
      `SELECT o.*, COALESCE(json_agg(json_build_object(
        'status', e.status, 'note', e.note, 'createdAt', e.created_at
      ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS events
       FROM orders o LEFT JOIN order_status_events e ON e.order_id = o.id
       WHERE o.id = $1
         AND (o.customer_id = $2
           OR ($3::text IS NOT NULL AND LOWER(BTRIM(o.customer_email)) = $3))
         AND (o.custom_order_id IS NULL OR o.payment_status = 'Paid')
       GROUP BY o.id`,
      [id, customerId, normalizeEmail(email) || null]
    );
    return result.rows[0] ? safeOrder(result.rows[0]) : null;
  }

  async function getCustomerOrderByEmail(email, id) {
    const normalizedEmail = normalizeEmail(email);
    const result = await database.query(
      `SELECT o.*, COALESCE(json_agg(json_build_object(
        'status', e.status, 'note', e.note, 'createdAt', e.created_at
      ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS events
       FROM orders o LEFT JOIN order_status_events e ON e.order_id = o.id
       WHERE o.id = $1 AND LOWER(BTRIM(o.customer_email)) = $2
         AND (o.custom_order_id IS NULL OR o.payment_status = 'Paid') GROUP BY o.id`,
      [id, normalizedEmail]
    );
    return result.rows[0] ? safeOrder(result.rows[0]) : null;
  }

  async function getOrderForSession(session, id) {
    if (session?.customer_id) return getCustomerOrder(session.customer_id, id, session.customer_email);
    if (session?.customer_email) return getCustomerOrderByEmail(session.customer_email, id);
    return null;
  }

  async function requestCancellation(customerId, id, note, email = null) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query(
        `SELECT id, order_status, cancellation_requested FROM orders
         WHERE id = $1 AND (customer_id = $2
           OR ($3::text IS NOT NULL AND LOWER(BTRIM(customer_email)) = $3))
         FOR UPDATE`,
        [id, customerId, normalizeEmail(email) || null]
      );
      if (!order.rows[0] || terminalStatuses.has(order.rows[0].order_status) || order.rows[0].cancellation_requested) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "UPDATE orders SET cancellation_requested = TRUE, cancellation_request_status = 'Pending', updated_at = NOW() WHERE id = $1",
        [id]
      );
      await client.query(
        "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
        [randomUUID(), id, "Cancellation Requested", note || "Customer requested cancellation."]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function requestCancellationByEmail(email, id, note) {
    const normalizedEmail = normalizeEmail(email);
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "SELECT id, order_status, cancellation_requested FROM orders WHERE id = $1 AND LOWER(BTRIM(customer_email)) = $2 FOR UPDATE",
        [id, normalizedEmail]
      );
      if (!order.rows[0] || terminalStatuses.has(order.rows[0].order_status) || order.rows[0].cancellation_requested) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(
        "UPDATE orders SET cancellation_requested = TRUE, cancellation_request_status = 'Pending', updated_at = NOW() WHERE id = $1",
        [id]
      );
      await client.query(
        "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
        [randomUUID(), id, "Cancellation Requested", note || "Customer requested cancellation."]
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function requestCancellationForSession(session, id, note) {
    if (session?.customer_id) return requestCancellation(session.customer_id, id, note, session.customer_email);
    if (session?.customer_email) return requestCancellationByEmail(session.customer_email, id, note);
    return false;
  }

  async function findEligibleDeliveredOrder(queryable, session, orderId, productId, lock = false) {
    if ((!session?.customer_id && !session?.customer_email) || !orderId || !productId) return null;
    const result = await queryable.query(
      `SELECT id, customer_id, customer_email, name, number, items
       FROM orders
       WHERE id = $1 AND order_status = 'Delivered' AND payment_status = 'Paid'
         AND (($2::uuid IS NOT NULL AND customer_id = $2)
           OR ($3::text IS NOT NULL AND LOWER(BTRIM(customer_email)) = $3))
       ${lock ? "FOR SHARE" : ""}`,
      [orderId, session.customer_id || null, normalizeEmail(session.customer_email) || null]
    );
    const order = result.rows[0];
    const hasProduct = Array.isArray(order?.items) && order.items.some(
      (item) => String(item?.id ?? item?.productId ?? "") === String(productId)
    );
    return hasProduct ? {
      orderId: order.id,
      customerId: order.customer_id,
      customerEmail: normalizeEmail(order.customer_email),
      customerName: order.name || null,
      orderNumber: order.number || ""
    } : null;
  }

  async function getEligibleDeliveredOrderForProduct(session, orderId, productId) {
    return findEligibleDeliveredOrder(database, session, orderId, productId);
  }

  async function getProductReviewSummary(productId) {
    const [summaryResult, featuredResult] = await Promise.all([
      database.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
          ROUND(AVG(rating) FILTER (WHERE status = 'approved'), 1)::float AS average_rating,
          COUNT(*) FILTER (WHERE status = 'approved' AND rating = 1)::int AS rating_1,
          COUNT(*) FILTER (WHERE status = 'approved' AND rating = 2)::int AS rating_2,
          COUNT(*) FILTER (WHERE status = 'approved' AND rating = 3)::int AS rating_3,
          COUNT(*) FILTER (WHERE status = 'approved' AND rating = 4)::int AS rating_4,
          COUNT(*) FILTER (WHERE status = 'approved' AND rating = 5)::int AS rating_5
         FROM product_reviews WHERE product_id = $1`,
        [productId]
      ),
      database.query(
        `SELECT pr.id, pr.rating, pr.review_title, pr.review_text, pr.created_at, pr.approved_at,
          o.name AS order_customer_name,
          COALESCE(json_agg(json_build_object(
          'id', prp.id,
          'url', CASE WHEN prp.storage_reference LIKE '/uploads/reviews/%'
            THEN prp.storage_reference ELSE '/api/review-photos/' || prp.id::text END,
          'altText', prp.alt_text,
          'sortOrder', prp.sort_order
        ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos
         FROM product_reviews pr
         LEFT JOIN product_review_photos prp ON prp.review_id = pr.id
         INNER JOIN orders o ON o.id = pr.order_id
         WHERE pr.product_id = $1 AND pr.status = 'approved' AND pr.is_featured = TRUE
         GROUP BY pr.id, o.name
         ORDER BY pr.updated_at DESC
         LIMIT 2`,
        [productId]
      )
    ]);

    const summary = summaryResult.rows[0] || {};
    const approvedCount = Number(summary.approved_count || 0);
    const averageRating = Number(summary.average_rating || 0);

    return {
      summary: {
        totalReviews: approvedCount,
        averageRating: approvedCount ? Number(averageRating.toFixed(1)) : 0,
        ratingDistribution: [1, 2, 3, 4, 5].map((rating) => ({
          rating,
          count: Number(summary[`rating_${rating}`] || 0)
        }))
      },
      featuredReviews: featuredResult.rows.map((row) => ({
        id: row.id,
        customerName: String(row.order_customer_name || "").trim() || "Verified customer",
        rating: Number(row.rating),
        reviewTitle: row.review_title || "",
        reviewText: row.review_text,
        createdAt: row.created_at,
        photos: Array.isArray(row.photos) ? row.photos : []
      }))
    };
  }

  async function listApprovedProductReviews(productId, limit = 6, offset = 0) {
    const result = await database.query(
      `SELECT pr.id, pr.rating, pr.review_title, pr.review_text, pr.created_at,
        o.name AS order_customer_name,
        COALESCE(json_agg(json_build_object(
          'id', prp.id,
          'url', CASE WHEN prp.storage_reference LIKE '/uploads/reviews/%'
            THEN prp.storage_reference ELSE '/api/review-photos/' || prp.id::text END,
          'altText', prp.alt_text,
          'sortOrder', prp.sort_order
        ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos
       FROM product_reviews pr
       JOIN orders o ON o.id = pr.order_id
       LEFT JOIN product_review_photos prp ON prp.review_id = pr.id
       WHERE pr.product_id = $1 AND pr.status = 'approved'
       GROUP BY pr.id, o.name
       ORDER BY pr.approved_at DESC NULLS LAST, pr.created_at DESC
       LIMIT $2 OFFSET $3`,
      [productId, limit, offset]
    );
    return result.rows.map((row) => ({
      id: row.id,
      customerName: String(row.order_customer_name || "").trim() || "Verified customer",
      rating: Number(row.rating),
      reviewTitle: row.review_title || "",
      reviewText: row.review_text,
      createdAt: row.created_at,
      photos: Array.isArray(row.photos) ? row.photos : []
    }));
  }

  async function listOrderReviews(session, orderId) {
    const result = await database.query(
      `SELECT pr.id, pr.product_id, pr.status, pr.rating, pr.review_title, pr.review_text FROM product_reviews pr
       JOIN orders o ON o.id = pr.order_id
       WHERE o.id = $1
         AND (($2::uuid IS NOT NULL AND o.customer_id = $2)
           OR ($3::text IS NOT NULL AND LOWER(BTRIM(o.customer_email)) = $3))`,
      [orderId, session?.customer_id || null, normalizeEmail(session?.customer_email) || null]
    );
    return result.rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      status: row.status,
      rating: Number(row.rating),
      reviewTitle: row.review_title || "",
      reviewText: row.review_text || ""
    }));
  }

  async function submitProductReview({ productId, session, reviewTitle, reviewText, rating, orderId, photos = [] }) {
    const normalizedProductId = String(productId || "").trim();
    const normalizedTitle = String(reviewTitle || "").trim();
    const normalizedReview = String(reviewText || "").trim();
    const safeRating = Number(rating);
    if (!normalizedProductId) throw new Error("Choose a product to review.");
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) throw new Error("Choose a rating between 1 and 5 stars.");
    if (normalizedTitle.length > 120 || normalizedReview.length > 1000) throw new Error("Keep your review title under 120 characters and review under 1,000 characters.");
    const reviewId = randomUUID();
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const order = await findEligibleDeliveredOrder(client, session, orderId, normalizedProductId, true);
      if (!order) {
        const error = new Error("Only customers with a paid, delivered order for this product can leave a review.");
        error.status = 403;
        throw error;
      }
      const result = await client.query(
        `INSERT INTO product_reviews
          (id, product_id, customer_id, customer_email, order_id, customer_name, rating, review_title, review_text, status, is_featured)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', FALSE)
         ON CONFLICT DO NOTHING RETURNING *`,
        [
          reviewId, normalizedProductId, session?.customer_id || null, order.customerEmail,
          order.orderId, order.customerName || "Verified customer", safeRating, normalizedTitle, normalizedReview
        ]
      );
      const review = result.rows[0];
      if (!review) {
        const error = new Error("You have already reviewed this product from that purchase.");
        error.status = 409;
        throw error;
      }
      for (const [index, photo] of photos.entries()) {
        const storageReference = photo.storageReference || photo.url || "";
        if (!storageReference) continue;
        await client.query(
          `INSERT INTO product_review_photos (id, review_id, storage_reference, alt_text, sort_order)
           VALUES ($1, $2, $3, $4, $5)`,
          [photo.id || randomUUID(), review.id, storageReference, photo.altText || `Customer review photo ${index + 1}`, index]
        );
      }
      await client.query("COMMIT");
      return safeReview(review);
    } catch (error) {
      await client.query("ROLLBACK");
      if (error.code === "23505") {
        const duplicateError = new Error("You have already reviewed this product from that purchase.");
        duplicateError.status = 409;
        throw duplicateError;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async function listAdminReviews(status = null) {
    const clauses = status ? "WHERE pr.status = $1" : "WHERE pr.status IN ('pending', 'approved', 'rejected', 'hidden')";
    const params = status ? [status] : [];
    const result = await database.query(
      `SELECT pr.*, o.number AS order_number, o.name AS order_customer_name,
       (SELECT COALESCE(json_agg(json_build_object(
          'actor', actor,
          'action', action,
          'previousStatus', previous_status,
          'nextStatus', next_status,
          'note', note,
          'createdAt', created_at
        ) ORDER BY created_at DESC), '[]'::json)
        FROM product_review_moderation_events WHERE review_id = pr.id) AS moderation_history,
       COALESCE(json_agg(json_build_object(
        'id', prp.id,
        'url', CASE WHEN prp.storage_reference LIKE '/uploads/reviews/%'
          THEN prp.storage_reference ELSE '/api/review-photos/' || prp.id::text END,
        'altText', prp.alt_text,
        'sortOrder', prp.sort_order
      ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos
       FROM product_reviews pr
       LEFT JOIN orders o ON o.id = pr.order_id
       LEFT JOIN product_review_photos prp ON prp.review_id = pr.id
       ${clauses}
       GROUP BY pr.id, o.number, o.name
       ORDER BY pr.created_at DESC`,
      params
    );
    return result.rows.map((row) => safeReview(row));
  }

  async function updateReviewModeration(reviewId, { status, adminNote, isFeatured }) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT * FROM product_reviews WHERE id = $1 FOR UPDATE", [reviewId]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const row = current.rows[0];
      const nextStatus = status || row.status;
      const nextFeatured = nextStatus === "approved"
        && (typeof isFeatured === "boolean" ? isFeatured : row.is_featured);
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [row.product_id]);
      if (nextStatus === "rejected") {
        await client.query(
          "UPDATE product_reviews SET status = 'rejected', admin_note = $1, is_featured = FALSE, updated_at = NOW() WHERE id = $2",
          [String(adminNote || row.admin_note || ""), reviewId]
        );
      } else if (nextStatus === "approved") {
        const featuredCount = await client.query(
          "SELECT COUNT(*)::int AS count FROM product_reviews WHERE product_id = $1 AND status = 'approved' AND is_featured = TRUE AND id <> $2",
          [row.product_id, reviewId]
        );
        if (nextFeatured && featuredCount.rows[0].count >= 2) {
          const error = new Error("Only two featured reviews can be active for a product at once.");
          error.status = 409;
          throw error;
        }
        await client.query(
          "UPDATE product_reviews SET status = 'approved', admin_note = $1, is_featured = $2, approved_at = COALESCE(approved_at, NOW()), updated_at = NOW() WHERE id = $3",
          [String(adminNote || row.admin_note || ""), nextFeatured, reviewId]
        );
      } else {
        await client.query(
          "UPDATE product_reviews SET status = $1, admin_note = $2, is_featured = FALSE, updated_at = NOW() WHERE id = $3",
          [nextStatus, String(adminNote || row.admin_note || ""), reviewId]
        );
      }
      if (nextStatus !== row.status) {
        const action = nextStatus === "approved" && row.status === "hidden" ? "restored" : nextStatus;
        await client.query(
          `INSERT INTO product_review_moderation_events
            (id, review_id, action, previous_status, next_status, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), reviewId, action, row.status, nextStatus, String(adminNote || "")]
        );
      }
      if (nextFeatured !== Boolean(row.is_featured)) {
        await client.query(
          `INSERT INTO product_review_moderation_events
            (id, review_id, action, previous_status, next_status, note)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [randomUUID(), reviewId, nextFeatured ? "featured" : "unfeatured", row.status, nextStatus, String(adminNote || "")]
        );
      }
      await client.query("COMMIT");
      return await getReviewById(reviewId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function deleteProductReview(reviewId, note = "") {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query(
        "SELECT status FROM product_reviews WHERE id = $1 FOR UPDATE",
        [reviewId]
      );
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const selected = await client.query(
        `SELECT COALESCE(array_agg(storage_reference), '{}') AS photo_references
         FROM product_review_photos WHERE review_id = $1`,
        [reviewId]
      );
      await client.query(
        `INSERT INTO product_review_moderation_events
          (id, review_id, action, previous_status, next_status, note)
         VALUES ($1, $2, 'deleted', $3, NULL, $4)`,
        [randomUUID(), reviewId, current.rows[0].status, String(note || "")]
      );
      await client.query("DELETE FROM product_reviews WHERE id = $1", [reviewId]);
      await client.query("COMMIT");
      return { photoReferences: selected.rows[0].photo_references || [] };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getReviewPhoto(photoId) {
    const result = await database.query(
      `SELECT pr.status, prp.storage_reference
       FROM product_review_photos prp
       JOIN product_reviews pr ON pr.id = prp.review_id
       WHERE prp.id = $1`,
      [photoId]
    );
    return result.rows[0] || null;
  }

  async function getReviewPhotoByReference(storageReference) {
    const result = await database.query(
      `SELECT pr.status, prp.storage_reference
       FROM product_review_photos prp
       JOIN product_reviews pr ON pr.id = prp.review_id
       WHERE prp.storage_reference = $1`,
      [storageReference]
    );
    return result.rows[0] || null;
  }

  async function getReviewById(reviewId) {
    const result = await database.query(
      `SELECT pr.*, COALESCE(json_agg(json_build_object(
        'id', prp.id,
        'url', CASE WHEN prp.storage_reference LIKE '/uploads/reviews/%'
          THEN prp.storage_reference ELSE '/api/review-photos/' || prp.id::text END,
        'altText', prp.alt_text,
        'sortOrder', prp.sort_order
      ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos,
      (SELECT COALESCE(json_agg(json_build_object(
        'actor', actor,
        'action', action,
        'previousStatus', previous_status,
        'nextStatus', next_status,
        'note', note,
        'createdAt', created_at
      ) ORDER BY created_at DESC), '[]'::json)
       FROM product_review_moderation_events WHERE review_id = pr.id) AS moderation_history
       FROM product_reviews pr
       LEFT JOIN product_review_photos prp ON prp.review_id = pr.id
       WHERE pr.id = $1
       GROUP BY pr.id`,
      [reviewId]
    );
    return result.rows[0] ? safeReview(result.rows[0]) : null;
  }

  async function listAdminOrders() {
    const result = await database.query("SELECT * FROM orders ORDER BY created_at DESC LIMIT 500");
    return result.rows.map(safeAdminOrder);
  }

  async function getAdminOrder(id) {
    const result = await database.query("SELECT * FROM orders WHERE id = $1", [id]);
    return result.rows[0] ? safeAdminOrder(result.rows[0]) : null;
  }

  async function createNimbusPostOrder(id, createOrder) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      if (result.rows[0].nimbuspost_order_id) {
        await client.query("COMMIT");
        return result.rows[0].nimbuspost_order_id;
      }
      const nimbuspostOrderId = await createOrder(safeOrder(result.rows[0]));
      await client.query(
        "UPDATE orders SET nimbuspost_order_id = $1, updated_at = NOW() WHERE id = $2",
        [nimbuspostOrderId, id]
      );
      await client.query("COMMIT");
      return nimbuspostOrderId;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function bookNimbusPostOrder(id, ensureBooked) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
      if (!result.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const current = result.rows[0];
      if (current.nimbuspost_awb) {
        await client.query("COMMIT");
        return safeAdminOrder(current);
      }
      if (!current.nimbuspost_order_id) {
        await client.query("ROLLBACK");
        throw new Error("Create the NimbusPost order before booking its courier.");
      }
      const shipment = await ensureBooked(current.nimbuspost_order_id);
      const saved = await client.query(
        `UPDATE orders SET delivery_method = 'NimbusPost', courier_name = $1, tracking_id = $2,
          tracking_url = $3, courier_status = $4, nimbuspost_awb = $2, nimbuspost_label_url = $5,
          updated_at = NOW() WHERE id = $6 RETURNING *`,
        [
          shipment.courierName || "NimbusPost",
          shipment.awb,
          shipment.trackingUrl || null,
          shipment.status || "booked",
          shipment.labelUrl || null,
          id
        ]
      );
      await client.query(
        "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
        [randomUUID(), id, "NimbusPost shipment booked", `${shipment.courierName || "Courier"} · AWB ${shipment.awb}`]
      );
      await client.query("COMMIT");
      return safeAdminOrder(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function updateAdminOrder(id, update) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const current = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [id]);
      if (!current.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      const old = current.rows[0];
      const nextStatus = update.cancellationDecision === "approve" ? "Cancelled" : (update.status || old.order_status);
      if (update.status && !orderStatuses.has(update.status)) throw new Error("Choose a valid order status.");
      if (old.nimbuspost_awb && nextStatus === "Cancelled" && old.order_status !== "Cancelled") {
        const error = new Error("Cancel the shipment in NimbusPost before cancelling this order.");
        error.code = "NIMBUSPOST_CANCELLATION_REQUIRED";
        throw error;
      }
      const cancellationStatus = update.cancellationDecision
        ? (update.cancellationDecision === "approve" ? "Approved" : "Rejected")
        : old.cancellation_request_status;
      const nextPaymentStatus = nextStatus === "Cancelled" && old.payment_status === "Paid"
        ? "Refund required (manual)"
        : update.paymentStatus || old.payment_status;
      const saved = await client.query(
        `UPDATE orders SET order_status = $1, delivery_method = $2, courier_name = $3,
          tracking_id = $4, tracking_url = $5, courier_status = $6, estimated_delivery = $7,
          cancellation_requested = CASE WHEN $8::text IS NULL THEN cancellation_requested ELSE FALSE END,
          cancellation_request_status = $9, payment_status = $10, updated_at = NOW()
         WHERE id = $11 RETURNING *`,
        [
          nextStatus,
          update.deliveryMethod === undefined || old.nimbuspost_awb ? old.delivery_method : update.deliveryMethod,
          update.courierName === undefined || old.nimbuspost_awb ? old.courier_name : update.courierName,
          update.trackingId === undefined || old.nimbuspost_awb ? old.tracking_id : update.trackingId,
          update.trackingUrl === undefined || old.nimbuspost_awb ? old.tracking_url : update.trackingUrl,
          update.courierStatus === undefined ? old.courier_status : update.courierStatus,
          update.estimatedDelivery === undefined ? old.estimated_delivery : update.estimatedDelivery,
          update.cancellationDecision || null,
          cancellationStatus,
          nextPaymentStatus,
          id
        ]
      );
      if (nextStatus !== old.order_status || update.statusNote) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, nextStatus, update.statusNote || ""]
        );
      }
      if (nextPaymentStatus !== old.payment_status) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, `Payment ${nextPaymentStatus}`, update.statusNote || ""]
        );
      }
      if (update.deliveryMethod && update.deliveryMethod !== old.delivery_method) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, `Delivery method: ${update.deliveryMethod}`, update.courierName || ""]
        );
      }
      if (update.courierName && update.courierName !== old.courier_name &&
        !(update.deliveryMethod && update.deliveryMethod !== old.delivery_method)) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, `Courier assigned: ${update.courierName}`, update.trackingId || ""]
        );
      }
      if (update.trackingId && update.trackingId !== old.tracking_id &&
        update.courierStatus === undefined && update.courierName === undefined) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, "Shipment tracking added", update.trackingId]
        );
      }
      if (update.courierStatus && update.courierStatus !== old.courier_status) {
        const courier = update.courierName || old.courier_name || "Courier";
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, `Shipment update: ${update.courierStatus}`, `${courier}${update.trackingId ? ` · Tracking ID ${update.trackingId}` : ""}`]
        );
      }
      if (update.cancellationDecision) {
        await client.query(
          "INSERT INTO order_status_events (id, order_id, status, note) VALUES ($1, $2, $3, $4)",
          [randomUUID(), id, `Cancellation ${cancellationStatus}`, update.statusNote || ""]
        );
      }
      await client.query("COMMIT");
      return safeOrder(saved.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    createSession,
    resolveSession,
    register,
    login,
    adminLogin,
    requestEmailOtp,
    verifyEmailOtp,
    checkEmailOtpRateLimit,
    logout,
    requestPasswordReset,
    resetPassword,
    getProfile,
    updateProfile,
    changePassword,
    saveAddress,
    deleteAddress,
    saveOrder,
    startCustomOrderPayment,
    isCustomPaymentOrderCurrent,
    updatePayment,
    listCustomerOrders,
    listCustomerOrdersByEmail,
    listOrdersForSession,
    getCustomerOrder,
    getCustomerOrderByEmail,
    getOrderForSession,
    requestCancellation,
    requestCancellationByEmail,
    requestCancellationForSession,
    getEligibleDeliveredOrderForProduct,
    getProductReviewSummary,
    listApprovedProductReviews,
    listOrderReviews,
    submitProductReview,
    listAdminReviews,
    updateReviewModeration,
    deleteProductReview,
    getReviewPhoto,
    getReviewPhotoByReference,
    listAdminOrders,
    updateAdminOrder,
    getAdminOrder,
    createNimbusPostOrder,
    bookNimbusPostOrder
  };
}
