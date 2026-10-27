import test from "node:test";
import assert from "node:assert/strict";
import { createEmailService, emailConfigurationMessage } from "../server/email-service.js";
import { emailAddress, photoAttachment, text } from "../server/validation.js";

const emailConfiguration = {
  RESEND_API_KEY: "test-only-placeholder",
  SMTP_FROM: "studio@example.test",
  MAIL_TO: "orders@example.test"
};

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
  assert.deepEqual(sentMessage, {
    from: "studio@example.test",
    to: "customer@example.test",
    replyTo: "reply@example.test",
    subject: "Hello",
    text: "Thanks!",
    attachments: [{ filename: "reference.jpg", content: Buffer.from([1, 2, 3]), contentType: "image/jpeg" }]
  });
  assert.deepEqual(result, { id: "email_123" });
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
