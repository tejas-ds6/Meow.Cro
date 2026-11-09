import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAccountService } from "../server/account-service.js";

test("custom quote starts a server-priced payment and saves an order linked to its request", async () => {
  const token = "customer-quote-link";
  const customRequest = {
    id: "request-uuid",
    name: "Custom buyer",
    email: "buyer@example.test",
    whatsapp: "+91 98765 43210",
    idea: "A hand-crocheted lavender bag",
    details: "Lilac cotton",
    quoted_amount: "1450.00",
    quote_token_hash: createHash("sha256").update(token).digest("hex"),
    status: "offered",
    quote_expires_at: new Date(Date.now() + 60_000)
  };
  const orders = new Map();
  const events = [];
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push(sql);
      if (sql.includes("SELECT 1 FROM orders")) {
        const order = orders.get(customRequest.id);
        return {
          rows: order && order.number === values[0] && order.razorpay_order_id === values[1] &&
            (order.payment_status !== "Paid" || order.payment_reference === values[2]) ? [{}] : []
        };
      }
      if (sql.includes("SELECT * FROM orders WHERE LOWER(BTRIM(customer_email))")) {
        return {
          rows: [...orders.values()].filter((order) =>
            order.customer_email === values[0] &&
            (order.custom_order_id === null || order.payment_status === "Paid"))
        };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) return { rows: [] };
          if (sql.includes("FROM custom_order_requests") && sql.includes("FOR UPDATE")) {
            return { rows: [customRequest] };
          }
          if (sql.includes("SELECT * FROM orders WHERE custom_order_id")) {
            const order = orders.get(values[0]);
            return { rows: order ? [order] : [] };
          }
          if (sql.includes("INSERT INTO orders")) {
            const [
              id, number, customerId, email, name, phone, address, city, pin, note, items,
              subtotal, shipping, discount, total, paymentMethod, razorpayOrderId, customOrderId
            ] = values;
            const order = {
              id, number, customer_id: customerId, customer_email: email, name, phone, address, city, pin, note,
              items: JSON.parse(items), subtotal, shipping, discount, total, payment_method: paymentMethod,
              payment_status: "Pending", payment_reference: null, razorpay_order_id: razorpayOrderId,
              custom_order_id: customOrderId, order_status: "Order Placed", created_at: new Date(),
              updated_at: new Date(), cancellation_requested: false
            };
            orders.set(customOrderId, order);
            return { rows: [order] };
          }
          if (sql.includes("INSERT INTO order_status_events")) {
            events.push(values);
            return { rows: [] };
          }
          throw new Error(`Unexpected transaction SQL: ${sql}`);
        },
        release() {}
      };
    }
  };
  const service = createAccountService({
    database,
    emailService: { send: async () => ({ id: "email_test" }) },
    environment: {}
  });
  let razorpayOrder;
  const checkout = await service.startCustomOrderPayment(
    token,
    { address: "1 Studio Lane", city: "Pune", pin: "411001", note: "Call on arrival", total: 1 },
    "customer-uuid",
    async (order) => {
      razorpayOrder = order;
      return { orderId: "rzp_custom_order", amount: 145000, currency: "INR" };
    }
  );

  assert.equal(razorpayOrder.total, 1450);
  assert.equal(razorpayOrder.email, "buyer@example.test");
  assert.equal(razorpayOrder.customOrderId, customRequest.id);
  assert.equal(checkout.order.total, 1450);
  assert.equal(checkout.order.paymentStatus, "Pending");
  assert.equal(checkout.order.customerId, undefined);
  assert.equal(checkout.order.email, "buyer@example.test");
  assert.equal(checkout.order.address, "1 Studio Lane");
  assert.equal(checkout.order.items[0].unitPrice, 1450);
  assert.match(checkout.order.items[0].customDescription, /lavender bag/);
  assert.equal(orders.get(customRequest.id).customer_id, "customer-uuid");
  assert.equal(orders.get(customRequest.id).razorpay_order_id, "rzp_custom_order");
  assert.equal(events[0][2], "Order Placed");
  assert.equal(await service.isCustomPaymentOrderCurrent(checkout.order.number, "rzp_custom_order", "pay_123"), true);
  assert.equal(await service.isCustomPaymentOrderCurrent(checkout.order.number, "old_rzp_order", "pay_123"), false);
  assert.deepEqual(await service.listCustomerOrdersByEmail("buyer@example.test"), []);
  assert.ok(queries.some((sql) => sql.includes("(custom_order_id IS NULL OR payment_status = 'Paid')")));
  orders.get(customRequest.id).payment_status = "Paid";
  assert.equal((await service.listCustomerOrdersByEmail("buyer@example.test")).length, 1);
});
