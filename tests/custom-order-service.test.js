import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createCustomOrderService } from "../server/custom-order-service.js";

function requestRow(values) {
  const [id, name, email, whatsapp, idea, details, budget, neededBy, photo, photoType, photoName] = values;
  return {
    id, name, email, whatsapp, idea, details, budget, needed_by: neededBy,
    reference_photo: photo, reference_photo_type: photoType, reference_photo_name: photoName,
    status: "pending", quoted_amount: null, admin_note: "", quote_token_hash: null,
    quote_expires_at: null, created_at: new Date(), updated_at: new Date()
  };
}

test("custom order requests are stored with reference photos and safe admin fields", async () => {
  let inserted;
  const database = {
    async query(sql, values) {
      if (sql.includes("INSERT INTO custom_order_requests")) {
        inserted = requestRow(values);
        return { rows: [inserted] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  const service = createCustomOrderService({ database });
  const photo = { content: Buffer.from("photo"), contentType: "image/png", filename: "reference.png" };
  const saved = await service.createRequest({
    name: "Buyer", email: "Buyer@Example.test", whatsapp: "+91 98765 43210",
    idea: "A small flower", details: "Lilac", budget: "500", neededBy: "2026-12-01", photo
  });

  assert.equal(inserted.email, "Buyer@Example.test");
  assert.deepEqual(inserted.reference_photo, photo.content);
  assert.equal(saved.hasReferencePhoto, true);
  assert.equal(saved.referencePhotoType, "image/png");
  assert.equal("reference_photo" in saved, false);
});

test("admin custom request listing excludes photo bytes but retains photo availability", async () => {
  let sql;
  const database = {
    async query(statement) {
      sql = statement;
      return {
        rows: [{
          id: "request-id", name: "Buyer", email: "buyer@example.test", whatsapp: "9876543210",
          idea: "A small flower", details: "", budget: null, needed_by: null,
          has_reference_photo: true, reference_photo_type: "image/png",
          status: "pending", quoted_amount: null, admin_note: "", quote_expires_at: null,
          created_at: new Date(), updated_at: new Date()
        }]
      };
    }
  };
  const [request] = await createCustomOrderService({ database }).listAdminRequests();

  assert.match(sql, /reference_photo IS NOT NULL/);
  assert.doesNotMatch(sql, /SELECT \*/);
  assert.equal(request.hasReferencePhoto, true);
  assert.equal("reference_photo" in request, false);
});

test("custom order offers use expiring hashed tokens and can be reissued", async () => {
  const queries = [];
  const database = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (sql.includes("UPDATE custom_order_requests")) {
        return {
          rows: [{
            id: values[0], name: "Buyer", email: "buyer@example.test", whatsapp: "9876543210",
            idea: "A small flower", details: "", budget: null, needed_by: null,
            reference_photo: null, reference_photo_type: null, status: "offered",
            quoted_amount: values[1], admin_note: values[2], quote_token_hash: values[3],
            quote_expires_at: values[4], created_at: new Date(), updated_at: new Date()
          }]
        };
      }
      if (sql.includes("UPDATE orders SET razorpay_order_id")) return { rows: [] };
      if (sql.includes("FROM custom_order_requests") && sql.includes("quote_token_hash")) {
        return values[0] === expectedOfferHash
          ? { rows: [{
            id: "request-id", name: "Buyer", email: "buyer@example.test", whatsapp: "9876543210",
            idea: "A small flower", details: "", quoted_amount: 750, admin_note: "Ready in two weeks.",
            quote_expires_at: new Date(Date.now() + 60_000)
          }] }
          : { rows: [] };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  let expectedOfferHash = "";
  const service = createCustomOrderService({ database });
  const first = await service.offer("request-id", 750, "Ready in two weeks.");
  assert.ok(first.token);
  assert.equal("quoteTokenHash" in first.request, false);
  assert.equal(first.request.quotedAmount, 750);
  assert.equal(first.request.status, "offered");
  assert.ok(first.request.quoteExpiresAt > new Date());
  assert.ok(first.request.quoteExpiresAt <= new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  assert.ok(first.request.quoteExpiresAt >= new Date(Date.now() + 6 * 24 * 60 * 60 * 1000 + 23 * 60 * 60 * 1000));
  assert.match(queries[0].sql, /quote_token_hash = \$4/);
  assert.equal(queries[0].values[3], createHash("sha256").update(first.token).digest("hex"));

  expectedOfferHash = hashToken(first.token);
  const offer = await service.getOffer(first.token);
  assert.equal(offer.id, "request-id");
  assert.equal(offer.quotedAmount, 750);
  assert.equal(offer.email, "buyer@example.test");
  assert.equal(await service.getOffer("not-the-token"), null);

  const revised = await service.offer("request-id", 825, "Updated materials.");
  assert.notEqual(revised.token, first.token);
  assert.equal(revised.request.quotedAmount, 825);
  assert.ok(queries.some(({ sql }) => sql.includes("UPDATE orders SET razorpay_order_id")));
});

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
