import { createHash, randomBytes, randomUUID } from "node:crypto";

const quoteLifetimeDays = 14;

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function safeRequest(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    whatsapp: row.whatsapp,
    idea: row.idea,
    details: row.details,
    budget: row.budget === null ? null : Number(row.budget),
    neededBy: row.needed_by,
    hasReferencePhoto: Boolean(row.reference_photo),
    referencePhotoType: row.reference_photo_type,
    status: row.status,
    quotedAmount: row.quoted_amount === null ? null : Number(row.quoted_amount),
    adminNote: row.admin_note,
    quoteExpiresAt: row.quote_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createCustomOrderService({ database }) {
  async function createRequest(request) {
    const result = await database.query(
      `INSERT INTO custom_order_requests (
        id, name, email, whatsapp, idea, details, budget, needed_by,
        reference_photo, reference_photo_type, reference_photo_name
      ) VALUES ($1, $2, LOWER(BTRIM($3)), $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        randomUUID(), request.name, request.email, request.whatsapp, request.idea,
        request.details, request.budget || null, request.neededBy || null,
        request.photo?.content || null, request.photo?.contentType || null, request.photo?.filename || null
      ]
    );
    return safeRequest(result.rows[0]);
  }

  async function listAdminRequests() {
    const result = await database.query(
      "SELECT * FROM custom_order_requests ORDER BY created_at DESC LIMIT 500"
    );
    return result.rows.map(safeRequest);
  }

  async function getReferencePhoto(id) {
    const result = await database.query(
      `SELECT reference_photo, reference_photo_type, reference_photo_name
       FROM custom_order_requests WHERE id = $1 AND reference_photo IS NOT NULL`,
      [id]
    );
    return result.rows[0] || null;
  }

  async function offer(id, amount, adminNote) {
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + quoteLifetimeDays * 24 * 60 * 60 * 1000);
    const result = await database.query(
      `WITH updated_request AS (
       UPDATE custom_order_requests
       SET status = 'offered', quoted_amount = $2, admin_note = $3,
           quote_token_hash = $4, quote_expires_at = $5, updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'offered')
       RETURNING *
      ), invalidated_orders AS (
       UPDATE orders SET razorpay_order_id = NULL, subtotal = $2, total = $2,
         items = jsonb_build_array(jsonb_build_object(
           'productId', 'custom-' || $1::text,
           'name', 'Custom crochet order',
           'qty', 1,
           'unitPrice', $2,
           'variant', LEFT((SELECT idea FROM updated_request), 160),
           'customDescription', (
             SELECT idea || CASE WHEN details = '' THEN '' ELSE E'\\nDetails: ' || details END
             FROM updated_request
           )
         )), updated_at = NOW()
       WHERE custom_order_id = $1 AND payment_status <> 'Paid'
         AND EXISTS (SELECT 1 FROM updated_request)
       RETURNING id
      )
      SELECT * FROM updated_request`,
      [id, amount, adminNote, hashToken(token), expiresAt]
    );
    if (!result.rows[0]) return null;
    return { request: safeRequest(result.rows[0]), token };
  }

  async function reject(id, adminNote) {
    const result = await database.query(
      `UPDATE custom_order_requests
       SET status = 'rejected', admin_note = $2, quote_token_hash = NULL,
           quote_expires_at = NULL, updated_at = NOW()
       WHERE id = $1 AND status IN ('pending', 'rejected')
       RETURNING *`,
      [id, adminNote]
    );
    return result.rows[0] ? safeRequest(result.rows[0]) : null;
  }

  async function getOffer(token) {
    const result = await database.query(
      `SELECT id, name, email, whatsapp, idea, details, quoted_amount, admin_note, quote_expires_at
       FROM custom_order_requests
       WHERE quote_token_hash = $1 AND status = 'offered' AND quote_expires_at > NOW()`,
      [hashToken(token)]
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      whatsapp: row.whatsapp,
      idea: row.idea,
      details: row.details,
      quotedAmount: Number(row.quoted_amount),
      adminNote: row.admin_note,
      expiresAt: row.quote_expires_at
    };
  }

  return { createRequest, listAdminRequests, getReferencePhoto, offer, reject, getOffer };
}
