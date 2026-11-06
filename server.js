import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAccountService } from "./server/account-service.js";
import { databaseConfigured, initializeDatabase, isDatabaseReady, logDatabaseError, pool } from "./server/database.js";
import { createEmailService, emailConfigurationMessage } from "./server/email-service.js";
import { sendOrderStatusEmail, sendPaidOrderEmails } from "./server/order-email.js";
import { createNimbusPostService, NimbusPostError } from "./server/nimbuspost-service.js";
import { products } from "./public/catalog.js";
import { createOrderNumber, createRazorpayService, PaymentVerificationError } from "./server/payment-service.js";
import { emailAddress, photoAttachment, text } from "./server/validation.js";

const app = express();
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be a valid TCP port between 1 and 65535.");
}
const configuredSiteUrl = process.env.SITE_URL ? new URL(process.env.SITE_URL) : null;
if (configuredSiteUrl && !["http:", "https:"].includes(configuredSiteUrl.protocol)) {
  throw new Error("SITE_URL must use HTTP or HTTPS.");
}
app.set("trust proxy", 1);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const reviewUploadDir = path.resolve(process.env.REVIEW_UPLOAD_DIR || path.join(rootDir, "data", "review-photos"));
const reviewUploadRelativePath = path.relative(publicDir, reviewUploadDir);
if (reviewUploadRelativePath === "" || (!reviewUploadRelativePath.startsWith(`..${path.sep}`) && reviewUploadRelativePath !== ".." && !path.isAbsolute(reviewUploadRelativePath))) {
  throw new Error("REVIEW_UPLOAD_DIR must be outside the public directory.");
}
const emailService = createEmailService(process.env);
const paymentService = createRazorpayService(process.env);
const nimbusPostService = createNimbusPostService(process.env);
const accountService = pool ? createAccountService({ database: pool, emailService, environment: process.env }) : null;
const productsById = new Map(products.map((product) => [product.id, product]));
const tabSessionHeader = "x-tab-session";
const accountDatabaseUnavailable = "Customer accounts and saved order tracking require PostgreSQL. Configure DATABASE_URL and restart the server.";
const sitemapPaths = [
  "/", "/shop.html", "/story.html", "/custom.html", "/contact.html", "/faq.html",
  "/shipping-policy.html", "/returns-refunds.html", "/privacy-policy.html", "/terms.html"
];
const seoPageFiles = new Map(sitemapPaths.map((page) => [page, page === "/" ? "index.html" : page.slice(1)]));
seoPageFiles.set("/index.html", "index.html");
const validOrderStatuses = [
  "Order Placed", "Order Confirmed", "Processing", "Ready for Delivery",
  "Shipped / Out for Delivery", "Delivered", "Cancelled", "Failed Delivery", "Returned"
];

function readCookie(request, name) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));
  return cookie ? cookie.slice(name.length + 1) : "";
}

function getTabSessionId(request) {
  const value = request.get(tabSessionHeader) || "";
  return /^[\da-f]{32}$/i.test(value) ? value : "";
}

function getSessionCookieName(role, tabId) {
  return `meowcro_${role}_${tabId}`;
}

async function hasAdminSession(request) {
  const tabId = getTabSessionId(request);
  const token = tabId ? readCookie(request, getSessionCookieName("admin", tabId)) : "";
  if (!token || !accountService || !isDatabaseReady()) return false;
  const session = await accountService.resolveSession(token, "admin", tabId);
  return session?.role === "admin";
}

function writeSessionCookie(response, request, session, role, tabId) {
  const secure = process.env.NODE_ENV === "production" || request.secure ? "; Secure" : "";
  const cookieName = getSessionCookieName(role, tabId);
  response.setHeader("Set-Cookie", `${cookieName}=${session.token}; HttpOnly; SameSite=Lax; Path=/${secure}`);
  response.setHeader("X-Session-Idle-Expires-At", new Date(session.idleExpiresAt).toISOString());
  response.setHeader("X-Session-Expires-At", new Date(session.expiresAt).toISOString());
}

function clearSessionCookie(response, request, role, tabId) {
  const secure = process.env.NODE_ENV === "production" || request.secure ? "; Secure" : "";
  const cookieName = getSessionCookieName(role, tabId);
  response.setHeader("Set-Cookie", `${cookieName}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function getSiteOrigin(request) {
  return configuredSiteUrl?.origin || `${request.protocol}://${request.get("host")}`;
}

function getPublicSiteOrigin() {
  return configuredSiteUrl?.origin || "https://meowcro.in";
}

function requireDatabase(_req, res, next) {
  if (!databaseConfigured || !isDatabaseReady()) {
    res.status(503).json({ error: accountDatabaseUnavailable });
    return;
  }
  next();
}

const loadAccountSession = asyncRoute(async (req, res, next) => {
  const role = req.path.startsWith("/admin/") ? "admin"
    : req.path.startsWith("/account/") || req.path.startsWith("/customer/") ||
      req.path.startsWith("/payments/razorpay/") ? "customer"
      : null;
  const tabId = role ? getTabSessionId(req) : "";
  const cookieName = role && tabId ? getSessionCookieName(role, tabId) : "";
  const token = cookieName ? readCookie(req, cookieName) : "";
  req.tabSessionId = tabId;
  req.sessionCookieName = cookieName;
  req.sessionCookiePresent = Boolean(token);
  const canResolveSession = databaseConfigured && isDatabaseReady() && Boolean(accountService);
  req.accountSession = canResolveSession && role
    ? await accountService.resolveSession(token, role, tabId, req.get("x-user-activity") === "1")
    : null;
  if (req.accountSession) {
    res.setHeader("X-Session-Idle-Expires-At", new Date(req.accountSession.idle_expires_at).toISOString());
    res.setHeader("X-Session-Expires-At", new Date(req.accountSession.expires_at).toISOString());
  }
  if (token && canResolveSession && !req.accountSession) {
    await accountService.logout(token, role);
    clearSessionCookie(res, req, role, tabId);
  }
  next();
});

function requireCustomer(req, res, next) {
  if (req.accountSession?.role !== "customer") {
    const expired = req.sessionCookiePresent;
    res.status(401).json({
      error: expired ? "Your session has expired. Please sign in again." : "Please sign in to access your account.",
      ...(expired ? { code: "SESSION_EXPIRED" } : {})
    });
    return;
  }
  next();
}

function requireAdmin(req, res, next) {
  if (req.accountSession?.role !== "admin") {
    const expired = req.sessionCookiePresent;
    res.status(401).json({
      error: expired ? "Your admin session has expired. Please sign in again." : "Please sign in as an administrator.",
      ...(expired ? { code: "SESSION_EXPIRED" } : {})
    });
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
  "/api/orders",
  "/api/payments/razorpay/orders",
  "/api/payments/razorpay/verify",
  "/api/payments/razorpay/confirm",
  "/api/newsletter",
  "/api/custom-requests",
  "/api/contact"
], sensitiveApiRateLimit);
app.use(["/api/account", "/api/admin", "/api/customer", "/api/orders"], (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.use(["/api/account", "/api/admin", "/api/customer"], (req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    next();
    return;
  }
  const tabId = getTabSessionId(req);
  const expectedOrigin = configuredSiteUrl?.origin || `${req.protocol}://${req.get("host")}`;
  if (!tabId || req.get("origin") !== expectedOrigin) {
    res.status(403).json({ error: "This request could not be verified. Refresh the page and try again." });
    return;
  }
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

function checkoutOrderValues(body, payment) {
  if (!Array.isArray(body?.items) || body.items.length === 0 || body.items.length > 30) {
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
    payment,
    number: createOrderNumber(),
    items,
    subtotal,
    shipping,
    total: subtotal + shipping
  };
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
  await mkdir(reviewUploadDir, { recursive: true });
  const saved = [];
  try {
    for (const [index, photo] of photos.entries()) {
      const dataUrl = typeof photo === "string" ? photo : photo?.url || "";
      if (!dataUrl) continue;
      const attachment = photoAttachment(dataUrl);
      const extension = attachment.contentType === "image/png" ? "png" : attachment.contentType === "image/webp" ? "webp" : "jpg";
      const id = randomUUID();
      const filename = `${id}.${extension}`;
      await writeFile(path.join(reviewUploadDir, filename), attachment.content, { flag: "wx" });
      saved.push({
        id,
        url: `/api/review-photos/${id}`,
        storageReference: filename,
        altText: `Customer review photo ${index + 1}`
      });
    }
  } catch (error) {
    await removeReviewPhotoFiles(saved.map((photo) => photo.storageReference));
    throw error;
  }
  return saved;
}

async function removeReviewPhotoFiles(references) {
  for (const reference of references) {
    const filename = path.basename(String(reference || ""));
    if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(filename)) continue;
    try {
      await unlink(path.join(reviewUploadDir, filename));
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.error("Unable to remove a review photo file.", error);
      }
    }
  }
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
      const result = await accountService.register(values, req.tabSessionId);
      await accountService.logout(readCookie(req, getSessionCookieName("customer", req.tabSessionId)), "customer");
      writeSessionCookie(res, req, result.session, "customer", req.tabSessionId);
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
    const result = await accountService.login(values.email, values.password, req.tabSessionId);
    if (!result) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    await accountService.logout(readCookie(req, getSessionCookieName("customer", req.tabSessionId)), "customer");
    writeSessionCookie(res, req, result.session, "customer", req.tabSessionId);
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
    } catch {
      res.status(502).json({ error: "We couldn't send a verification code. Please try again shortly." });
      return;
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
    } catch {
      res.status(502).json({ error: "We couldn't send a verification code. Please try again shortly." });
      return;
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
    const result = await accountService.verifyEmailOtp(values.email, values.otp, req.tabSessionId);
    if (!result || !result.ok) {
      res.status(401).json({ error: "This verification code is invalid or has expired." });
      return;
    }
    await accountService.logout(readCookie(req, getSessionCookieName("customer", req.tabSessionId)), "customer");
    writeSessionCookie(res, req, result.session, "customer", req.tabSessionId);
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
    } catch {
      res.status(502).json({ error: "We couldn't send a verification code. Please try again shortly." });
      return;
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
    const result = await accountService.verifyEmailOtp(values.email, values.otp, req.tabSessionId);
    if (!result || !result.ok) {
      res.status(401).json({ error: "This verification code is invalid or has expired." });
      return;
    }
    await accountService.logout(readCookie(req, getSessionCookieName("customer", req.tabSessionId)), "customer");
    writeSessionCookie(res, req, result.session, "customer", req.tabSessionId);
    res.json({ ok: true, customer: result.customer });
  }));

  app.post("/api/admin/login", requireDatabase, asyncRoute(async (req, res) => {
    const values = validateFields(() => ({
      email: emailAddress(req.body?.email),
      password: validatePassword(req.body?.password, "Password")
    }), res);
    if (!values) return;
    const result = await accountService.adminLogin(values.email, values.password, req.tabSessionId);
    if (!result) {
      res.status(401).json({
        error: "Admin sign-in failed. Check the email and password, and make sure ADMIN_EMAIL and ADMIN_PASSWORD are set on the server. The configured admin password must be at least 16 characters."
      });
      return;
    }
    await accountService.logout(readCookie(req, getSessionCookieName("admin", req.tabSessionId)), "admin");
    writeSessionCookie(res, req, result.session, "admin", req.tabSessionId);
    res.json({ ok: true });
  }));

  app.post("/api/account/logout", requireDatabase, asyncRoute(async (req, res) => {
    await accountService.logout(readCookie(req, getSessionCookieName("customer", req.tabSessionId)), "customer");
    clearSessionCookie(res, req, "customer", req.tabSessionId);
    res.json({ ok: true });
  }));

  app.post("/api/admin/logout", requireDatabase, asyncRoute(async (req, res) => {
    await accountService.logout(readCookie(req, getSessionCookieName("admin", req.tabSessionId)), "admin");
    clearSessionCookie(res, req, "admin", req.tabSessionId);
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
    clearSessionCookie(res, req, "customer", req.tabSessionId);
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
    const requestedOffset = Number.parseInt(req.query.offset, 10);
    const offset = Number.isInteger(requestedOffset) ? Math.min(Math.max(requestedOffset, 0), 10000) : 0;
    const reviews = await accountService.listApprovedProductReviews(productId, 6, offset);
    res.json({
      product: { id: product.id, name: product.name },
      summary: reviewData.summary,
      featuredReviews: reviewData.featuredReviews,
      reviews,
      hasMore: offset + reviews.length < reviewData.summary.totalReviews
    });
  }));

  app.get("/api/account/orders/:id/reviews", requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ reviews: await accountService.listOrderReviews(req.accountSession, req.params.id) });
  }));

  const reviewSubmissionRateLimit = rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 12,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "You've submitted reviews too quickly. Please try again later." }
  });
  app.post("/api/account/orders/:id/reviews", reviewSubmissionRateLimit, requireDatabase, requireCustomer, requireUuidParameter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const values = validateFields(() => ({
      productId: text(body.productId, "Product", { max: 120 }),
      rating: Number(body.rating),
      reviewTitle: text(body.reviewTitle, "Review title", { required: false, max: 120 }),
      reviewText: text(body.reviewText, "Review", { required: false, max: 1000 }),
      photos: parseReviewPhotos(body.photos || [])
    }), res);
    if (!values) return;
    const { productId } = values;
    if (!productsById.has(productId)) {
      res.status(404).json({ error: "This product could not be found." });
      return;
    }
    if (![1, 2, 3, 4, 5].includes(Number(values.rating))) {
      res.status(400).json({ error: "Choose a rating between 1 and 5 stars." });
      return;
    }
    const savedPhotos = await persistReviewPhotos(values.photos);
    let review;
    try {
      review = await accountService.submitProductReview({
        productId,
        session: req.accountSession,
        reviewTitle: values.reviewTitle,
        reviewText: values.reviewText,
        rating: values.rating,
        orderId: req.params.id,
        photos: savedPhotos
      });
    } catch (error) {
      await removeReviewPhotoFiles(savedPhotos.map((photo) => photo.storageReference));
      throw error;
    }
    res.status(201).json({ review });
  }));

  app.get("/api/admin/reviews", requireDatabase, requireAdmin, asyncRoute(async (req, res) => {
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const validStatuses = new Set(["pending", "approved", "rejected", "hidden"]);
    const status = validStatuses.has(statusFilter) ? statusFilter : null;
    const reviews = await accountService.listAdminReviews(status);
    res.json({
      reviews: reviews.map((review) => ({
        ...review,
        productName: productsById.get(review.productId)?.name || review.productId
      }))
    });
  }));

  app.patch("/api/admin/reviews/:id", requireDatabase, requireAdmin, requireUuidParameter, asyncRoute(async (req, res) => {
    const body = req.body || {};
    const status = typeof body.status === "string" ? body.status.trim().toLowerCase() : null;
    if (status && !new Set(["pending", "approved", "rejected", "hidden"]).has(status)) {
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

  app.delete("/api/admin/reviews/:id", requireDatabase, requireAdmin, requireUuidParameter, asyncRoute(async (req, res) => {
    const note = typeof req.body?.adminNote === "string"
      ? text(req.body.adminNote, "Review note", { required: false, max: 400 })
      : "";
    const result = await accountService.deleteProductReview(req.params.id, note);
    if (!result) {
      res.status(404).json({ error: "Review not found." });
      return;
    }
    await removeReviewPhotoFiles(result.photoReferences);
    res.status(204).end();
  }));

  app.get("/api/review-photos/:id", requireDatabase, asyncRoute(async (req, res, next) => {
    if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(req.params.id)) {
      res.sendStatus(404);
      return;
    }
    const photo = await accountService.getReviewPhoto(req.params.id);
    if (!photo) {
      res.sendStatus(404);
      return;
    }
    const isAdmin = await hasAdminSession(req);
    if (photo.status !== "approved" && !isAdmin) {
      res.sendStatus(404);
      return;
    }
    const filename = path.basename(photo.storage_reference);
    if (!/^(?:[\da-f-]{36}|\d{10,}-[\da-f-]{36})\.(?:jpg|png|webp)$/i.test(filename)) {
      res.sendStatus(404);
      return;
    }
    res.setHeader("Cache-Control", photo.status === "approved" ? "public, max-age=300" : "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(reviewUploadDir, filename), (error) => {
      if (error) next(error);
    });
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
      const paymentStatus = optionalText(body.paymentStatus, "Payment status", 40);
      if (paymentStatus && !["Pending", "Due on delivery", "Paid", "Failed", "Refund required (manual)", "Refunded"].includes(paymentStatus)) {
        throw new Error("Choose a valid payment status.");
      }
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
        paymentStatus,
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
      const previousOrder = await accountService.getAdminOrder(req.params.id);
      const order = await accountService.updateAdminOrder(req.params.id, values);
      if (!order) {
        res.status(404).json({ error: "Order not found." });
        return;
      }
      let notificationSent = null;
      if (previousOrder?.status !== order.status) {
        try {
          notificationSent = await sendOrderStatusEmail(
            order,
            emailService,
            `${getPublicSiteOrigin()}/account.html?order=${encodeURIComponent(order.id)}`,
            values.statusNote || ""
          );
        } catch (error) {
          console.error("Order status was updated, but its customer email could not be sent:", error);
          notificationSent = false;
        }
      }
      res.json({ order, notificationSent });
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
  const values = validateFields(() => checkoutOrderValues(req.body, "UPI"), res);
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
    const savedOrder = databaseConfigured
      ? await accountService.updatePayment(order.number, "Paid", order.paymentId)
      : null;
    if (databaseConfigured && !savedOrder) {
      throw new Error("The verified Razorpay order was not found in PostgreSQL.");
    }
    const confirmedOrder = savedOrder
      ? { ...order, ...savedOrder, payment: "UPI (paid)", paymentId: order.paymentId }
      : order;
    confirmedOrder.trackingLink = savedOrder
      ? `${getPublicSiteOrigin()}/account.html?order=${encodeURIComponent(savedOrder.id)}`
      : `${getPublicSiteOrigin()}/account.html`;
    const notificationSent = await sendPaidOrderEmails(confirmedOrder, emailService, process.env.MAIL_TO);
    res.json({ ok: true, order: confirmedOrder, notificationSent });
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
    const savedOrder = databaseConfigured
      ? await accountService.updatePayment(order.number, "Paid", order.paymentId)
      : null;
    if (databaseConfigured && !savedOrder) {
      throw new Error("The verified Razorpay order was not found in PostgreSQL.");
    }
    res.json({
      ok: true,
      order: savedOrder ? { ...order, ...savedOrder, payment: "UPI (paid)", paymentId: order.paymentId } : order
    });
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

app.get("/sitemap.xml", (req, res) => {
  const siteOrigin = getSiteOrigin(req);
  const locations = sitemapPaths
    .map((page) => new URL(page, siteOrigin).href.replaceAll("&", "&amp;"))
    .map((location) => `  <url>\n    <loc>${location}</loc>\n  </url>`)
    .join("\n");
  res.type("application/xml").send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${locations}\n</urlset>\n`);
});

app.get("/llms.txt", asyncRoute(async (req, res) => {
  const template = await readFile(path.join(publicDir, "llms.txt"), "utf8");
  res.type("text/plain").send(template.replaceAll("{{SITE_ORIGIN}}", getSiteOrigin(req)));
}));

app.get("/llms-full.txt", asyncRoute(async (req, res) => {
  const template = await readFile(path.join(publicDir, "llms-full.txt"), "utf8");
  const siteOrigin = getSiteOrigin(req);
  const catalog = products.map((product) =>
    `- ${product.name.trim()} — ${product.category}, ₹${product.price}. [View the shop](${siteOrigin}/shop.html)`
  ).join("\n");
  res.type("text/plain").send(
    `${template.replaceAll("{{SITE_ORIGIN}}", siteOrigin)}\n${catalog}\n`
  );
}));

app.get([...seoPageFiles.keys()], asyncRoute(async (req, res) => {
  const pageFile = seoPageFiles.get(req.path);
  const html = await readFile(path.join(publicDir, pageFile), "utf8");
  const siteOrigin = getSiteOrigin(req).replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  res.type("html").send(html.replaceAll("{{SITE_ORIGIN}}", siteOrigin));
}));

app.use(["/account.html", "/admin.html"], (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
app.get("/uploads/reviews/:filename", requireDatabase, asyncRoute(async (req, res, next) => {
  const filename = req.params.filename;
  if (!/^(?:[\da-f-]{36}|\d{10,}-[\da-f-]{36})\.(?:jpg|png|webp)$/i.test(filename)) {
    res.sendStatus(404);
    return;
  }
  const photo = await accountService.getReviewPhotoByReference(`/uploads/reviews/${filename}`);
  if (!photo || (photo.status !== "approved" && !await hasAdminSession(req))) {
    res.sendStatus(404);
    return;
  }
  res.setHeader("Cache-Control", photo.status === "approved" ? "public, max-age=300" : "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(path.join(publicDir, "uploads", "reviews", filename), (error) => {
    if (error) next(error);
  });
}));
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
  if (String(process.env.OTP_SECRET ?? "").trim().length < 32) {
    console.warn("Email-based guest order access is unavailable until OTP_SECRET is set to a random value of at least 32 characters.");
  }
  if (!emailService.configured) {
    console.warn(emailConfigurationMessage);
  }
  if (!paymentService.configured) {
    console.warn("Razorpay is not configured. Add RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to the server environment to accept UPI payments.");
  }
});
