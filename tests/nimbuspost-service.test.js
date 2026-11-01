import test from "node:test";
import assert from "node:assert/strict";
import { createNimbusPostService, NimbusPostError } from "../server/nimbuspost-service.js";

const credentials = {
  NIMBUSPOST_API_KEY: "npk_test",
  NIMBUSPOST_API_SECRET: "secret_test",
  NIMBUSPOST_WAREHOUSE_ID: "warehouse_test"
};

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return data;
    }
  };
}

test("NimbusPost creates a prepaid order with the configured warehouse and parcel details", async () => {
  let requestUrl;
  let requestOptions;
  const service = createNimbusPostService(credentials, async (url, options) => {
    requestUrl = url;
    requestOptions = options;
    return response({ success: true, data: { order_id: "np_order_123" } }, 201);
  });
  const order = {
    number: "MC-TEST-ORDER",
    name: "Test buyer",
    email: "buyer@example.test",
    phone: "+91 98765 43210",
    address: "1 Test Street",
    city: "Bengaluru",
    pin: "560001",
    items: [{ id: "flower-keychain", name: "Flower keychain", qty: 2, unitPrice: 250 }]
  };

  const orderId = await service.createOrder(order, {
    state: "Karnataka",
    packageDetails: { weight: 0.5, length: 16, width: 10, height: 5 }
  });

  assert.equal(orderId, "np_order_123");
  assert.equal(requestUrl.href, "https://api-v2.nimbuspost.com/v2/orders");
  assert.equal(requestOptions.method, "POST");
  assert.equal(requestOptions.headers["x-api-key"], credentials.NIMBUSPOST_API_KEY);
  assert.equal(requestOptions.headers["x-api-secret"], credentials.NIMBUSPOST_API_SECRET);
  assert.deepEqual(JSON.parse(requestOptions.body), {
    order_number: "MEOWCRO-MC-TEST-ORDER",
    order_type: "b2c",
    payment_mode: "prepaid",
    warehouse_id: credentials.NIMBUSPOST_WAREHOUSE_ID,
    shipping_address: {
      name: "Test buyer",
      email: "buyer@example.test",
      address: "1 Test Street",
      pincode: 560001,
      city: "Bengaluru",
      state: "Karnataka",
      country: "India",
      phone: 9876543210
    },
    items: [{ name: "Flower keychain", qty: 2, price: 250, sku: "flower-keychain" }],
    package: { weight: 0.5, length: 16, width: 10, height: 5 }
  });
});

test("NimbusPost checks an order before booking and saves secure shipment links", async () => {
  const calls = [];
  const service = createNimbusPostService(credentials, async (url, options) => {
    calls.push({ url: url.href, method: options.method });
    if (calls.length === 1) return response({ success: true, data: { order_id: "np_order_123", shipment: null } });
    return response({
      success: true,
      data: {
        awb: "AWB123456789",
        courier_name: "Courier Partner",
        order_status: "booked",
        tracking_url: "https://track.example.test/AWB123456789",
        label_url: "https://labels.example.test/AWB123456789.pdf"
      }
    });
  });

  const shipment = await service.ensureBooked("np_order_123");

  assert.deepEqual(calls, [
    { url: "https://api-v2.nimbuspost.com/v2/orders/np_order_123", method: "GET" },
    { url: "https://api-v2.nimbuspost.com/v2/shipments/book", method: "POST" }
  ]);
  assert.deepEqual(shipment, {
    awb: "AWB123456789",
    courierName: "Courier Partner",
    trackingUrl: "https://track.example.test/AWB123456789",
    labelUrl: "https://labels.example.test/AWB123456789.pdf",
    status: "booked"
  });
});

test("NimbusPost does not book an order that already has an AWB", async () => {
  let calls = 0;
  const service = createNimbusPostService(credentials, async () => {
    calls += 1;
    return response({
      success: true,
      data: {
        shipment: {
          awb: "AWB123456789",
          courier_name: "Courier Partner",
          tracking_url: "https://track.example.test/AWB123456789"
        }
      }
    });
  });

  const shipment = await service.ensureBooked("np_order_123");

  assert.equal(calls, 1);
  assert.equal(shipment.awb, "AWB123456789");
});

test("NimbusPost surfaces API failures and rejects non-HTTPS shipment links", async () => {
  const failed = createNimbusPostService(credentials, async () =>
    response({ success: false, error: { detail: "API key does not have permission." } }, 403));
  const badLink = createNimbusPostService(credentials, async () =>
    response({
      success: true,
      data: { awb: "AWB123456789", tracking_url: "javascript:alert(1)" }
    }));

  await assert.rejects(failed.ensureBooked("np_order_123"), {
    name: "NimbusPostError",
    message: /API key does not have permission/
  });
  await assert.rejects(badLink.ensureBooked("np_order_123"), {
    name: "NimbusPostError",
    message: /not HTTPS/
  });
  assert.equal(NimbusPostError.name, "NimbusPostError");
});

test("NimbusPost reports missing configuration before attempting network requests", async () => {
  let calls = 0;
  const service = createNimbusPostService({}, async () => {
    calls += 1;
    return response({ success: true, data: {} });
  });

  assert.equal(service.configured, false);
  await assert.rejects(service.ensureBooked("np_order_123"), /NimbusPost is not configured/);
  assert.equal(calls, 0);
});
