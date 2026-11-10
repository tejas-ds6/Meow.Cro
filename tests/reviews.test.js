import test from "node:test";
import assert from "node:assert/strict";
import { createAccountService } from "../server/account-service.js";

const order = {
  id: "order-1",
  number: "MC-1001",
  customer_id: "customer-1",
  customer_email: "buyer@example.com",
  name: "Trusted checkout name",
  order_status: "Delivered",
  payment_status: "Paid",
  items: [{ id: "flower-bouquet", qty: 1 }]
};

function createReviewDatabase({ duplicate = false, customerEmail = order.customer_email, paymentStatus = "Paid", status = "Delivered" } = {}) {
  const inserted = [];
  const insertedPhotos = [];
  const transactions = [];
  const matchingOrder = {
    ...order,
    customer_email: customerEmail,
    payment_status: paymentStatus,
    order_status: status
  };
  const eligible = (values) => values[0] === order.id
    && (values[1] === order.customer_id || values[2] === order.customer_email)
    && matchingOrder.order_status === "Delivered"
    && matchingOrder.payment_status === "Paid";
  return {
    inserted,
    insertedPhotos,
    transactions,
    async query(sql, values = []) {
      if (sql.includes("SELECT id, customer_id, customer_email, name, number, items")) {
        return { rows: eligible(values) ? [matchingOrder] : [] };
      }
      if (sql.includes("COUNT(*) FILTER")) {
        return {
          rows: [{
            approved_count: 24,
            average_rating: 4.8,
            rating_1: 1,
            rating_2: 2,
            rating_3: 3,
            rating_4: 6,
            rating_5: 12
          }]
        };
      }
      if (sql.includes("is_featured = TRUE")) return { rows: [] };
      if (sql.includes("SELECT pr.id, pr.rating, pr.review_title")) return { rows: [] };
      if (sql.includes("SELECT pr.id, pr.product_id, pr.status")) return { rows: [] };
      throw new Error(`Unexpected review service query: ${sql}`);
    },
    async connect() {
      return {
        async query(sql, values = []) {
          transactions.push(sql.trim().split(/\s+/)[0]);
          if (sql.includes("SELECT id, customer_id, customer_email, name, number, items")) {
            return { rows: eligible(values) ? [matchingOrder] : [] };
          }
          if (sql.includes("INSERT INTO product_reviews")) {
            inserted.push(values);
            if (duplicate) return { rows: [] };
            return {
              rows: [{
                id: values[0],
                product_id: values[1],
                customer_id: values[2],
                customer_email: values[3],
                order_id: values[4],
                customer_name: values[5],
                rating: values[6],
                review_title: values[7],
                review_text: values[8],
                status: "pending",
                is_featured: false,
                admin_note: "",
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              }]
            };
          }
          if (sql.includes("INSERT INTO product_review_photos")) {
            insertedPhotos.push(values);
            return { rows: [] };
          }
          return { rows: [] };
        },
        release() {}
      };
    }
  };
}

test("review submission uses the verified order, checkout identity, and trusted name", async () => {
  const database = createReviewDatabase();
  const service = createAccountService({ database, emailService: null, environment: {} });

  const review = await service.submitProductReview({
    productId: "flower-bouquet",
    session: { customer_id: order.customer_id, customer_email: "BUYER@example.com" },
    orderId: order.id,
    customerName: "Untrusted submitted name",
    rating: 5,
    reviewTitle: "Beautiful work",
    reviewText: "Beautifully made and lovely.",
    photos: [{ id: "photo-id", storageReference: "photo-id.jpg", url: "/api/review-photos/photo-id", altText: "Customer photo" }]
  });

  assert.equal(database.inserted[0][3], order.customer_email);
  assert.equal(database.inserted[0][4], order.id);
  assert.equal(database.inserted[0][5], order.name);
  assert.equal(database.inserted[0][6], 5);
  assert.equal(database.inserted[0][7], "Beautiful work");
  assert.equal(review.customerName, order.name);
  assert.equal(database.insertedPhotos.length, 1);
  assert.equal(database.insertedPhotos[0][2], "photo-id.jpg");
  assert.deepEqual(database.transactions, ["BEGIN", "SELECT", "INSERT", "INSERT", "COMMIT"]);
});

test("verified checkout email can review without an account session", async () => {
  const database = createReviewDatabase();
  const service = createAccountService({ database, emailService: null, environment: {} });
  const review = await service.submitProductReview({
    productId: "flower-bouquet",
    session: { customer_email: "buyer@example.com" },
    orderId: order.id,
    rating: 4,
    reviewText: "Beautifully made and lovely."
  });
  assert.equal(review.customerName, order.name);
  assert.equal(database.inserted[0][2], null);
});

test("verified email session can see its own order review state", async () => {
  let queryValues;
  const database = {
    async query(sql, values) {
      assert.match(sql, /LOWER\(BTRIM\(o\.customer_email\)\) = \$3/);
      queryValues = values;
      return {
        rows: [{
          id: "review-1",
          product_id: "flower-bouquet",
          status: "pending",
          rating: 5,
          review_title: "",
          review_text: ""
        }]
      };
    }
  };
  const service = createAccountService({ database, emailService: null, environment: {} });
  const reviews = await service.listOrderReviews({ customer_email: "BUYER@example.com" }, order.id);

  assert.deepEqual(queryValues, [order.id, null, "buyer@example.com"]);
  assert.equal(reviews[0].productId, "flower-bouquet");
  assert.equal(reviews[0].status, "pending");
});

test("review requires a paid, delivered order containing the product and owned by the session", async () => {
  const cases = [
    { session: { customer_id: "another-customer" } },
    { session: { customer_email: "another@example.com" } },
    { session: { customer_id: order.customer_id }, paymentStatus: "Pending" },
    { session: { customer_id: order.customer_id }, status: "Processing" },
    { session: { customer_id: order.customer_id }, productId: "another-product" }
  ];
  for (const testCase of cases) {
    const database = createReviewDatabase(testCase);
    const service = createAccountService({ database, emailService: null, environment: {} });
    await assert.rejects(service.submitProductReview({
      productId: testCase.productId || "flower-bouquet",
      session: testCase.session,
      orderId: order.id,
      rating: 5,
      reviewText: "Beautifully made and lovely."
    }), { status: 403 });
    assert.equal(database.inserted.length, 0);
  }
});

test("review text and title are optional when a rating is provided", async () => {
  const database = createReviewDatabase();
  const service = createAccountService({ database, emailService: null, environment: {} });
  const review = await service.submitProductReview({
    productId: "flower-bouquet",
    session: { customer_id: order.customer_id },
    orderId: order.id,
    rating: 5,
    reviewTitle: "Lovely"
  });
  assert.equal(review.reviewText, "");
  const ratingOnlyDatabase = createReviewDatabase();
  const ratingOnlyService = createAccountService({ database: ratingOnlyDatabase, emailService: null, environment: {} });
  const ratingOnly = await ratingOnlyService.submitProductReview({
    productId: "flower-bouquet",
    session: { customer_id: order.customer_id },
    orderId: order.id,
    rating: 5
  });
  assert.equal(ratingOnly.reviewTitle, "");
  assert.equal(ratingOnly.reviewText, "");
});

test("duplicate review rolls back and reports a conflict", async () => {
  const database = createReviewDatabase({ duplicate: true });
  const service = createAccountService({ database, emailService: null, environment: {} });
  await assert.rejects(service.submitProductReview({
    productId: "flower-bouquet",
    session: { customer_id: order.customer_id },
    orderId: order.id,
    rating: 4,
    reviewText: "Beautifully made and lovely."
  }), { status: 409 });
  assert.deepEqual(database.transactions, ["BEGIN", "SELECT", "INSERT", "ROLLBACK"]);
});

test("public summary returns approved distribution and public featured reviews", async () => {
  const database = {
    async query(sql) {
      if (sql.includes("COUNT(*) FILTER")) {
        assert.match(sql, /status = 'approved'/);
        assert.doesNotMatch(sql, /is_featured/);
        return {
          rows: [{
            approved_count: 24,
            average_rating: 4.8,
            rating_1: 1,
            rating_2: 2,
            rating_3: 3,
            rating_4: 6,
            rating_5: 12
          }]
        };
      }
      if (sql.includes("is_featured = TRUE")) {
        assert.match(sql, /INNER JOIN orders o ON o\.id = pr\.order_id/);
        assert.match(sql, /status = 'approved'/);
        assert.match(sql, /LIMIT 2/);
        return {
          rows: [{
            id: "review-1",
            rating: 5,
            review_title: "A favorite",
            review_text: "A lovely handmade gift.",
            created_at: "2026-10-12T00:00:00.000Z",
            order_customer_name: "Trusted checkout name",
            photos: []
          }]
        };
      }
      throw new Error(`Unexpected review summary query: ${sql}`);
    }
  };
  const service = createAccountService({ database, emailService: null, environment: {} });
  const result = await service.getProductReviewSummary("flower-bouquet");

  assert.deepEqual(result.summary, {
    totalReviews: 24,
    averageRating: 4.8,
    ratingDistribution: [
      { rating: 1, count: 1 },
      { rating: 2, count: 2 },
      { rating: 3, count: 3 },
      { rating: 4, count: 6 },
      { rating: 5, count: 12 }
    ]
  });
  assert.equal(result.featuredReviews[0].customerName, "Trusted checkout name");
  assert.equal(result.featuredReviews[0].reviewTitle, "A favorite");
});

test("hiding a featured review clears featured state and writes moderation events", async () => {
  const statements = [];
  const current = {
    id: "review-1",
    product_id: "flower-bouquet",
    customer_id: order.customer_id,
    order_id: order.id,
    customer_name: order.name,
    rating: 5,
    review_title: "A favorite",
    review_text: "A lovely handmade gift.",
    status: "approved",
    is_featured: true,
    admin_note: ""
  };
  const database = {
    async connect() {
      return {
        async query(sql, values = []) {
          statements.push({ sql, values });
          if (sql.includes("SELECT * FROM product_reviews")) return { rows: [current] };
          return { rows: [] };
        },
        release() {}
      };
    },
    async query(sql) {
      assert.match(sql, /SELECT pr\.\*/);
      return { rows: [{ ...current, status: "hidden", is_featured: false, photos: [] }] };
    }
  };
  const service = createAccountService({ database, emailService: null, environment: {} });

  const updated = await service.updateReviewModeration("review-1", {
    status: "hidden",
    adminNote: "Please review the photo",
    isFeatured: true
  });
  const auditEvents = statements.filter(({ sql }) => sql.includes("INSERT INTO product_review_moderation_events"));
  const update = statements.find(({ sql }) => sql.includes("UPDATE product_reviews SET status = $1"));

  assert.equal(updated.status, "hidden");
  assert.equal(update.values[0], "hidden");
  assert.match(update.sql, /is_featured = FALSE/);
  assert.deepEqual(auditEvents.map(({ values }) => values[2]), ["hidden", "unfeatured"]);
});

test("permanent deletion audits the action and returns photo references for cleanup", async () => {
  const statements = [];
  const database = {
    async connect() {
      return {
        async query(sql) {
          statements.push(sql);
          if (sql.includes("SELECT status FROM product_reviews")) return { rows: [{ status: "rejected" }] };
          if (sql.includes("array_agg(storage_reference)")) return { rows: [{ photo_references: ["photo-id.jpg"] }] };
          return { rows: [] };
        },
        release() {}
      };
    }
  };
  const service = createAccountService({ database, emailService: null, environment: {} });
  const deleted = await service.deleteProductReview("review-1", "Customer requested removal");
  const auditQuery = statements.find((sql) => sql.includes("INSERT INTO product_review_moderation_events"));

  assert.deepEqual(deleted, { photoReferences: ["photo-id.jpg"] });
  assert.ok(auditQuery.includes("'deleted'"));
  assert.ok(statements.some((sql) => sql.includes("DELETE FROM product_reviews")));
});
