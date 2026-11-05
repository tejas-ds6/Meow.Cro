import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createEmailService, emailConfigurationMessage } from "../server/email-service.js";
import { sendOrderStatusEmail, sendPaidOrderEmails } from "../server/order-email.js";
import { createRazorpayService } from "../server/payment-service.js";
import { emailAddress, photoAttachment, text } from "../server/validation.js";

const emailConfiguration = {
  RESEND_API_KEY: "test-only-placeholder",
  SMTP_FROM: "studio@example.test",
  MAIL_TO: "orders@example.test"
};

test("verified UPI payment sends a success email to the customer and notifies the studio", async () => {
  const messages = [];
  const emailService = {
    configured: true,
    async send(message) {
      messages.push(message);
      return { id: `email_${messages.length}` };
    }
  };
  const order = {
    id: "00000000-0000-4000-8000-000000000001",
    number: "MC-TEST-123",
    name: "Test buyer",
    email: "buyer@example.test",
    phone: "+91 98765 43210",
    address: "1 Test Street",
    city: "Test City",
    pin: "123456",
    items: [{ name: "Flower keychain", qty: 2, unitPrice: 250 }],
    subtotal: 500,
    shipping: 29,
    total: 529,
    paymentId: "pay_test_456",
    trackingLink: "https://meowcro.in/account.html?order=00000000-0000-4000-8000-000000000001"
  };

  const customerEmailSent = await sendPaidOrderEmails(order, emailService, "studio@example.test");

  assert.equal(customerEmailSent, true);
  assert.equal(messages[0].to, order.email);
  assert.equal(messages[0].subject, "Your Meow.Cro order is confirmed! ♡");
  assert.match(messages[0].text, /Your Meow.Cro order MC-TEST-123 is confirmed/);
  assert.match(messages[0].text, /Total: ₹529/);
  assert.match(messages[0].text, /account\.html\?order=00000000-0000-4000-8000-000000000001/);
  assert.match(messages[0].html, /TRACK MY ORDER/);
  assert.equal(messages[1].to, "studio@example.test");
  assert.match(messages[1].text, /Payment reference: pay_test_456/);
});

test("order status emails link back through verified customer order access", async () => {
  let message;
  const sent = await sendOrderStatusEmail({
    email: "buyer@example.test",
    name: "Test buyer",
    number: "MC-TEST-123",
    status: "Shipped"
  }, {
    configured: true,
    async send(value) {
      message = value;
      return { id: "email_status" };
    }
  }, "https://meowcro.in/account.html?order=order-reference", "Your parcel is on its way.");

  assert.equal(sent, true);
  assert.match(message.text, /Shipped/);
  assert.match(message.text, /Your parcel is on its way/);
  assert.match(message.html, /VIEW ORDER STATUS/);
  assert.match(message.html, /https:\/\/meowcro\.in\/account\.html\?order=order-reference/);
});

test("email service creates a Resend client from configuration and sends from the studio", async () => {
  let clientApiKey;
  let sentMessage;
  const service = createEmailService(emailConfiguration, (apiKey) => {
    clientApiKey = apiKey;
    return { emails: { send: async (message) => {
      sentMessage = message;
      return { data: { id: "email_123" }, error: null };
    } } };
  });

  assert.equal(service.configured, true);
  assert.equal(clientApiKey, "test-only-placeholder");
  const result = await service.send({
    to: "customer@example.test",
    replyTo: "reply@example.test",
    subject: "Hello",
    text: "Thanks!",
    attachments: [{ filename: "reference.jpg", content: Buffer.from([1, 2, 3]), contentType: "image/jpeg" }]
  });
  assert.equal(sentMessage.from, "studio@example.test");
  assert.equal(sentMessage.to, "customer@example.test");
  assert.equal(sentMessage.replyTo, "reply@example.test");
  assert.equal(sentMessage.subject, "Hello");
  assert.equal(sentMessage.text, "Thanks!");
  assert.match(sentMessage.html, /cid:meow-cro-logo/);
  assert.match(sentMessage.html, /Thanks!/);
  assert.equal(sentMessage.attachments[0].filename, "meow-cro-logo.jpg");
  assert.equal(sentMessage.attachments[0].contentType, "image/jpeg");
  assert.equal(sentMessage.attachments[0].contentId, "meow-cro-logo");
  assert.ok(sentMessage.attachments[0].content.length > 0);
  assert.deepEqual(sentMessage.attachments[1], {
    filename: "reference.jpg",
    content: Buffer.from([1, 2, 3]),
    contentType: "image/jpeg"
  });
  assert.deepEqual(result, { id: "email_123" });
});

test("branded email escapes untrusted message content", async () => {
  let sentMessage;
  const service = createEmailService(emailConfiguration, () => ({
    emails: { send: async (message) => {
      sentMessage = message;
      return { data: { id: "email_456" }, error: null };
    } }
  }));

  await service.send({ to: "customer@example.test", text: "<script>alert('x')</script>\nThanks!" });

  assert.match(sentMessage.html, /&lt;script&gt;alert\(&#39;x&#39;\)&lt;\/script&gt;<br>Thanks!/);
  assert.doesNotMatch(sentMessage.html, /<script>/);
});

test("email service reports missing Resend configuration instead of returning success", async () => {
  const service = createEmailService({});

  assert.equal(service.configured, false);
  await assert.rejects(service.send({ to: "customer@example.test" }), {
    message: emailConfigurationMessage
  });
});

test("email service surfaces Resend API errors and rejects empty success responses", async () => {
  const failedService = createEmailService(emailConfiguration, () => ({
    emails: { send: async () => ({ data: null, error: { message: "Domain is not verified" } }) }
  }));
  const emptyService = createEmailService(emailConfiguration, () => ({
    emails: { send: async () => ({ data: null, error: null }) }
  }));

  await assert.rejects(failedService.send({ to: "customer@example.test", subject: "Hello", text: "Thanks!" }), /Domain is not verified/);
  await assert.rejects(emptyService.send({ to: "customer@example.test", subject: "Hello", text: "Thanks!" }), /no email ID/);
});

test("text and email validators trim values and reject invalid input", () => {
  assert.equal(text("  Handmade with care  ", "Note"), "Handmade with care");
  assert.equal(emailAddress("  customer@example.test "), "customer@example.test");
  assert.throws(() => text(" ", "Name"), /Name is required/);
  assert.throws(() => text("long", "Name", { max: 3 }), /Name is too long/);
  assert.throws(() => emailAddress("not-an-email"), /Enter a valid email address/);
});

test("photo validator checks data URL encoding and actual image signatures", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  const attachment = photoAttachment(`data:image/jpeg;base64,${jpeg.toString("base64")}`);

  assert.equal(attachment.filename, "reference-photo.jpg");
  assert.equal(attachment.contentType, "image/jpeg");
  assert.deepEqual(attachment.content, jpeg);
  assert.equal(photoAttachment(""), null);
  assert.throws(() => photoAttachment("data:image/jpeg;base64,SGVsbG8="), /valid JPG, PNG, or WebP/);
  assert.throws(() => photoAttachment("data:image/gif;base64,R0lGODlh"), /valid JPG, PNG, or WebP/);
});

test("Razorpay service creates an order with the server-calculated INR amount", async () => {
  let createdOrder;
  const service = createRazorpayService({
    RAZORPAY_KEY_ID: "key_test",
    RAZORPAY_KEY_SECRET: "secret_test"
  }, () => ({
    orders: { create: async (order) => {
      createdOrder = order;
      return { id: "order_test_123", amount: 67800, currency: "INR" };
    } },
    payments: { fetch: async () => { throw new Error("not used"); } }
  }));
  const order = { number: "MC-TEST-123", total: 678 };

  const result = await service.createOrder(order);

  assert.equal(createdOrder.amount, 67800);
  assert.equal(createdOrder.currency, "INR");
  assert.equal(createdOrder.receipt, order.number);
  assert.equal(result.keyId, "key_test");
  assert.equal(result.orderId, "order_test_123");
  assert.equal(result.amount, 67800);
  assert.ok(result.verificationToken);
});

test("Razorpay service accepts only a valid signature and a captured matching payment", async () => {
  const secret = "secret_test";
  let fetchedPaymentId;
  const service = createRazorpayService({
    RAZORPAY_KEY_ID: "key_test",
    RAZORPAY_KEY_SECRET: secret
  }, () => ({
    orders: { create: async () => ({ id: "order_test_123", amount: 67800, currency: "INR" }) },
    payments: { fetch: async (paymentId) => {
      fetchedPaymentId = paymentId;
      return {
        id: paymentId,
        order_id: "order_test_123",
        amount: 67800,
        currency: "INR",
        status: "captured"
      };
    } }
  }));
  const details = await service.createOrder({
    number: "MC-TEST-123",
    total: 678,
    payment: "UPI",
    name: "Test buyer"
  });
  const paymentId = "pay_test_456";
  const signature = createHmac("sha256", secret)
    .update(`order_test_123|${paymentId}`)
    .digest("hex");

  const verified = await service.verifyPayment({
    orderId: "order_test_123",
    paymentId,
    signature,
    verificationToken: details.verificationToken
  });

  assert.equal(fetchedPaymentId, paymentId);
  assert.equal(verified.payment, "UPI (paid)");
  assert.equal(verified.paymentId, paymentId);
  assert.equal(verified.name, "Test buyer");
});

test("Razorpay service rejects altered signatures, wrong amounts, wrong orders, and uncaptured payments", async () => {
  const secret = "secret_test";
  let payment = {
    order_id: "order_test_123",
    amount: 67800,
    currency: "INR",
    status: "captured"
  };
  const service = createRazorpayService({
    RAZORPAY_KEY_ID: "key_test",
    RAZORPAY_KEY_SECRET: secret
  }, () => ({
    orders: { create: async () => ({ id: "order_test_123", amount: 67800, currency: "INR" }) },
    payments: { fetch: async () => payment }
  }));
  const details = await service.createOrder({ number: "MC-TEST-123", total: 678 });
  const paymentId = "pay_test_456";
  const signature = createHmac("sha256", secret)
    .update(`order_test_123|${paymentId}`)
    .digest("hex");
  const verify = (changes = {}) => service.verifyPayment({
    orderId: "order_test_123",
    paymentId,
    signature,
    verificationToken: details.verificationToken,
    ...changes
  });

  await assert.rejects(verify({ signature: "invalid" }), /could not verify/);
  await assert.rejects(verify({ orderId: "order_other" }), /do not match/);
  payment = { ...payment, amount: 100 };
  await assert.rejects(verify(), /has not been captured/);
  payment = { ...payment, amount: 67800, order_id: "order_other" };
  await assert.rejects(verify(), /has not been captured/);
  payment = { ...payment, order_id: "order_test_123", status: "authorized" };
  await assert.rejects(verify(), /has not been captured/);
});
