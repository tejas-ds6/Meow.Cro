import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccountService } from "./server/account-service.js";
import { databaseConfigured, initializeDatabase, isDatabaseReady, logDatabaseError, pool } from "./server/database.js";
import { createEmailService, emailConfigurationMessage } from "./server/email-service.js";
import { sendPaidOrderEmails } from "./server/order-email.js";
import { createNimbusPostService, NimbusPostError } from "./server/nimbuspost-service.js";
import { products } from "./public/catalog.js";
import { createOrderNumber, createRazorpayService, PaymentVerificationError } from "./server/payment-service.js";
import { emailAddress, photoAttachment, text } from "./server/validation.js";

const app = express();
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}
app.set("trust proxy", 1);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const emailService = createEmailService(process.env);
const paymentService = createRazorpayService(process.env);
const nimbusPostService = createNimbusPostService(process.env);
const accountService = pool ? createAccountService({ database: pool, emailService, environment: process.env }) : null;
const productsById = new Map(products.map((product) => [product.id, product]));
const sessionCookieName = "meowcro_session";
const accountDatabaseUnavailable = "Customer accounts and saved order tracking require PostgreSQL. Configure DATABASE_URL and restart the server.";
const validOrderStatuses = [
  "Order Placed", "Order Confirmed", "Processing", "Ready for Delivery",
  "Shipped / Out for Delivery", "Delivered", "Cancelled", "Failed Delivery", "Returned"
];

function readCookie(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

function writeSessionCookie(response, request, session) {
  const secure = process.env.NODE_ENV === "production" || request.secure ? "; Secure" : "";
  const maxAge = Math.max(0, Math.floor((new Date(session.expiresAt).getTime() - Date.now()) / 1000));
  response.setHeader("Set-Cookie", `${sessionCookieName}=${encodeURIComponent(session.token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(response, request) {
  const secure = process.env.NODE_ENV === "production" || request.secure ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${sessionCookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function requireDatabase(_req, res, next) {
  if (!databaseConfigured || !isDatabaseReady()) {
    res.status(503).json({ error: accountDatabaseUnavailable });
    return;
  }
  next();
}

const loadAccountSession = asyncRoute(async (req, _res, next) => {
  req.accountSession = databaseConfigured && isDatabaseReady()
    ? await accountService.resolveSession(readCookie(req, sessionCookieName))
    : null;
  next();
});

function requireCustomer(req, res, next) {
  if (req.accountSession?.role !== "customer") {
    res.status(401).json({ error: "Please sign in to access your account." });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.accountSession?.role !== "admin") {
    res.status(401).json({ error: "Please sign in as an administrator." });
    return;
  }
  next();
}

function requireUuidParameter(req, res, next) {
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(req.params.id)) {
    res.status(400).json({ error: "This account or order reference is invalid." });
    return;
  }
  next();
}

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a little while." }
}));
const sensitiveApiRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a little while and try again." }
});
app.use([
  "/api/account/register",
  "/api/account/login",
  "/api/account/forgot-password",
  "/api/account/reset-password",
  "/api/account/otp/send",
  "/api/account/otp/verify",
  "/api/customer/otp/send",
  "/api/customer/otp/verify",
  "/api/admin/login",
  "/api/payments/razorpay/orders",
  "/api/payments/razorpay/verify",
  "/api/payments/razorpay/confirm",
  "/api/newsletter",
  "/api/custom-requests",
  "/api/contact"
], sensitiveApiRateLimit);
app.use(["/api/account", "/api/admin", "/api/customer"], (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use("/api/account/orders/:id/reviews", express.json({ limit: "34mb" }));
app.use("/api/account", express.json({ limit: "32kb" }));
app.use("/api/admin", express.json({ limit: "32kb" }));
app.use("/api/customer", express.json({ limit: "32kb" }));
app.use("/api", loadAccountSession);

function validateFields(validator, res) {
  try {
    return validator();
  } catch (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
}

function validatePhone(value) {
  const phone = text(value, "Phone number", { max: 30 });
  if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) throw new Error("Enter a valid phone number.");
  return phone;
}

function validatePassword(value, label = "Password") {
  if (typeof value !== "string" || !value) throw new Error(`${label} is required.`);
  if (value.length > 128) throw new Error(`${label} is too long.`);
  if (value.trim().length < 10) throw new Error(`${label} must be at least 10 non-space characters.`);
  const password = value;
  return password;
}

function validateAddress(value) {
  const body = value || {};
  const pin = text(body.pin, "PIN code", { max: 6 });
  if (!/^\d{6}$/.test(pin)) throw new Error("Enter a valid 6-digit PIN code.");
  return {
    label: text(body.label, "Address label", { max: 40 }),
    recipientName: text(body.recipientName, "Recipient name", { max: 120 }),
    phone: validatePhone(body.phone),
    address: text(body.address, "Street address", { max: 300 }),
    city: text(body.city, "City", { max: 100 }),
    pin
  };
}

function parseReviewPhotos(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Upload photos as a list of JPG, PNG, or WebP images.");
  if (value.length > 5) throw new Error("Upload up to 5 photos.");
  const photos = [];
  for (const item of value) {
    if (typeof item !== "string") throw new Error("Upload valid JPG, PNG, or WebP photos.");
    const attachment = photoAttachment(item);
    if (!attachment) throw new Error("Upload valid JPG, PNG, or WebP photos.");
    photos.push({
      url: `data:${attachment.contentType};base64,${attachment.content.toString("base64")}`,
      altText: "Customer product photo"
    });
  }
  return photos;
}

async function persistReviewPhotos(photos) {
  if (!Array.isArray(photos) || !photos.length) return [];
  const uploadDir = path.join(publicDir, "uploads", "reviews");
  await mkdir(uploadDir, { recursive: true });
  const saved = [];
  for (const [index, photo] of photos.entries()) {
    const dataUrl = typeof photo === "string" ? photo : photo?.url || "";
    if (!dataUrl) continue;
    const attachment = photoAttachment(dataUrl);
    const mimeType = attachment.contentType;
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
    const filename = `${Date.now()}-${randomUUID()}.${extension}`;
    const targetPath = path.join(uploadDir, filename);
    await writeFile(targetPath, attachment.content);
    saved.push({
      url: `/uploads/reviews/${filename}`,
      altText: `Customer review photo ${index + 1}`
    });
  }
  return saved;
}

  app.post("/api/account/register", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => {
      const body = req.body || {};
      return {
        name: text(body.name, "Name", { max: 120 }),
        email: emailAddress(body.email),
        phone: validatePhone(body.phone),
        password: validatePassword(body.password)
      };
    }, res);
    if (!values) return;
    try {
      const result = await accountService.register(values);
      writeSessionCookie(res, req, result.session);
      res.status(201).json({ customer: result.customer });
    } catch (error) {
      if (error.code === "23505") {
        res.status(409).json({ error: "An account with this email already exists." });
        return;
      }
      throw error;
    }
  }));

  app.post("/api/account/login", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      email: emailAddress(req.body?.email),
      password: validatePassword(req.body?.password, "Password")
    }), res);
    if (!values) return;
    const result = await accountService.login(values.email, values.password);
    if (!result) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    writeSessionCookie(res, req, result.session);
    res.json({ customer: result.customer });
  }));

  app.post("/api/account/otp/send", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({ email: emailAddress(req.body?.email) }), res);
    if (!values) return;
    if (await accountService.checkEmailOtpRateLimit(values.email)) {
      res.status(429).json({ error: "Please wait a moment before requesting another code." });
      return;
    }
    try {
      await accountService.requestEmailOtp(values.email);
    } catch (error) {
      console.error("OTP email request failed:", error);
    }
    res.status(202).json({ ok: true, message: "If this email is linked to an order, a verification code will arrive shortly." });
  }));

  app.post("/api/account/otp/resend", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({ email: emailAddress(req.body?.email) }), res);
    if (!values) return;
    if (await accountService.checkEmailOtpRateLimit(values.email)) {
      res.status(429).json({ error: "Please wait a moment before requesting another code." });
      return;
    }
    try {
      await accountService.requestEmailOtp(values.email);
    } catch (error) {
      console.error("OTP resend failed:", error);
    }
    res.status(202).json({ ok: true, message: "If this email is linked to an order, a new verification code will arrive shortly." });
  }));

  app.post("/api/account/otp/verify", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      email: emailAddress(req.body?.email),
      otp: text(req.body?.otp, "OTP", { max: 12 })
    }), res);
    if (!values) return;
    if (!/^\d{6}$/.test(values.otp)) {
      res.status(400).json({ error: "Enter the 6-digit code sent to your email." });
      return;
    }
    const result = await accountService.verifyEmailOtp(values.email, values.otp);
    if (!result || !result.ok) {
      res.status(401).json({ error: "This verification code is invalid or has expired." });
      return;
    }
    writeSessionCookie(res, req, result.session);
    res.json({ ok: true, customer: result.customer });
  }));

  app.post("/api/customer/otp/send", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({ email: emailAddress(req.body?.email) }), res);
    if (!values) return;
    if (await accountService.checkEmailOtpRateLimit(values.email)) {
      res.status(429).json({ error: "Please wait a moment before requesting another code." });
      return;
    }
    try {
      await accountService.requestEmailOtp(values.email);
    } catch (error) {
      console.error("OTP email request failed:", error);
    }
    res.status(202).json({ ok: true, message: "If this email is linked to an order, a verification code will arrive shortly." });
  }));

  app.post("/api/customer/otp/verify", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      email: emailAddress(req.body?.email),
      otp: text(req.body?.otp, "OTP", { max: 12 })
    }), res);
    if (!values) return;
    if (!/^\d{6}$/.test(values.otp)) {
      res.status(400).json({ error: "Enter the 6-digit code sent to your email." });
      return;
    }
    const result = await accountService.verifyEmailOtp(values.email, values.otp);
    if (!result || !result.ok) {
      res.status(401).json({ error: "This verification code is invalid or has expired." });
      return;
    }
    writeSessionCookie(res, req, result.session);
    res.json({ ok: true, customer: result.customer });
  }));

  app.post("/api/admin/login", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      email: emailAddress(req.body?.email),
      password: validatePassword(req.body?.password, "Password")
    }), res);
    if (!values) return;
    const result = await accountService.adminLogin(values.email, values.password);
    if (!result) {
      res.status(401).json({
        error: "Admin sign-in failed. Check the email and password, and make sure ADMIN_EMAIL and ADMIN_PASSWORD are set on the server. The configured admin password must be at least 16 characters."
      });
      return;
    }
    writeSessionCookie(res, req, result.session);
    res.json({ ok: true });
  }));

  app.post("/api/account/logout", requireDatabase, asyncRoute(async (req, res) => {
    await accountService.logout(readCookie(req, sessionCookieName));
    clearSessionCookie(res, req);
    res.json({ ok: true });
  }));

  app.get("/api/account/me", requireDatabase, requireCustomer, asyncRoute(async (req, res) => {
    if (req.accountSession.customer_id) {
      res.json(await accountService.getProfile(req.accountSession.customer_id));
      return;
    }
    const email = req.accountSession.customer_email || req.accountSession.email || null;
    res.json({
      customer: { id: null, name: null, email, phone: null },
      addresses: [],
      overview: { total: 0, pending: 0, inTransit: 0, delivered: 0 }
    });
  }));

  app.patch("/api/account/profile", requireDatabase, requireCustomer, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      name: text(req.body?.name, "Name", { max: 120 }),
      phone: validatePhone(req.body?.phone)
    }), res);
    if (!values) return;
    res.json({ customer: await accountService.updateProfile(req.accountSession.customer_id, values) });
  }));

  app.post("/api/account/addresses", requireDatabase, requireCustomer, asyncRoute(async (req, res) => {
    const address = validateFields(() => validateAddress(req.body), res);
    if (!address) return;
    res.status(201).json({ address: await accountService.saveAddress(req.accountSession.customer_id, address) });
  }));

  app.patch("/api/account/addresses/:id", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    const address = validateFields(() => validateAddress(req.body), res);
    if (!address) return;
    const saved = await accountService.saveAddress(req.accountSession.customer_id, address, req.params.id);
    if (!saved) {
      res.status(404).json({ error: "Saved address not found." });
      return;
    }
    res.json({ address: saved });
  }));

  app.delete("/api/account/addresses/:id", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    if (!await accountService.deleteAddress(req.accountSession.customer_id, req.params.id)) {
      res.status(404).json({ error: "Saved address not found." });
      return;
    }
    res.json({ ok: true });
  }));

  app.post("/api/account/password", requireDatabase, requireCustomer, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      currentPassword: validatePassword(req.body?.currentPassword, "Current password"),
      newPassword: validatePassword(req.body?.newPassword, "New password")
    }), res);
    if (!values) return;
    if (!await accountService.changePassword(req.accountSession.customer_id, values.currentPassword, values.newPassword)) {
      res.status(400).json({ error: "Your current password is incorrect." });
      return;
    }
    clearSessionCookie(res, req);
    res.json({ ok: true, message: "Password changed. Please sign in again." });
  }));

  app.post("/api/account/forgot-password", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({ email: emailAddress(req.body?.email) }), res);
    if (!values) return;
    if (!emailService.configured) {
      res.status(503).json({ error: "Password reset email is not configured. Please contact the studio." });
      return;
    }
    try {
      await accountService.requestPasswordReset(values.email);
    } catch (error) {
      console.error("Password reset email could not be sent:", error);
    }
    res.status(202).json({ ok: true, message: "If an account exists for that email, a reset link will be sent shortly." });
  }));

  app.post("/api/account/reset-password", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      token: text(req.body?.token, "Reset token", { max: 200 }),
      password: validatePassword(req.body?.password)
    }), res);
    if (!values) return;
    if (!await accountService.resetPassword(values.token, values.password)) {
      res.status(400).json({ error: "This password reset link is invalid or has expired. Request a new one." });
      return;
    }
    res.json({ ok: true });
  }));

  app.get("/api/account/orders", requireDatabase, requireCustomer, asyncRoute(async (req, res) => {
    res.json({ orders: await accountService.listOrdersForSession(req.accountSession) });
  }));

  app.get("/api/account/orders/:id", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    const order = await accountService.getOrderForSession(req.accountSession, req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    res.json({ order });
  }));

  app.post("/api/account/orders/:id/cancellation", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    const note = text(req.body?.note, "Cancellation note", { required: false, max: 500 });
    if (!await accountService.requestCancellationForSession(req.accountSession, req.params.id, note)) {
      res.status(409).json({ error: "This order cannot be cancelled online or already has a cancellation request." });
      return;
    }
    res.json({ ok: true, message: "Your cancellation request was sent to the studio." });
  }));

  app.get("/api/products/:productId/reviews", requireDatabase, asyncRoute(async (req, res) => {
    const productId = text(req.params.productId, "Product ID", { max: 120 });
    const product = productsById.get(productId);
    if (!product) {
      res.status(404).json({ error: "This product could not be found." });
      return;
    }
    const reviewData = await accountService.getProductReviewSummary(productId);
    res.json({
      product: { id: product.id, name: product.name },
      summary: reviewData.summary,
      featuredReviews: reviewData.featuredReviews
    });
  }));

  app.get("/api/account/orders/:id/reviews", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    res.json({ reviews: await accountService.listOrderReviews(req.accountSession.customer_id, req.params.id) });
  }));

  app.post("/api/account/orders/:id/reviews", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const values = validateFields(() => ({
      productId: text(body.productId, "Product", { max: 120 }),
      rating: Number(body.rating),
      reviewText: text(body.reviewText, "Review", { max: 1000 }),
      photos: parseReviewPhotos(body.photos || [])
    }), res);
    if (!values) return;
    const { productId } = values;
    if (!productsById.has(productId)) {
      res.status(404).json({ error: "This product could not be found." });
      return;
    }
    if (values.reviewText.length < 8) {
      res.status(400).json({ error: "Write a review with at least 8 characters." });
      return;
    }
    if (![1, 2, 3, 4, 5].includes(Number(values.rating))) {
      res.status(400).json({ error: "Choose a rating between 1 and 5 stars." });
      return;
    }
    if (!await accountService.getEligibleDeliveredOrderForProduct(req.accountSession.customer_id, req.params.id, productId)) {
      res.status(403).json({ error: "Only customers with a delivered order for this product can leave a review." });
      return;
    }
    if ((await accountService.listOrderReviews(req.accountSession.customer_id, req.params.id))
      .some((review) => review.productId === productId)) {
      res.status(409).json({ error: "You have already reviewed this product from that purchase." });
      return;
    }
    const savedPhotos = await persistReviewPhotos(values.photos);
    const review = await accountService.submitProductReview({
      productId,
      customerId: req.accountSession.customer_id,
      reviewText: values.reviewText,
      rating: values.rating,
      orderId: req.params.id,
      photos: savedPhotos
    });
    res.status(201).json({ review });
  }));

  app.get("/api/admin/reviews", requireDatabase, requireAdmin, asyncRoute(async (req, res) => {
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const validStatuses = new Set(["pending", "approved", "rejected"]);
    const status = validStatuses.has(statusFilter) ? statusFilter : null;
    res.json({ reviews: await accountService.listAdminReviews(status) });
  }));

  app.patch("/api/admin/reviews/:id", requireDatabase, requireAdmin, requireUuidParameter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : null;
    if (status && !new Set(["pending", "approved", "rejected"]).has(status)) {
      res.status(400).json({ error: "Choose a valid review status." });
      return;
    }
    const adminNote = typeof body.adminNote === "string" ? text(body.adminNote, "Review note", { required: false, max: 400 }) : "";
    const review = await accountService.updateReviewModeration(req.params.id, {
      status,
      adminNote,
      isFeatured: typeof body.isFeatured === "boolean" ? body.isFeatured : undefined
    });
    if (!review) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    res.json({ review });
  }));

  app.get("/api/admin/orders", requireDatabase, requireAdmin, asyncRoute(async (_req, res) => {
    res.json({ orders: await accountService.listAdminOrders() });
  }));

  app.post("/api/admin/orders/:id/nimbuspost", requireDatabase, requireAdmin, requireUuidParameter, asyncRoute(async (req, res) => {
    if (!nimbusPostService.configured) {
      res.status(503).json({ error: "NimbusPost is not configured. Set NIMBUSPOST_API_KEY, NIMBUSPOST_API_SECRET, and NIMBUSPOST_WAREHOUSE_ID on the server." });
      return;
    }
    const order = await accountService.getAdminOrder(req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found." });
      return;
    }
    if (order.paymentStatus !== "Paid" || order.status === "Cancelled") {
      res.status(409).json({ error: "Only paid, non-cancelled orders can be shipped with NimbusPost." });
      return;
    }
    if (order.deliveryMethod !== "NimbusPost") {
      res.status(409).json({ error: "Select and save NimbusPost as the delivery method before booking." });
      return;
    }

    let packageDetails;
    let state;
    if (!order.nimbuspostOrderId) {
      const values = validateFields(() => {
        const body = req.body || {};
        const positiveNumber = (value, label, maximum) => {
          const parsed = Number(value);
          if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) {
            throw new Error(`${label} must be greater than zero and no more than ${maximum}.`);
          }
          return parsed;
        };
        return {
          state: text(body.state, "State", { max: 100 }),
          packageDetails: {
            weight: positiveNumber(body.weight, "Package weight in kilograms", 100),
            length: positiveNumber(body.length, "Package length in centimetres", 200),
            width: positiveNumber(body.width, "Package width in centimetres", 200),
            height: positiveNumber(body.height, "Package height in centimetres", 200)
          }
        };
      }, res);
      if (!values) return;
      state = values.state;
      packageDetails = values.packageDetails;
    }

    try {
      const nimbuspostOrderId = await accountService.createNimbusPostOrder(req.params.id, (currentOrder) =>
        nimbusPostService.createOrder(currentOrder, { state, packageDetails }));
      if (!nimbuspostOrderId) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      const savedOrder = await accountService.bookNimbusPostOrder(req.params.id, (partnerOrderId) =>
        nimbusPostService.ensureBooked(partnerOrderId));
      if (!savedOrder) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.json({ order: savedOrder });
    } catch (error) {
      if (error instanceof NimbusPostError) {
        res.status(502).json({ error: error.message });
        return;
      }
      throw error;
    }
  }));

  app.patch("/api/admin/orders/:id", requireDatabase, requireAdmin, requireUuidParameter, asyncRoute(async (req, res) => {
    const values = validateFields(() => {
      const body = req.body || {};
      const optionalText = (value, label, max) => value === undefined ? undefined : (text(value, label, { required: false, max }) || null);
      const status = optionalText(body.status, "Order status", 40);
      if (status && !validOrderStatuses.includes(status)) throw new Error("Choose a valid order status.");
      const deliveryMethod = optionalText(body.deliveryMethod, "Delivery method", 20);
      if (deliveryMethod && !["Courier", "NimbusPost", "Self Delivery"].includes(deliveryMethod)) {
        throw new Error("Choose Courier, NimbusPost, or Self Delivery.");
      }
      const trackingUrl = optionalText(body.trackingUrl, "Tracking link", 500);
      if (trackingUrl) {
        let parsedTrackingUrl;
        try {
          parsedTrackingUrl = new URL(trackingUrl);
        } catch {
          throw new Error("Enter a valid HTTPS tracking link.");
        }
        if (parsedTrackingUrl.protocol !== "https:" || !parsedTrackingUrl.hostname) {
          throw new Error("Tracking links must use HTTPS.");
        }
      }
      const estimatedDelivery = optionalText(body.estimatedDelivery, "Estimated delivery", 10);
      if (estimatedDelivery) {
        const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(estimatedDelivery)
          ? new Date(`${estimatedDelivery}T00:00:00.000Z`)
          : null;
        if (!parsedDate || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== estimatedDelivery) {
          throw new Error("Enter a valid estimated delivery date.");
        }
      }
      const cancellationDecision = optionalText(body.cancellationDecision, "Cancellation decision", 10);
      if (cancellationDecision && !["approve", "reject"].includes(cancellationDecision)) {
        throw new Error("Choose approve or reject for the cancellation request.");
      }
      return {
        status,
        statusNote: optionalText(body.statusNote, "Status note", 500),
        deliveryMethod,
        courierName: optionalText(body.courierName, "Courier name", 100),
        trackingId: optionalText(body.trackingId, "Tracking ID", 120),
        trackingUrl,
        courierStatus: optionalText(body.courierStatus, "Courier status", 120),
        estimatedDelivery,
        cancellationDecision
      };
    }, res);
    if (!values) return;
    try {
      const order = await accountService.updateAdminOrder(req.params.id, values);
      if (!order) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      res.json({ order });
    } catch (error) {
      if (error.code === "NIMBUSPOST_CANCELLATION_REQUIRED") {
        res.status(409).json({ error: error.message });
        return;
      }
      throw error;
    }
  }));
async function sendStudioEmail(message, res) {
  if (!emailService.configured) {
    res.status(503).json({
      error: emailConfigurationMessage
    });
    return;
  }

  try {
    await emailService.send({ to: process.env.MAIL_TO, ...message });
    res.json({ ok: true });
  } catch (error) {
    console.error("Resend email delivery failed:", error);
    res.status(502).json({ error: "We couldn't send that email right now. Please try again shortly." });
  }
}

app.post("/api/newsletter", express.json({ limit: "32kb" }), async (req, res) => {
  const values = validateFields(() => ({
    email: emailAddress(req.body?.email)
  }), res);
  if (!values) return;

  await sendStudioEmail({
    subject: "Newsletter signup request",
    text: `Newsletter signup request from: ${values.email}`
  }, res);
});

app.post("/api/custom-requests", express.json({ limit: "7mb" }), async (req, res) => {
  const values = validateFields(() => {
    const body = req.body || {};
    const email = emailAddress(body.email);
    const neededBy = text(body["needed-by"], "Needed-by date", { required: false, max: 10 });
    if (neededBy && !/^\d{4}-\d{2}-\d{2}$/.test(neededBy)) {
      throw new Error("Enter a valid needed-by date.");
    }
    const budget = text(body.budget, "Budget", { required: false, max: 8 });
    if (budget && !/^\d+$/.test(budget)) throw new Error("Budget must be a number.");

    return {
      name: text(body.name, "Name", { max: 80 }),
      email,
      whatsapp: text(body.whatsapp, "WhatsApp number", { max: 30 }),
      idea: text(body.idea, "Your idea", { max: 2000 }),
      details: text(body.details, "Additional details", { required: false, max: 1000 }),
      budget,
      neededBy,
      photo: photoAttachment(body.photo)
    };
  }, res);
  if (!values) return;

  await sendStudioEmail({
    replyTo: values.email,
    subject: "New custom crochet request",
    text: [
      `Name: ${values.name}`,
      `Email: ${values.email}`,
      `WhatsApp: ${values.whatsapp}`,
      "",
      "What they would like made:",
      values.idea,
      "",
      `Colors, size, or other details: ${values.details || "Not specified"}`,
      `Budget: ${values.budget ? `₹${values.budget}` : "Not specified"}`,
      `Needed by: ${values.neededBy || "Not specified"}`,
      `Reference photo: ${values.photo ? "Attached" : "Not attached"}`
    ].join("\n"),
    attachments: values.photo ? [values.photo] : []
  }, res);
});

app.post("/api/contact", express.json({ limit: "32kb" }), async (req, res) => {
  const values = validateFields(() => {
    const body = req.body || {};
    return {
      name: text(body.name, "Name", { max: 80 }),
      email: emailAddress(body.email),
      message: text(body.message, "Message", { max: 2000 })
    };
  }, res);
  if (!values) return;

  await sendStudioEmail({
    replyTo: values.email,
    subject: "New Meow.Cro contact message",
    text: [`Name: ${values.name}`, `Email: ${values.email}`, "", values.message].join("\n")
  }, res);
});

app.post("/api/payments/razorpay/orders", requireDatabase, express.json({ limit: "32kb" }), async (req, res) => {
  const values = validateFields(() => {
    const body = req.body || {};
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30) {
      throw new Error("Your bag doesn't contain valid items.");
    }

    const items = body.items.map((item) => {
      const id = text(item?.id, "Product", { max: 120 });
      const product = productsById.get(id);
      if (!product) throw new Error("A product in your bag is no longer available.");
      const qty = Number(item.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("A product quantity is invalid.");
      return { id, name: product.name, image: product.image, qty, unitPrice: product.price };
    });
    const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const shipping = subtotal > 599 ? 0 : 29;
    const phone = validatePhone(body.phone);
    const pin = text(body.pin, "PIN code", { max: 6 });
    if (!/^\d{6}$/.test(pin)) throw new Error("Enter a valid 6-digit PIN code.");
    return {
      name: text(body.name, "Name", { max: 120 }),
      email: emailAddress(body.email),
      phone,
      address: text(body.address, "Street address", { max: 300 }),
      city: text(body.city, "City", { max: 100 }),
      pin,
      note: text(body.note, "Note", { required: false, max: 1000 }),
      payment: "UPI",
      number: createOrderNumber(),
      items,
      subtotal,
      shipping,
      total: subtotal + shipping
    };
  }, res);
  if (!values) return;
  if (!paymentService.configured) {
    res.status(503).json({ error: "Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment." });
    return;
  }

  try {
    const paymentOrder = await paymentService.createOrder(values);
    await accountService.saveOrder(values, {
      customerId: req.accountSession?.role === "customer" ? req.accountSession.customer_id : null,
      razorpayOrderId: paymentOrder.orderId,
      paymentStatus: "Pending"
    });
    res.json(paymentOrder);
  } catch (error) {
    console.error("Razorpay order creation failed:", error);
    res.status(502).json({ error: "We couldn't start your UPI payment. Please try again shortly." });
  }
});

app.post("/api/payments/razorpay/verify", express.json({ limit: "32kb" }), async (req, res) => {
  const details = req.body || {};
  try {
    const order = await paymentService.verifyPayment({
      orderId: details.razorpay_order_id,
      paymentId: details.razorpay_payment_id,
      signature: details.razorpay_signature,
      verificationToken: details.verificationToken
    });
    if (databaseConfigured && !await accountService.updatePayment(order.number, "Paid", order.paymentId)) {
      throw new Error("The verified Razorpay order was not found in PostgreSQL.");
    }
    const notificationSent = await sendPaidOrderEmails(order, emailService, process.env.MAIL_TO);
    res.json({ ok: true, order, notificationSent });
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error("Razorpay payment verification failed:", error);
    res.status(502).json({ error: "We couldn't verify the payment right now. Please try again shortly." });
  }
});

app.post("/api/payments/razorpay/confirm", express.json({ limit: "32kb" }), async (req, res) => {
  const details = req.body || {};
  try {
    const order = await paymentService.verifyPayment({
      orderId: details.razorpay_order_id,
      paymentId: details.razorpay_payment_id,
      signature: details.razorpay_signature,
      verificationToken: details.verificationToken
    });
    if (databaseConfigured && !await accountService.updatePayment(order.number, "Paid", order.paymentId)) {
      throw new Error("The verified Razorpay order was not found in PostgreSQL.");
    }
    res.json({ ok: true, order });
  } catch (error) {
    if (error instanceof PaymentVerificationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.error("Razorpay confirmation check failed:", error);
    res.status(502).json({ error: "We couldn't confirm the payment right now. Please refresh to try again." });
  }
});

app.get("/api/health/database", async (_req, res) => {
  if (!databaseConfigured || !pool) {
    res.status(503).json({ configured: false, connected: false, schemaReady: false });
    return;
  }

  try {
    await pool.query("SELECT 1");
    const schemaReady = isDatabaseReady();
    res.status(schemaReady ? 200 : 503).json({ configured: true, connected: true, schemaReady });
  } catch (error) {
    logDatabaseError("health query", error);
    res.status(503).json({ configured: true, connected: false, schemaReady: isDatabaseReady() });
  }
});

app.use(express.static(publicDir));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "The request is too large. Upload up to 5 photos, each up to 5 MB." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "The request body must be valid JSON." });
  }
  if (Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
    return res.status(error.status).json({ error: error.message });
  }
  console.error("Request failed:", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.get("/account", (_req, res) => res.redirect("/account.html"));
app.get("/admin", (_req, res) => res.redirect("/admin.html"));

console.info(`[database] DATABASE_URL configured: ${databaseConfigured ? "yes" : "no"}; Neon WebSocket transport; TLS certificate verification enabled.`);

if (databaseConfigured) {
  try {
    await initializeDatabase();
  } catch (error) {
    logDatabaseError("schema initialization", error);
    console.error("PostgreSQL schema initialization failed; customer account and order persistence APIs will remain unavailable.");
  }
} else {
  console.warn(accountDatabaseUnavailable);
}

app.listen(port, "0.0.0.0", () => {
  console.log(`Meow.Cro is listening on port ${port}`);
  if (!emailService.configured) {
    console.warn(emailConfigurationMessage);
  }
  if (!paymentService.configured) {
    console.warn("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment to accept UPI payments.");
  }
});
