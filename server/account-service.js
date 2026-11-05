import { createHash, createHmac, randomBytes, randomInt, randomUUID, scrypt as callbackScrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(callbackScrypt);
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1000;
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
    reviewText: row.review_text,
    status: row.status,
    isFeatured: Boolean(row.is_featured),
    adminNote: row.admin_note || "",
    approvedAt: row.approved_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    photos: Array.isArray(row.photos) ? row.photos : []
  };
}

function normalizeEmail(value) {
  return String(value ?? "").trim().toLowerCase();
}

function hashOtpCode(code, secret) {
  return createHmac("sha256", secret).update(String(code)).digest("hex");
}

export function createAccountService({ database, emailService, environment }) {
  const otpSecret = String(environment.OTP_SECRET || "");

  async function createSession(customerId, role = "customer", customerEmail = null) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    const normalizedEmail = customerEmail ? normalizeEmail(customerEmail) : null;
    await database.query(
      "INSERT INTO customer_sessions (token_hash, customer_id, role, expires_at, customer_email) VALUES ($1, $2, $3, $4, $5)",
      [hashToken(token), customerId, role, expiresAt, normalizedEmail]
    );
    return { token, expiresAt };
  }

  async function resolveSession(token) {
    if (!token) return null;
    const result = await database.query(
      `SELECT s.role, s.customer_id, s.customer_email, s.expires_at, c.name, c.email
       FROM customer_sessions s
       LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashToken(token)]
    );
    const session = result.rows[0];
    if (!session) return null;
    return {
      ...session,
      email: session.customer_email || session.email || null,
      customer_email: session.customer_email || session.email || null
    };
  }

  async function register({ name, email, phone, password }) {
    const passwordHash = await hashPassword(password);
    const id = randomUUID();
    const result = await database.query(
      `INSERT INTO customers (id, name, email, phone, password_hash)
       VALUES ($1, $2, LOWER($3), $4, $5)
       RETURNING id, name, email, phone`,
      [id, name, email, phone, passwordHash]
    );
    const session = await createSession(id, "customer", result.rows[0].email);
    return { customer: result.rows[0], session };
  }

  async function login(email, password) {
    const result = await database.query(
      "SELECT id, name, email, phone, password_hash FROM customers WHERE email = LOWER($1)",
      [email]
    );
    const customer = result.rows[0];
    if (!customer) {
      await verifyPassword(password, dummyPasswordHash);
      return null;
    }
    if (!await verifyPassword(password, customer.password_hash)) return null;
    const session = await createSession(customer.id, "customer", customer.email);
    return {
      customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone },
      session
    };
  }

  async function adminLogin(email, password) {
    const configuredEmail = String(environment.ADMIN_EMAIL || "").trim().toLowerCase();
    const configuredPassword = environment.ADMIN_PASSWORD || "";
    if (!configuredEmail || configuredPassword.length < 16) return null;
    const suppliedEmail = Buffer.from(String(email || "").trim().toLowerCase());
    const expectedEmail = Buffer.from(configuredEmail);
    const suppliedPassword = createHash("sha256").update(String(password || "")).digest();
    const expectedPassword = createHash("sha256").update(configuredPassword).digest();
    const emailMatches = suppliedEmail.length === expectedEmail.length && timingSafeEqual(suppliedEmail, expectedEmail);
    const passwordMatches = timingSafeEqual(suppliedPassword, expectedPassword);
    if (!emailMatches || !passwordMatches) return null;
    return { session: await createSession(null, "admin") };
  }

  async function requestEmailOtp(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new Error("Enter a valid email address.");
    }
    if (otpSecret.length < 32) {
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

  async function verifyEmailOtp(email, otp) {
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
    const session = await createSession(null, "customer", normalizedEmail);
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

  async function logout(token) {
    if (token) await database.query("DELETE FROM customer_sessions WHERE token_hash = $1", [hashToken(token)]);
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
      database.query("SELECT order_status, COUNT(*)::int AS count FROM orders WHERE customer_id = $1 GROUP BY order_status", [customerId])
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

  async function updatePayment(number, paymentStatus, paymentReference) {
    const result = await database.query(
      `UPDATE orders SET payment_status = $1, payment_reference = $2,
       order_status = CASE WHEN $1 = 'Paid' AND order_status = 'Order Placed' THEN 'Order Confirmed' ELSE order_status END,
       updated_at = NOW() WHERE number = $3 AND payment_status NOT IN ('Paid', 'Refund required (manual)') RETURNING *`,
      [paymentStatus, paymentReference, number]
    );
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

  async function listCustomerOrders(customerId) {
    const result = await database.query(
      "SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC",
      [customerId]
    );
    return result.rows.map(safeOrder);
  }

  async function listCustomerOrdersByEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    const result = await database.query(
      "SELECT * FROM orders WHERE LOWER(BTRIM(customer_email)) = $1 ORDER BY created_at DESC",
      [normalizedEmail]
    );
    return result.rows.map(safeOrder);
  }

  async function listOrdersForSession(session) {
    if (session?.customer_id) return listCustomerOrders(session.customer_id);
    if (session?.customer_email) return listCustomerOrdersByEmail(session.customer_email);
    return [];
  }

  async function getCustomerOrder(customerId, id) {
    const result = await database.query(
      `SELECT o.*, COALESCE(json_agg(json_build_object(
        'status', e.status, 'note', e.note, 'createdAt', e.created_at
      ) ORDER BY e.created_at) FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS events
       FROM orders o LEFT JOIN order_status_events e ON e.order_id = o.id
       WHERE o.id = $1 AND o.customer_id = $2 GROUP BY o.id`,
      [id, customerId]
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
       WHERE o.id = $1 AND LOWER(BTRIM(o.customer_email)) = $2 GROUP BY o.id`,
      [id, normalizedEmail]
    );
    return result.rows[0] ? safeOrder(result.rows[0]) : null;
  }

  async function getOrderForSession(session, id) {
    if (session?.customer_id) return getCustomerOrder(session.customer_id, id);
    if (session?.customer_email) return getCustomerOrderByEmail(session.customer_email, id);
    return null;
  }

  async function requestCancellation(customerId, id, note) {
    const client = await database.connect();
    try {
      await client.query("BEGIN");
      const order = await client.query(
        "SELECT id, order_status, cancellation_requested FROM orders WHERE id = $1 AND customer_id = $2 FOR UPDATE",
        [id, customerId]
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
    if (session?.customer_id) return requestCancellation(session.customer_id, id, note);
    if (session?.customer_email) return requestCancellationByEmail(session.customer_email, id, note);
    return false;
  }

  async function getEligibleDeliveredOrderForProduct(customerId, orderId, productId) {
    if (!customerId || !orderId || !productId) return null;
    const result = await database.query(
      "SELECT id, customer_id, name, items FROM orders WHERE id = $1 AND customer_id = $2 AND order_status = 'Delivered'",
      [orderId, customerId]
    );
    const order = result.rows[0];
    const hasProduct = Array.isArray(order?.items) && order.items.some(
      (item) => String(item?.id ?? item?.productId ?? "") === String(productId)
    );
    return hasProduct ? { orderId: order.id, customerId: order.customer_id, customerName: order.name || null } : null;
  }

  async function getProductReviewSummary(productId) {
    const [summaryResult, featuredResult] = await Promise.all([
      database.query(
        `SELECT
          COUNT(*) FILTER (WHERE status = 'approved')::int AS approved_count,
          ROUND(AVG(rating) FILTER (WHERE status = 'approved'), 1)::float AS average_rating
         FROM product_reviews WHERE product_id = $1`,
        [productId]
      ),
      database.query(
        `SELECT pr.rating, pr.review_text, pr.created_at, pr.approved_at, o.name AS order_customer_name,
          COALESCE(json_agg(json_build_object(
          'id', prp.id,
          'url', prp.storage_reference,
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
        averageRating: approvedCount ? Number(averageRating.toFixed(1)) : 0
      },
      featuredReviews: featuredResult.rows.map((row) => ({
        customerName: String(row.order_customer_name || "").trim() || "Verified customer",
        rating: Number(row.rating),
        reviewText: row.review_text,
        createdAt: row.created_at,
        photos: Array.isArray(row.photos) ? row.photos : []
      }))
    };
  }

  async function listOrderReviews(customerId, orderId) {
    const result = await database.query(
      `SELECT pr.product_id, pr.status FROM product_reviews pr
       JOIN orders o ON o.id = pr.order_id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [orderId, customerId]
    );
    return result.rows.map((row) => ({ productId: row.product_id, status: row.status }));
  }

  async function submitProductReview({ productId, customerId, reviewText, rating, orderId, photos = [] }) {
    const normalizedProductId = String(productId || "").trim();
    const normalizedReview = String(reviewText || "").trim();
    const safeRating = Number(rating);
    if (!normalizedProductId) throw new Error("Choose a product to review.");
    if (!Number.isInteger(safeRating) || safeRating < 1 || safeRating > 5) throw new Error("Choose a rating between 1 and 5 stars.");
    if (normalizedReview.length < 8 || normalizedReview.length > 1000) throw new Error("Write a review between 8 and 1,000 characters.");
    const order = await getEligibleDeliveredOrderForProduct(customerId, orderId, normalizedProductId);
    if (!order) {
      const error = new Error("Only customers with a delivered order for this product can leave a review.");
      error.status = 403;
      throw error;
    }

    const reviewId = randomUUID();
    const result = await database.query(
      `INSERT INTO product_reviews (id, product_id, customer_id, order_id, customer_name, rating, review_text, status, is_featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', FALSE)
       ON CONFLICT (product_id, customer_id, order_id) DO NOTHING
       RETURNING *`,
      [reviewId, normalizedProductId, customerId, order.orderId, order.customerName || "Verified customer", safeRating, normalizedReview]
    );
    const review = result.rows[0];
    if (!review) {
      const error = new Error("You have already reviewed this product from that purchase.");
      error.status = 409;
      throw error;
    }
    for (const [index, photo] of (photos || []).entries()) {
      const storageReference = photo.url || photo.storageReference || "";
      if (!storageReference) continue;
      await database.query(
        `INSERT INTO product_review_photos (id, review_id, storage_reference, alt_text, sort_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), review.id, storageReference, photo.altText || `Customer review photo ${index + 1}`, index]
      );
    }
    return safeReview(review);
  }

  async function listAdminReviews(status = null) {
    const clauses = status ? "WHERE pr.status = $1" : "WHERE pr.status IN ('pending', 'approved', 'rejected')";
    const params = status ? [status] : [];
    const result = await database.query(
      `SELECT pr.*, COALESCE(json_agg(json_build_object(
        'id', prp.id,
        'url', prp.storage_reference,
        'altText', prp.alt_text,
        'sortOrder', prp.sort_order
      ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos
       FROM product_reviews pr
       LEFT JOIN product_review_photos prp ON prp.review_id = pr.id
       ${clauses}
       GROUP BY pr.id
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
      const nextFeatured = typeof isFeatured === "boolean" ? isFeatured : row.is_featured;
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
          await client.query("ROLLBACK");
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
      await client.query("COMMIT");
      return await getReviewById(reviewId);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async function getReviewById(reviewId) {
    const result = await database.query(
      `SELECT pr.*, COALESCE(json_agg(json_build_object(
        'id', prp.id,
        'url', prp.storage_reference,
        'altText', prp.alt_text,
        'sortOrder', prp.sort_order
      ) ORDER BY prp.sort_order, prp.created_at) FILTER (WHERE prp.id IS NOT NULL), '[]'::json) AS photos
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
    listOrderReviews,
    submitProductReview,
    listAdminReviews,
    updateReviewModeration,
    listAdminOrders,
    updateAdminOrder,
    getAdminOrder,
    createNimbusPostOrder,
    bookNimbusPostOrder
  };
}
