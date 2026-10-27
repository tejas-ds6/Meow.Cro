const maximumQuantity = 99;

export function createCartStore({ storage, getProduct, onStorageError = console.error, storageKey = "crosia-cart" }) {
  let items = [];

  try {
    const savedItems = JSON.parse(storage.getItem(storageKey) || "[]");
    if (Array.isArray(savedItems)) {
      const quantities = new Map();
      savedItems.forEach((item) => {
        if (!item || !getProduct(item.id) || !Number.isInteger(item.qty) || item.qty < 1) return;
        quantities.set(item.id, Math.min(maximumQuantity, (quantities.get(item.id) || 0) + item.qty));
      });
      items = [...quantities].map(([id, qty]) => ({ id, qty }));
    }
  } catch (error) {
    onStorageError(error, "read");
  }

  function persist() {
    try {
      storage.setItem(storageKey, JSON.stringify(items));
      return true;
    } catch (error) {
      onStorageError(error, "write");
      return false;
    }
  }

  return Object.freeze({
    get items() {
      return items.map((item) => ({ ...item }));
    },

    quantity() {
      return items.reduce((total, item) => total + item.qty, 0);
    },

    total() {
      return items.reduce((total, item) => total + getProduct(item.id).price * item.qty, 0);
    },

    add(id) {
      if (!getProduct(id)) return "missing";
      const item = items.find((entry) => entry.id === id);
      if (item?.qty >= maximumQuantity) return "limit";
      if (item) item.qty += 1;
      else items.push({ id, qty: 1 });
      persist();
      return "added";
    },

    changeQuantity(id, change) {
      if (!Number.isInteger(change) || change === 0) return false;
      const item = items.find((entry) => entry.id === id);
      if (!item) return false;
      item.qty = Math.min(maximumQuantity, item.qty + change);
      if (item.qty <= 0) items = items.filter((entry) => entry.id !== id);
      persist();
      return true;
    },

    remove(id) {
      const updatedItems = items.filter((item) => item.id !== id);
      if (updatedItems.length === items.length) return false;
      items = updatedItems;
      persist();
      return true;
    },

    clear() {
      if (!items.length) return false;
      items = [];
      persist();
      return true;
    }
  });
}
