const products = [
  { id: "daisy-bookmark", name: "Lazy Daisy Reader", category: "Accessories", price: 149, label: "A little favorite", color: "Buttercream", image: "./Images/book marker.png", alt: "A handmade crochet bookmarker with floral embroidery", featured: true },
  { id: "flower-bouquet", name: "Pocketful of Posies", category: "Bouquet", price: 499, label: "Happiness, bundled", color: "Garden mix", image: "./Images/Flower Bouquet.jpeg", alt: "A colorful bouquet of crocheted flowers arranged in a vase", featured: true },
  { id: "doll-pal", name: "Little Doll Pal", category: "dolls", price: 499, label: "A tiny best friend", color: "Blush pink with buttercream", image: "./Images/Crocheted Doll in Garden Bokeh.png", alt: "A handmade crocheted plush doll with orange accents", featured: true },
  { id: "flower keychain", name: "Daisy flower", category: "keychain", price: 99, label: "One of a kind", color: "Sunset patchwork", image: "./Images/white flower keychain.jpeg", alt: "A colorful crochet daisy flower", featured: true },
  { id: "tulip flower", name: "Tulip single flower", category: "Bouquet", price: 199, label: "Perfect for handmade Gift", color: "white", image: "./Images/tulip flower bouquet.jpeg", alt: "Crochet coasters beside a cozy cup of tea", featured: false },
  { id: "tiny-cactus", name: "Little Window Cactus", category: "Home", price: 169, label: "A plant that stays", color: "Sage", image: "https://images.pexels.com/photos/15521699/pexels-photo-15521699/free-photo-of-a-crocheted-flower-in-a-pot.jpeg", alt: "A cheerful crocheted flower in a little pot", featured: false },
  { id: "mushroom-pal", name: "Little Mushroom Pal (pack of 2)", category: "Plushies", price: 149, label: "Pocket-sized magic", color: "Tomato red", image: "https://images.pexels.com/photos/40233232/pexels-photo-40233232/free-photo-of-colorful-crochet-mushroom-decorations-hanging-display.jpeg", alt: "Colorful handmade crochet mushrooms", featured: false },
  { id: "hearty-scrunchie", name: "Hearty Scrunchie", category: "Accessories", price: 149, label: "A little lift", color: "Buttercreamy Red", image: "./Images/Scrunchie.jpeg", alt: "A cheerful collection of handmade crochet scrunchies", featured: false },
  { id: "Cutie bookmarker", name: "Cutie Bookmarkers (pack of 3)", category: "Accessories", price: 49, label: "For little treasures", color: "Multicolors", image: "./Images/cutie bookmarkers.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Strawberry keychain", name: "Berrybow ", category: "keychain", price: 99, label: "Cutie and playfull", color: "Blush pink", image: "./Images/strawberry keychain.jpeg", alt: "berry berry", featured: false },
  { id: "Flower Belt", name: "Blossom Babe", category: "Accessories", price: 199, label: "Cutie and trendy", color: "Multicolors", image: "./Images/flower Belt.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "love Bouquet", name: "Forever Bloom", category: "Bouquet", price: 299, label: "Blush Heart Bloom", color: "babe pink", image: "./Images/love Bouquet.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Chicken", name: "Chickey ", category: "keychain", price: 169, label: "cutie chick", color: "yellow", image: "./Images/57a8e36140b521e75c241d75048cb09b.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "cherry", name: "Cozy Cherry", category: "keychain", price: 99, label: "Red Cherry", color: "Cherry Red", image: "./Images/689b66701cb8f27fed58a569fa30c11d.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "lily Bell", name: "Lily Bells", category: "keychain", price: 99, label: "Blush bells", color: "Rose Pink", image: "./Images/980adc50311429d7f9fa12a24418b05d.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Sunflower", name: "Shine Forever", category: "Bouquet", price: 199, label: "Love Towards You", color: "Golden Yellow", image: "./Images/IMG_20261021_104146.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "love", name: "Lovely Heart", category: "keychain", price: 99, label: "Heart Blooms", color: "Multicolors", image: "./Images/04832f24b7638ccb27da60b3c411ab87.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Rose", name: "Red Rose", category: "Bouquet", price: 299, label: "Loved by Everyone", color: "Ruby Red", image: "./Images/a5dc754f877cca1223d773fbbefa53f6.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Sunflower", name: "Sunflower Bookmark", category: "Accessories", price: 149, label: "Loved to everypage", color: "Golden Yellow", image: "./Images/c88e164ad749b4d8cf944c1272475684.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "bouquet", name: "Bouquet Keychain (Pack of 1)", category: "keychain", price: 149, label: "Memories Last Forever", color: "Multicolor", image: "./Images/cc372b61a1089cb558df65f4622d08d9.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Jelly keychain", name: "Jellybean Jr.", category: "keychain", price: 129, label: "Tiny Ocean Buddy", color: "Ocean blue", image: "./Images/d1777327326619c6db88d2de54cc7a22.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Party flowers", name: "Petal Pop Party ( pack of 1 set)", category: "Home", price: 99, label: "Bloom Squad", color: "Multicolor", image: "./Images/f598242354ded9935d0ec607a808a8b0.jpg.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Airpods", name: "AirPoddy in Love", category: "Accessories", price: 199, label: "Pocket Crush", color: "Cream Pinky", image: "./Images/file_00000000a45c82119e6b612c88285066.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Earbud", name: "Lovepod", category: "Accessories", price: 199, label: "Soft Little Love", color: "Green", image: "./Images/IMG_4215.JPG.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Sun keychain", name: "Sunbunni", category: "keychain", price: 149, label: "Sunshine Club", color: "Golden Yellow", image: "./Images/file_00000000f6548211bf79c98d55f47ae4.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Hut", name: "Love Hut pod", category: "Accessories", price: 199, label: "Fairycore Finds", color: "beach + orange", image: "./Images/IMG_4214.JPG.jpeg", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "chick swag", name: "Car Charm", category: "Home", price: 149, label: "Little Weirdos", color: "Yellow", image: "./Images/Crocheted Chick Car Charm.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Shades", name: "Shade Slay-er", category: "Accessories", price: 199, label: "Soft Armor", color: "pink shade", image: "./Images/Pink Crocheted Sunglasses Pouch.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "Bestie", name: "Bowzilla", category: "keychain", price: 149, label: "Coquette Chaos", color: "babe pink", image: "./Images/pink_bow_keychain_hd.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "lilly", name: "Lilypad Diva", category: "Bouquet", price: 299, label: "Petal Princess", color: "babe pink", image: "./Images/pink_crochet_lily_hd.png", alt: "A close-up of a carefully handmade crochet", featured: false },
  { id: "tulip me", name: "Tulip Me Crazy", category: "keychain", price: 149, label: "Pocket Garden", color: "Mesmorize colors", image: "./Images/tulip_bouquet_keychain_hd.png", alt: "A close-up of a carefully handmade crochet", featured: false }

];

const imageUrl = (url, width = 720) => `${url}?auto=compress&cs=tinysrgb&w=${width}`;
const formatPrice = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
const cartStorageKey = "crosia-cart";
const orderStorageKey = "crosia-last-order";
const getProduct = (id) => products.find((product) => product.id === id);
const readStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.error(`Unable to read Crosia storage key "${key}".`, error);
    return fallback;
  }
};

let cart = readStorage(cartStorageKey, []);
if (!Array.isArray(cart)) cart = [];

function saveCart() {
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify(cart));
  } catch (error) {
    console.error("Unable to save your Crosia bag.", error);
    showToast("Your bag couldn't be saved in this browser. Please keep this tab open.");
  }
}

function cartQuantity() {
  return cart.reduce((sum, item) => sum + (Number.isInteger(item.qty) && item.qty > 0 ? item.qty : 0), 0);
}

function cartTotal() {
  return cart.reduce((sum, item) => {
    const product = getProduct(item.id);
    return sum + (product && Number.isInteger(item.qty) ? product.price * item.qty : 0);
  }, 0);
}

function showToast(message) {
  const region = document.querySelector(".toast-region");
  if (!region) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  region.append(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  window.setTimeout(() => {
    toast.classList.remove("toast-visible");
    window.setTimeout(() => toast.remove(), 300);
  }, 2600);
}

async function postEmail(endpoint, values) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(values)
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The email service returned an invalid response. Check that the Node server is running.");
  }
  if (!response.ok) throw new Error(result.error || "We couldn't send that just now. Please try again.");
  return result;
}

function renderProductCard(product, index) {
  return `<article class="product-card reveal" style="--reveal-delay:${(index % 4) * 75}ms">
    <button class="product-image-button" type="button" data-view="${product.id}" aria-label="See ${product.name}">
      <img src="${imageUrl(product.image)}" alt="${product.alt}" loading="lazy"><span class="product-badge">${product.label}</span>
      <span class="quick-view">A closer look <span>↗</span></span>
    </button>
    <div class="product-card-info"><div><h3><button class="product-name-button" type="button" data-view="${product.id}">${product.name}</button></h3><p>${product.category} <span>·</span> ${product.color}</p></div><strong>${formatPrice(product.price)}</strong></div>
    <div class="product-card-bottom"><button class="add-button" type="button" data-add="${product.id}" aria-label="Add ${product.name} to your bag">Add to bag <span>+</span></button></div>
  </article>`;
}

function observeReveals(root = document) {
  const items = root.querySelectorAll(".reveal:not(.is-visible)");
  if (!("IntersectionObserver" in window)) {
    items.forEach((item) => item.classList.add("is-visible"));
    return;
  }
  const observer = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -25px 0px" });
  items.forEach((item) => observer.observe(item));
}

function renderProducts(filter = "All", sort = "popular", search = "") {
  document.querySelectorAll("[data-products]").forEach((container) => {
    const isFeatured = container.dataset.products === "featured";
    let visible = products.filter((product) => (!isFeatured || product.featured) &&
      (filter === "All" || product.category === filter) &&
      `${product.name} ${product.category} ${product.color}`.toLowerCase().includes(search.toLowerCase()));
    if (sort === "low") visible.sort((a, b) => a.price - b.price);
    if (sort === "high") visible.sort((a, b) => b.price - a.price);
    container.innerHTML = visible.map(renderProductCard).join("");
    observeReveals(container);
    const empty = document.querySelector(".empty-filter");
    if (empty) empty.hidden = visible.length > 0;
  });
}

function renderCart() {
  const validItems = cart.filter((item) => getProduct(item.id) && Number.isInteger(item.qty) && item.qty > 0);
  if (validItems.length !== cart.length) {
    cart = validItems;
    saveCart();
  }
  const count = cartQuantity();
  document.querySelectorAll(".bag-count").forEach((element) => {
    element.textContent = count;
    element.classList.toggle("count-pop", count > 0);
  });
  document.querySelectorAll(".drawer-count").forEach((element) => element.textContent = `(${count})`);
  document.querySelectorAll(".cart-subtotal strong").forEach((element) => element.textContent = formatPrice(cartTotal()));
  document.querySelectorAll(".cart-items").forEach((container) => {
    container.innerHTML = cart.map((item) => {
      const product = getProduct(item.id);
      if (!product) return "";
      return `<article class="cart-line"><img src="${imageUrl(product.image, 180)}" alt="" loading="lazy"><div class="cart-line-info"><h3>${product.name}</h3><span>${formatPrice(product.price)}</span><div class="quantity-control"><button type="button" data-qty="${product.id}" data-change="-1" aria-label="Remove one ${product.name}">−</button><span>${item.qty}</span><button type="button" data-qty="${product.id}" data-change="1" aria-label="Add one ${product.name}">+</button></div></div><button class="remove-item" type="button" data-remove="${product.id}" aria-label="Remove ${product.name} from your bag">×</button></article>`;
    }).join("");
  });
  document.querySelectorAll(".cart-empty").forEach((element) => element.hidden = count > 0);
  document.querySelectorAll(".cart-bottom").forEach((element) => element.hidden = count === 0);
  const drawer = document.querySelector(".cart-drawer");
  if (drawer) drawer.classList.toggle("cart-has-items", count > 0);
  let floatingCheckout = document.querySelector(".floating-checkout");
  if (!floatingCheckout) {
    floatingCheckout = document.createElement("a");
    floatingCheckout.className = "floating-checkout";
    floatingCheckout.href = "order.html";
    floatingCheckout.setAttribute("aria-label", "Go to checkout");
    document.body.append(floatingCheckout);
  }
  floatingCheckout.hidden = count === 0 || Boolean(document.querySelector("#checkout-form"));
  floatingCheckout.textContent = `Checkout · ${count} ${count === 1 ? "item" : "items"} · ${formatPrice(cartTotal())} →`;
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const target = document.querySelector(".checkout-items");
  if (!target) return;
  if (!cartQuantity()) {
    target.innerHTML = `<div class="checkout-empty"><span>✿</span><p>Your bag is taking a little nap.</p><a href="shop.html">Browse the little things →</a></div>`;
    document.querySelector(".place-order")?.setAttribute("disabled", "disabled");
    document.querySelector(".summary-subtotal").textContent = formatPrice(0);
    document.querySelector(".summary-grand-total").textContent = formatPrice(0);
    return;
  }
  document.querySelector(".place-order")?.removeAttribute("disabled");
  target.innerHTML = cart.map((item) => {
    const product = getProduct(item.id);
    return `<div class="checkout-line"><div class="checkout-line-image"><img src="${imageUrl(product.image, 190)}" alt="" loading="lazy"><span>${item.qty}</span></div><div class="checkout-line-name"><strong>${product.name}</strong><small>${product.color}</small></div><strong>${formatPrice(product.price * item.qty)}</strong></div>`;
  }).join("");
  const subtotal = cartTotal();
  const shipping = subtotal > 599 ? 0 : 29;
  document.querySelector(".summary-subtotal").textContent = formatPrice(subtotal);
  document.querySelector(".summary-shipping").textContent = shipping === 0 ? "On us ♡" : formatPrice(shipping);
  document.querySelector(".summary-grand-total").textContent = formatPrice(subtotal + shipping);
}

function addToCart(id) {
  const item = cart.find((entry) => entry.id === id);
  if (item) item.qty += 1;
  else cart.push({ id, qty: 1 });
  saveCart();
  renderCart();
  showToast(`${getProduct(id).name} is in your bag ♡`);
  document.querySelector(".bag-button")?.classList.add("bag-bump");
  window.setTimeout(() => document.querySelector(".bag-button")?.classList.remove("bag-bump"), 420);
}

function changeQuantity(id, change) {
  const item = cart.find((entry) => entry.id === id);
  if (!item) return;
  item.qty += change;
  if (item.qty <= 0) cart = cart.filter((entry) => entry.id !== id);
  saveCart();
  renderCart();
}

function openCart() {
  document.querySelector(".cart-drawer")?.classList.add("drawer-open");
  document.querySelector(".drawer-scrim")?.classList.add("scrim-visible");
  document.querySelector(".cart-drawer")?.setAttribute("aria-hidden", "false");
  document.body.classList.add("no-scroll");
}

function closeCart() {
  document.querySelector(".cart-drawer")?.classList.remove("drawer-open");
  document.querySelector(".drawer-scrim")?.classList.remove("scrim-visible");
  document.querySelector(".cart-drawer")?.setAttribute("aria-hidden", "true");
  document.body.classList.remove("no-scroll");
}

function showProduct(id) {
  const product = getProduct(id);
  const dialog = document.querySelector(".product-dialog");
  if (!product || !dialog) return;
  const reviewCount = Number.isInteger(product.reviewCount) && product.reviewCount > 0 ? product.reviewCount : 0;
  const reviewStars = reviewCount ? '<span class="review-stars" aria-label="5 out of 5 stars">★★★★★</span>' : "";
  dialog.querySelector(".dialog-content").innerHTML = `<div class="dialog-image"><img src="${imageUrl(product.image, 900)}" alt="${product.alt}"></div><div class="dialog-product-copy"><p class="eyebrow">${product.category} · made slowly</p><h2>${product.name}</h2><strong class="dialog-price">${formatPrice(product.price)}</strong><div class="product-reviews" aria-label="${reviewCount} reviews">${reviewStars}<span>${reviewCount} ${reviewCount === 1 ? "review" : "reviews"}</span></div><p>A little handmade happiness for your everyday. Carefully crocheted in a small batch, with the lovely details that make every piece feel like yours.</p><div class="dialog-color"><span>Color</span><strong>${product.color}</strong></div><button class="button button-primary dialog-add" type="button" data-add="${product.id}">Add to bag <span>→</span></button><small>Made with love. Ships with care.</small></div>`;
  dialog.showModal();
}

function renderConfirmation() {
  const card = document.querySelector(".confirmation-card");
  if (!card?.querySelector(".order-number")) return;
  const order = readStorage(orderStorageKey, null);
  if (!order) {
    card.innerHTML = `<div class="confirmation-flower">✿</div><p class="eyebrow">A little mix-up</p><h1>No order <em>just yet.</em></h1><p class="confirmation-lede">We couldn't find an order in this browser. Your bag is still here if you'd like to pick up where you left off.</p><a class="button button-primary" href="shop.html">Visit the little shop <span>→</span></a>`;
    return;
  }
  card.querySelector(".confirmation-name").textContent = order.name;
  card.querySelector(".order-number").textContent = order.number;
  card.querySelector(".confirmation-address").textContent = `${order.address}, ${order.city} ${order.pin}`;
  card.querySelector(".confirmation-payment").textContent = order.payment;
  card.querySelector(".confirmation-total").textContent = formatPrice(order.total);
}

function initializeShop() {
  const search = new URLSearchParams(window.location.search).get("search") || "";
  let selectedFilter = "All";
  const sort = document.querySelector("#sort-products");
  renderProducts(selectedFilter, sort?.value || "popular", search);
  if (search) {
    document.querySelector(".shop-masthead h1").innerHTML = `A little search for <em>${search.replace(/[&<>"']/g, "")}.</em>`;
    document.querySelector(".shop-masthead > div > p:last-child").textContent = `Here are the little things we found for “${search}”.`;
  }
  document.querySelectorAll(".filter-chip").forEach((button) => button.addEventListener("click", () => {
    selectedFilter = button.dataset.filter;
    document.querySelectorAll(".filter-chip").forEach((chip) => chip.classList.toggle("active", chip === button));
    renderProducts(selectedFilter, sort?.value || "popular", search);
  }));
  sort?.addEventListener("change", () => renderProducts(selectedFilter, sort.value, search));
}

function initializeCheckout() {
  const form = document.querySelector("#checkout-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!cartQuantity()) {
      showToast("Your bag is empty. Find a little something first.");
      return;
    }
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const subtotal = cartTotal();
    const shipping = subtotal > 599 ? 0 : 29;
    const order = {
      ...values,
      number: `CR-${String(Date.now()).slice(-7)}`,
      items: cart.map((item) => ({ id: item.id, qty: item.qty })),
      subtotal,
      shipping,
      total: subtotal + shipping,
      placedAt: new Date().toISOString()
    };
    const submitButton = form.querySelector('[type="submit"]');
    const originalButtonText = submitButton.innerHTML;
    try {
      localStorage.setItem(orderStorageKey, JSON.stringify(order));
    } catch (error) {
      console.error("Unable to save your Crosia order.", error);
      showToast("Your order couldn't be saved. Please try again.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Sending your order…";
    try {
      await postEmail("/api/orders", {
        ...order,
        items: cart.map((item) => {
          const product = getProduct(item.id);
          return { name: product.name, qty: item.qty, unitPrice: product.price };
        })
      });
    } catch (error) {
      console.error("Unable to email your Crosia order.", error);
      showToast(error.message);
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonText;
      return;
    }

    try {
      localStorage.removeItem(cartStorageKey);
    } catch (error) {
      console.error("Unable to clear your Crosia bag after sending the order.", error);
    }
    cart = [];
    window.location.assign("confirmation.html");
  });
}

function initializeCustomRequest() {
  const form = document.querySelector("#custom-request-form");
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const formData = new FormData(form);
    const photo = formData.get("photo");
    const values = Object.fromEntries(formData.entries());
    delete values.photo;
    if (photo instanceof File && photo.size > 5 * 1024 * 1024) {
      showToast("Your photo must be 5 MB or smaller.");
      return;
    }
    if (photo instanceof File && photo.size > 0 && !["image/jpeg", "image/png", "image/webp"].includes(photo.type)) {
      showToast("Please choose a JPG, PNG, or WebP photo.");
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    const originalButtonText = submitButton.innerHTML;
    try {
      sessionStorage.setItem("crosia-custom-request", JSON.stringify(values));
    } catch (error) {
      console.error("Unable to prepare your custom request.", error);
      showToast("We couldn't prepare your request. Please try again or email hello@crosia.shop.");
      return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Sending your request…";
    try {
      const request = { ...values };
      if (photo instanceof File && photo.size > 0) {
        request.photo = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.addEventListener("load", () => resolve(reader.result));
          reader.addEventListener("error", () => reject(new Error("We couldn't read your photo. Please try another image.")));
          reader.readAsDataURL(photo);
        });
      }
      await postEmail("/api/custom-requests", request);
    } catch (error) {
      console.error("Unable to email your custom request.", error);
      showToast(error.message);
      submitButton.disabled = false;
      submitButton.innerHTML = originalButtonText;
      return;
    }
    window.location.assign("request-confirmation.html");
  });
}

function initializeCustomRequestConfirmation() {
  const card = document.querySelector("#custom-request-confirmation");
  if (!card) return;

  let values;
  try {
    values = JSON.parse(sessionStorage.getItem("crosia-custom-request") || "null");
  } catch (error) {
    console.error("Unable to read your custom request.", error);
    card.querySelector(".custom-confirmation-lede").textContent = "We couldn't load your request details. Please go back and try again, or email us directly.";
    return;
  }
  if (!values) {
    card.querySelector(".custom-confirmation-lede").textContent = "We couldn't find your request details. Please start again, or email us directly.";
    return;
  }

  card.querySelector(".custom-confirmation-name").textContent = values.name;
  card.querySelector(".custom-confirmation-email").textContent = values.email;
  card.querySelector(".custom-confirmation-whatsapp").textContent = values.whatsapp;
}

function initializeSearch() {
  const panel = document.querySelector(".search-panel");
  document.querySelector(".search-toggle")?.addEventListener("click", () => {
    const opening = panel?.getAttribute("aria-hidden") !== "false";
    panel?.setAttribute("aria-hidden", String(!opening));
    panel?.classList.toggle("search-visible", opening);
    if (opening) panel?.querySelector("input")?.focus();
  });
  document.querySelector(".search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = new FormData(event.currentTarget).get("query") || event.currentTarget.querySelector("input").value;
    const value = String(query).trim();
    if (value) window.location.assign(`shop.html?search=${encodeURIComponent(value)}`);
  });
  document.querySelector("#site-search")?.setAttribute("name", "query");
}

document.addEventListener("DOMContentLoaded", () => {
  renderCart();
  renderConfirmation();
  if (document.querySelector("[data-products]")) initializeShop();
  initializeCheckout();
  initializeCustomRequest();
  initializeCustomRequestConfirmation();
  initializeSearch();
  observeReveals();

  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add]");
    if (add) {
      addToCart(add.dataset.add);
      document.querySelector(".product-dialog")?.close();
      return;
    }
    const view = event.target.closest("[data-view]");
    if (view) {
      showProduct(view.dataset.view);
      return;
    }
    const quantity = event.target.closest("[data-qty]");
    if (quantity) {
      changeQuantity(quantity.dataset.qty, Number(quantity.dataset.change));
      return;
    }
    const remove = event.target.closest("[data-remove]");
    if (remove) {
      cart = cart.filter((item) => item.id !== remove.dataset.remove);
      saveCart();
      renderCart();
      return;
    }
    if (event.target.closest(".bag-button")) openCart();
    if (event.target.closest(".drawer-close") || event.target.classList.contains("drawer-scrim")) closeCart();
    if (event.target.closest(".dialog-close")) document.querySelector(".product-dialog")?.close();
  });

  document.querySelector(".product-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCart();
  });
  document.querySelector(".menu-toggle")?.addEventListener("click", (event) => {
    const button = event.currentTarget;
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    document.querySelector(".main-nav")?.classList.toggle("nav-open", open);
  });
  document.querySelector(".newsletter-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const input = form.querySelector('input[type="email"]');
    const button = form.querySelector('[type="submit"]');
    const originalButtonText = button.innerHTML;
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      await postEmail("/api/newsletter", { email: input.value });
      showToast("Thanks! Your signup request has been sent to the studio ♡");
      form.reset();
    } catch (error) {
      console.error("Unable to email the newsletter signup.", error);
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = originalButtonText;
    }
  });

  const parallax = document.querySelector("[data-parallax]");
  if (parallax && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    let scheduled = false;
    window.addEventListener("scroll", () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        parallax.style.setProperty("--parallax-y", `${Math.min(window.scrollY * Number(parallax.dataset.parallax), 58)}px`);
        scheduled = false;
      });
    }, { passive: true });
  }
});
