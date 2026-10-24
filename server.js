import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import nodemailer from "nodemailer";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const rootDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(rootDir, "public");
const smtpPort = Number(process.env.SMTP_PORT);
const smtpConfigured = Boolean(
  process.env.SMTP_HOST &&
  Number.isInteger(smtpPort) &&
  smtpPort > 0 &&
  process.env.SMTP_USER &&
  process.env.SMTP_PASS &&
  process.env.SMTP_FROM &&
  process.env.MAIL_TO
);

const transporter = smtpConfigured
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: smtpPort,
      secure: process.env.SMTP_SECURE === "true",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    })
  : null;

const maxPhotoBytes = 5 * 1024 * 1024;
const photoTypes = {
  "image/jpeg": { extension: "jpg", matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: "png", matches: (buffer) => buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: "webp", matches: (buffer) => buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }
};

app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again in a little while." }
}));

function text(value, label, { required = true, max = 2000 } = {}) {
  if (typeof value !== "string") {
    if (!required && (value === undefined || value === null || value === "")) return "";
    throw new Error(`${label} is required.`);
  }
  const trimmed = value.trim();
  if (required && !trimmed) throw new Error(`${label} is required.`);
  if (trimmed.length > max) throw new Error(`${label} is too long.`);
  return trimmed;
}

function emailAddress(value) {
  const email = text(value, "Email address", { max: 254 });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

function photoAttachment(value) {
  const dataUrl = text(value, "Reference photo", {
    required: false,
    max: Math.ceil(maxPhotoBytes / 3) * 4 + 64
  });
  if (!dataUrl) return null;

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new Error("Upload a valid JPG, PNG, or WebP photo.");

  const [, contentType, encoded] = match;
  const content = Buffer.from(encoded, "base64");
  if (content.length > maxPhotoBytes) throw new Error("Your photo must be 5 MB or smaller.");
  if (content.toString("base64") !== encoded || !photoTypes[contentType].matches(content)) {
    throw new Error("Upload a valid JPG, PNG, or WebP photo.");
  }

  return {
    filename: `reference-photo.${photoTypes[contentType].extension}`,
    content,
    contentType
  };
}

function validateFields(validator, res) {
  try {
    return validator();
  } catch (error) {
    res.status(400).json({ error: error.message });
    return null;
  }
}

async function sendStudioEmail(message, res) {
  if (!transporter) {
    res.status(503).json({
      error: "Email is not configured. Add your SMTP settings to the .env file and restart the server."
    });
    return;
  }

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.MAIL_TO,
      ...message
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("SMTP delivery failed:", error);
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

app.post("/api/orders", express.json({ limit: "32kb" }), async (req, res) => {
  const values = validateFields(() => {
    const body = req.body || {};
    const email = emailAddress(body.email);
    const phone = text(body.phone, "Phone number", { max: 30 });
    if (!/^[0-9+()\-\s]{7,30}$/.test(phone)) throw new Error("Enter a valid phone number.");
    if (!/^\d{6}$/.test(text(body.pin, "PIN code", { max: 6 }))) {
      throw new Error("Enter a valid 6-digit PIN code.");
    }
    if (!["Cash on delivery", "UPI"].includes(body.payment)) {
      throw new Error("Choose a valid payment method.");
    }
    const number = text(body.number, "Order number", { max: 40 });
    if (!/^CR-\d{7}$/.test(number)) throw new Error("Order number is invalid.");
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 30) {
      throw new Error("Your bag doesn't contain valid items.");
    }

    const items = body.items.map((item) => {
      const name = text(item?.name, "Product name", { max: 120 });
      const qty = Number(item?.qty);
      const unitPrice = Number(item?.unitPrice);
      if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error("A product quantity is invalid.");
      if (!Number.isFinite(unitPrice) || unitPrice < 0 || unitPrice > 1000000) {
        throw new Error("A product price is invalid.");
      }
      return { name, qty, unitPrice };
    });

    const subtotal = items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    const shipping = subtotal > 599 ? 0 : 29;
    return {
      name: text(body.name, "Name", { max: 120 }),
      email,
      phone,
      address: text(body.address, "Street address", { max: 300 }),
      city: text(body.city, "City", { max: 100 }),
      pin: body.pin,
      note: text(body.note, "Note", { required: false, max: 1000 }),
      payment: body.payment,
      number,
      items,
      subtotal,
      shipping,
      total: subtotal + shipping
    };
  }, res);
  if (!values) return;

  if (!transporter) {
    res.status(503).json({
      error: "Email is not configured. Add your SMTP settings to the .env file and restart the server."
    });
    return;
  }

  const items = values.items.map((item) => `- ${item.name} x ${item.qty} — ₹${item.unitPrice * item.qty}`);
  const orderDetails = [
    `Order: ${values.number}`,
    `Name: ${values.name}`,
    `Email: ${values.email}`,
    `Phone: ${values.phone}`,
    `Address: ${values.address}, ${values.city} ${values.pin}`,
    `Payment preference: ${values.payment}`,
    "",
    "Items:",
    ...items,
    "",
    `Subtotal: ₹${values.subtotal}`,
    `Shipping: ${values.shipping ? `₹${values.shipping}` : "Free"}`,
    `Estimated total: ₹${values.total}`,
    `Note: ${values.note || "None"}`,
    "",
    "This is a demo checkout; payment has not been collected."
  ].join("\n");

  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: process.env.MAIL_TO,
      replyTo: values.email,
      subject: `New Meow.Cro order ${values.number}`,
      text: orderDetails
    });
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: values.email,
      subject: `Order confirmation ${values.number} — Meow.Cro`,
      text: [
        `Hi ${values.name},`,
        "",
        `Thank you for placing order ${values.number} with Meow.Cro!`,
        "",
        ...items,
        "",
        `Subtotal: ₹${values.subtotal}`,
        `Shipping: ${values.shipping ? `₹${values.shipping}` : "Free"}`,
        `Estimated total: ₹${values.total}`,
        `Payment preference: ${values.payment}`,
        `Delivery address: ${values.address}, ${values.city} ${values.pin}`,
        "",
        "This is a demo checkout; payment has not been collected. Our studio will be in touch to confirm your order.",
        "",
        "Made slowly, with love,",
        "Meow.Cro Studio"
      ].join("\n")
    });
    res.json({ ok: true });
  } catch (error) {
    console.error("SMTP order email delivery failed:", error);
    res.status(502).json({ error: "We couldn't send the order email right now. Please try again shortly." });
  }
});

app.use(express.static(publicDir));

app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "The request is too large. Please upload a photo up to 5 MB." });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "The request body must be valid JSON." });
  }
  console.error("Request failed:", error);
  return res.status(500).json({ error: "Something went wrong. Please try again." });
});

app.listen(port, () => {
  console.log(`Meow.Cro is running at http://localhost:${port}`);
  if (!smtpConfigured) console.warn("SMTP is not configured; form submissions will return an error until .env is set.");
});
