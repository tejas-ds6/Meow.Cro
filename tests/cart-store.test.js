import test from "node:test";
import assert from "node:assert/strict";
import { createCartStore } from "../public/cart-store.js";
import { getProduct, imageUrl, products } from "../public/catalog.js";

class MemoryStorage {
  #values = new Map();

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, value);
  }
}

function createStore(initialItems = []) {
  const storage = new MemoryStorage();
  storage.setItem("crosia-cart", JSON.stringify(initialItems));
  return { storage, store: createCartStore({ storage, getProduct }) };
}

test("catalog product IDs are unique and resolve to the intended products", () => {
  assert.equal(new Set(products.map((product) => product.id)).size, products.length);
  assert.equal(getProduct("Sunflower").name, "Shine Forever");
  assert.equal(getProduct("sunflower-bookmark").name, "Sunflower Bookmark");
});

test("cart additions, quantity changes and totals remain consistent", () => {
  const { storage, store } = createStore();

  assert.equal(store.add("daisy-bookmark"), "added");
  assert.equal(store.add("daisy-bookmark"), "added");
  assert.equal(store.quantity(), 2);
  assert.equal(store.total(), 298);
  assert.deepEqual(store.items, [{ id: "daisy-bookmark", qty: 2 }]);
  assert.deepEqual(JSON.parse(storage.getItem("crosia-cart")), store.items);

  assert.equal(store.changeQuantity("daisy-bookmark", -1), true);
  assert.equal(store.quantity(), 1);
  assert.equal(store.remove("daisy-bookmark"), true);
  assert.equal(store.quantity(), 0);
});

test("cart ignores invalid saved items and caps quantities at the checkout limit", () => {
  const { store } = createStore([
    { id: "unknown-product", qty: 2 },
    { id: "daisy-bookmark", qty: 0 },
    { id: "daisy-bookmark", qty: 80 },
    { id: "daisy-bookmark", qty: 40 }
  ]);

  assert.deepEqual(store.items, [{ id: "daisy-bookmark", qty: 99 }]);
  assert.equal(store.add("daisy-bookmark"), "limit");
  assert.equal(store.add("unknown-product"), "missing");
  assert.equal(store.changeQuantity("daisy-bookmark", 1), true);
  assert.equal(store.items[0].qty, 99);
});

test("cart snapshots cannot mutate stored state", () => {
  const { store } = createStore([{ id: "daisy-bookmark", qty: 1 }]);
  const snapshot = store.items;
  snapshot[0].qty = 8;

  assert.equal(store.items[0].qty, 1);
});

test("cart storage failures are reported while the in-memory cart remains usable", () => {
  const errors = [];
  const store = createCartStore({
    storage: {
      getItem() { throw new Error("storage unavailable"); },
      setItem() { throw new Error("storage unavailable"); }
    },
    getProduct,
    onStorageError: (error, operation) => errors.push({ error, operation })
  });

  assert.equal(store.add("daisy-bookmark"), "added");
  assert.equal(store.quantity(), 1);
  assert.deepEqual(errors.map(({ operation }) => operation), ["read", "write"]);
});

test("image URLs add CDN parameters only to remote images", () => {
  assert.equal(imageUrl("./Images/book marker.png"), "./Images/book marker.png");

  const image = new URL(imageUrl("https://images.pexels.com/photo.jpeg?fit=crop", 180));
  assert.equal(image.searchParams.get("fit"), "crop");
  assert.equal(image.searchParams.get("w"), "180");
  assert.equal(image.searchParams.get("cs"), "tinysrgb");
});
