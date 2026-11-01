import test from "node:test";
import assert from "node:assert/strict";
import { createAccountService } from "../server/account-service.js";

const order = {
  id: "order-1",
  customer_id: "customer-1",
  name: "Trusted checkout name",
  order_status: "Delivered",
  items: [{ id: "flower-bouquet", qty: 1 }]
};

function createReviewDatabase({ duplicate = false } = {}) {
  const inserted = [];
  const insertedPhotos = [];
  return {
    inserted,
    insertedPhotos,
    async query(sql, values = []) {
      if (sql.includes("SELECT id, customer_id, name, items FROM orders")) {
        return {
          rows: values[0] === order.id && values[1] === order.customer_id && order.order_status === "Delivered"
            ? [order]
            : []
        };
      }
      if (sql.includes("INSERT INTO product_reviews")) {
        inserted.push(values);
        if (duplicate) return { rows: [] };
        return {
          rows: [{
            id: values[0],
            product_id: values[1],
            customer_id: values[2],
            order_id: values[3],
            customer_name: values[4],
            rating: values[5],
            review_text: values[6],
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
      if (sql.includes("SELECT pr.product_id, pr.status FROM product_reviews")) return { rows: [] };
      throw new Error(`Unexpected review service query: ${sql}`);
    }
  };
}

test("review submission uses the authenticated customer's delivered order and trusted name", async () => {
  const database = createReviewDatabase();
  const service = createAccountService({ database, emailService: null, environment: {} });

  const review = await service.submitProductReview({
    productId: "flower-bouquet",
    customerId: order.customer_id,
    orderId: order.id,
    customerName: "Untrusted submitted name",
    rating: 5,
    reviewText: "Beautifully made and lovely.",
    photos: [{ url: "/uploads/reviews/photo.jpg", altText: "Customer photo" }]
  });

  assert.equal(database.inserted[0][3], order.id);
  assert.equal(database.inserted[0][4], order.name);
  assert.equal(review.customerName, order.name);
  assert.equal(database.insertedPhotos.length, 1);
  assert.equal(database.insertedPhotos[0][2], "/uploads/reviews/photo.jpg");
});

test("review submission rejects orders that are not delivered or owned by the account", async () => {
  const database = createReviewDatabase();
  const service = createAccountService({ database, emailService: null, environment: {} });

  await assert.rejects(service.submitProductReview({
    productId: "flower-bouquet",
    customerId: "another-customer",
    orderId: order.id,
    rating: 5,
    reviewText: "Beautifully made and lovely."
  }), { status: 403 });

  await assert.rejects(service.submitProductReview({
    productId: "another-product",
    customerId: order.customer_id,
    orderId: order.id,
    rating: 5,
    reviewText: "Beautifully made and lovely."
  }), { status: 403 });
  assert.equal(database.inserted.length, 0);
});

test("review submission rejects a duplicate review for the same order item", async () => {
  const database = createReviewDatabase({ duplicate: true });
  const service = createAccountService({ database, emailService: null, environment: {} });

  await assert.rejects(service.submitProductReview({
    productId: "flower-bouquet",
    customerId: order.customer_id,
    orderId: order.id,
    rating: 4,
    reviewText: "Beautifully made and lovely."
  }), { status: 409 });
});

test("public review summary counts all approved reviews and exposes only featured identity from order", async () => {
  const database = {
    async query(sql) {
      if (sql.includes("COUNT(*) FILTER")) {
        assert.doesNotMatch(sql, /is_featured/);
        return { rows: [{ approved_count: 24, average_rating: 4.8 }] };
      }
      if (sql.includes("is_featured = TRUE")) {
        assert.match(sql, /INNER JOIN orders o ON o\.id = pr\.order_id/);
        assert.match(sql, /LIMIT 2/);
        return {
          rows: [
            {
              rating: 5,
              review_text: "A lovely handmade gift.",
              created_at: "2026-10-12T00:00:00.000Z",
              order_customer_name: "Trusted checkout name",
              photos: []
            },
            {
              rating: 4,
              review_text: "Made with care.",
              created_at: "2026-10-10T00:00:00.000Z",
              order_customer_name: "",
              photos: []
            }
          ]
        };
      }
      throw new Error(`Unexpected review summary query: ${sql}`);
    }
  };
  const service = createAccountService({ database, emailService: null, environment: {} });
  const result = await service.getProductReviewSummary("flower-bouquet");

  assert.deepEqual(result.summary, { totalReviews: 24, averageRating: 4.8 });
  assert.equal(result.featuredReviews.length, 2);
  assert.equal(result.featuredReviews[0].customerName, "Trusted checkout name");
  assert.equal("customerId" in result.featuredReviews[0], false);
  assert.equal("orderId" in result.featuredReviews[0], false);
  assert.equal(result.featuredReviews[1].customerName, "Verified customer");
});
