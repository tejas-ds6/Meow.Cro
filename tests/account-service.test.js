import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAccountService } from "../server/account-service.js";

function createMemoryDatabase() {
  const customers = new Map();
  const sessions = new Map();
  return {
    customers,
    sessions,
    async query(sql, values = []) {
      if (sql.includes("INSERT INTO customers")) {
        const [id, name, email, phone, password_hash] = values;
        const customer = { id, name, email: email.toLowerCase(), phone, password_hash };
        customers.set(customer.email, customer);
        return { rows: [{ id, name, email: customer.email, phone }] };
      }
      if (sql.includes("SELECT id, name, email, phone, password_hash FROM customers")) {
        const customer = customers.get(String(values[0]).toLowerCase());
        return { rows: customer ? [customer] : [] };
      }
      if (sql.includes("INSERT INTO customer_sessions")) {
        const [token_hash, customer_id, role, expires_at] = values;
        sessions.set(token_hash, { token_hash, customer_id, role, expires_at });
        return { rows: [] };
      }
      if (sql.includes("FROM customer_sessions s")) {
        const session = sessions.get(values[0]);
        const customer = [...customers.values()].find((item) => item.id === session?.customer_id);
        return {
          rows: session
            ? [{ ...session, name: customer?.name || null, email: customer?.email || null }]
            : []
        };
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
      subtotal, shipping, total, payment_method, payment_status, razorpay_order_id
    ] = values;
    const now = new Date().toISOString();
    const order = {
      id, number, customer_id, customer_email: customer_email.toLowerCase(), name, phone, address, city, pin, note,
      items: JSON.parse(items), subtotal, shipping, discount: 0, total, payment_method, payment_status,
      payment_reference: null, razorpay_order_id, order_status: "Order Placed", created_at: now, updated_at: now,
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

function createReviewMemoryDatabase(order) {
  const reviews = [];
  const photos = [];
  return {
    reviews,
    photos,
    async query(sql) {
      throw new Error(`Unexpected direct review query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.includes("FROM orders WHERE id = $1 AND customer_id = $2")) {
            return {
              rows: order.id === values[0] && order.customer_id === values[1] && order.order_status === "Delivered"
                ? [order]
                : []
            };
          }
          if (sql.includes("SELECT id FROM product_reviews WHERE product_id = $1 AND order_id = $2")) {
            return { rows: reviews.filter((review) => review.product_id === values[0] && review.order_id === values[1]).map(({ id }) => ({ id })) };
          }
          if (sql.includes("INSERT INTO product_reviews")) {
            const [id, product_id, customer_id, order_id, customer_name, rating, review_text] = values;
            const review = {
              id, product_id, customer_id, order_id, customer_name, rating, review_text,
              status: "pending", is_featured: false, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
            };
            reviews.push(review);
            return { rows: [review] };
          }
          if (sql.includes("INSERT INTO product_review_photos")) {
            photos.push(values);
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction review query: ${sql}`);
        },
        release() {}
      };
    }
  };
}

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
  });
  const savedCustomer = database.customers.get("buyer@example.test");
  assert.match(savedCustomer.password_hash, /^scrypt\$/);
  assert.notEqual(savedCustomer.password_hash, "a-secure-customer-password");
  assert.ok(registered.session.expiresAt > new Date());
  assert.equal(database.sessions.size, 1);
  const [storedTokenHash] = [...database.sessions.entries()][0];
  assert.equal(storedTokenHash, createHash("sha256").update(registered.session.token).digest("hex"));
  assert.notEqual(storedTokenHash, registered.session.token);
  assert.equal((await service.resolveSession(registered.session.token)).role, "customer");
  assert.equal(await service.resolveSession("not-a-session-token"), null);
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
  });

  assert.equal(await service.login("buyer@example.test", "wrong-password"), null);
  const login = await service.login("buyer@example.test", "a-secure-customer-password");
  assert.equal(login.customer.email, "buyer@example.test");
  assert.equal(await service.adminLogin("buyer@example.test", "a-secure-customer-password"), null);
  assert.equal(await service.adminLogin("studio@example.test", "admin-pass-1234"), null);
  const admin = await service.adminLogin("studio@example.test", adminPassword);
  assert.equal((await service.resolveSession(admin.session.token)).role, "admin");
  assert.equal((await service.resolveSession(admin.session.token)).customer_id, null);
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
    email: "buyer@example.test",
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
  assert.equal(saved.email, order.email);
  assert.equal(saved.paymentMethod, "UPI");
  assert.equal(saved.paymentStatus, "Pending");
  assert.equal(saved.total, order.total);
  assert.deepEqual(saved.items, order.items);
  assert.equal(database.orders.get(order.number).razorpay_order_id, "order_test_123");
  assert.equal(database.events[0].status, "Order Placed");

  const paid = await service.updatePayment(order.number, "Paid", "pay_test_456");

  assert.equal(paid.paymentStatus, "Paid");
  assert.equal(paid.paymentReference, "pay_test_456");
  assert.equal(paid.status, "Order Confirmed");
  assert.equal(database.events[1].status, "Order Confirmed");
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

test("product reviews are tied to the exact delivered order and use its trusted name", async () => {
  const order = {
    id: "order-review-1",
    customer_id: "customer-1",
    order_status: "Delivered",
    name: "Trusted order name",
    items: [{ id: "flower-keychain", name: "Daisy flower", qty: 1 }]
  };
  const database = createReviewMemoryDatabase(order);
  const service = createAccountService({ database, emailService: {}, environment: {} });
  const review = await service.submitProductReview({
    productId: "flower-keychain",
    session: { customer_id: order.customer_id },
    orderId: order.id,
    customerName: "Untrusted submitted name",
    rating: 5,
    reviewText: "A lovely handmade piece.",
    photos: [{ url: "/uploads/reviews/photo.jpg", altText: "Customer photo" }]
  });

  assert.equal(review.customerName, "Trusted order name");
  assert.equal(review.status, "pending");
  assert.equal(review.orderId, undefined);
  assert.equal(database.reviews[0].order_id, order.id);
  assert.equal(database.photos.length, 1);
  await assert.rejects(
    service.submitProductReview({
      productId: "flower-keychain",
      session: { customer_id: order.customer_id },
      orderId: order.id,
      rating: 4,
      reviewText: "Another review for this order."
    }),
    { code: "DUPLICATE_ORDER_REVIEW" }
  );
  await assert.rejects(
    service.submitProductReview({
      productId: "flower-keychain",
      session: { customer_id: order.customer_id },
      orderId: "different-order",
      rating: 4,
      reviewText: "A review for a different order."
    }),
    { code: "INELIGIBLE_REVIEW_ORDER" }
  );
});
