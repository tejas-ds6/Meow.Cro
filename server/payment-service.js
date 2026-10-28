import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import Razorpay from "razorpay";

const currency = "INR";
const tokenLifetimeMs = 24 * 60 * 60 * 1000;

export class PaymentVerificationError extends Error {}

function secureEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createRazorpayService(environment, clientFactory = (keyId, keySecret) =>
  new Razorpay({ key_id: keyId, key_secret: keySecret })) {
  const keyId = environment.RAZORPAY_KEY_ID;
  const keySecret = environment.RAZORPAY_KEY_SECRET;
  const configured = Boolean(keyId && keySecret);
  const client = configured ? clientFactory(keyId, keySecret) : null;

  function sign(value) {
    return createHmac("sha256", keySecret).update(value).digest("hex");
  }

  function createVerificationToken(payload) {
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    return `${encoded}.${sign(`meowcro-payment:${encoded}`)}`;
  }

  function readVerificationToken(token) {
    if (typeof token !== "string") throw new PaymentVerificationError("Payment verification details are invalid.");
    const [encoded, suppliedSignature, ...extra] = token.split(".");
    if (!encoded || !suppliedSignature || extra.length) throw new PaymentVerificationError("Payment verification details are invalid.");
    if (!secureEqual(sign(`meowcro-payment:${encoded}`), suppliedSignature)) {
      throw new PaymentVerificationError("Payment verification details are invalid.");
    }

    let payload;
    try {
      payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new PaymentVerificationError("Payment verification details are invalid.");
    }
    if (!payload || !Number.isInteger(payload.expiresAt) || payload.expiresAt < Date.now()) {
      throw new PaymentVerificationError("These payment details have expired. Please contact the studio for help.");
    }
    return payload;
  }

  async function createOrder(order) {
    if (!configured) throw new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment.");
    const amount = Math.round(order.total * 100);
    const razorpayOrder = await client.orders.create({
      amount,
      currency,
      receipt: order.number,
      notes: { order_number: order.number }
    });
    if (razorpayOrder.amount !== amount || razorpayOrder.currency !== currency || !razorpayOrder.id) {
      throw new Error("Razorpay returned an unexpected order.");
    }

    const token = createVerificationToken({
      orderId: razorpayOrder.id,
      amount,
      expiresAt: Date.now() + tokenLifetimeMs,
      order
    });
    return { keyId, orderId: razorpayOrder.id, amount, currency, verificationToken: token };
  }

  async function verifyPayment({ orderId, paymentId, signature, verificationToken }) {
    if (!configured) throw new Error("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment.");
    const payload = readVerificationToken(verificationToken);
    if (orderId !== payload.orderId || typeof paymentId !== "string" || !paymentId) {
      throw new PaymentVerificationError("Payment details do not match this order.");
    }

    const expectedSignature = sign(`${orderId}|${paymentId}`);
    if (typeof signature !== "string" || !secureEqual(expectedSignature, signature)) {
      throw new PaymentVerificationError("Razorpay could not verify this payment.");
    }

    const payment = await client.payments.fetch(paymentId);
    if (payment.order_id !== payload.orderId ||
      payment.amount !== payload.amount ||
      payment.currency !== currency ||
      payment.status !== "captured") {
      throw new PaymentVerificationError("Payment has not been captured for this order.");
    }
    return { ...payload.order, payment: "UPI (paid)", paymentId };
  }

  return { configured, createOrder, verifyPayment };
}

export function createOrderNumber() {
  return `MC-${Date.now().toString(36).toUpperCase()}-${randomBytes(3).toString("hex").toUpperCase()}`;
}
