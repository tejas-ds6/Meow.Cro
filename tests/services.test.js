import test from "node:test";
import assert from "node:assert/strict";
import { createEmailService, emailConfigurationMessage } from "../server/email-service.js";
import { emailAddress, photoAttachment, text } from "../server/validation.js";

const emailConfiguration = {
  SMTP_HOST: "smtp.example.test",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "studio",
  SMTP_PASS: "test-only-placeholder",
  SMTP_FROM: "studio@example.test",
  MAIL_TO: "orders@example.test"
};

test("email service builds a transport from injected configuration and sends from the studio", async () => {
  let transportOptions;
  let sentMessage;
  const service = createEmailService(emailConfiguration, (options) => {
    transportOptions = options;
    return { sendMail: async (message) => { sentMessage = message; } };
  });

  assert.equal(service.configured, true);
  assert.equal(transportOptions.port, 587);
  await service.send({ to: "customer@example.test", subject: "Hello", text: "Thanks!" });
  assert.deepEqual(sentMessage, {
    from: "studio@example.test",
    to: "customer@example.test",
    subject: "Hello",
    text: "Thanks!"
  });
});

test("email service reports unconfigured transport instead of returning success", async () => {
  const service = createEmailService({});

  assert.equal(service.configured, false);
  await assert.rejects(service.send({ to: "customer@example.test" }), {
    message: emailConfigurationMessage
  });
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
