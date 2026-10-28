import { getProduct, imageUrl, products } from "./catalog.js";
import { createCartStore } from "./cart-store.js";

const formatPrice = (amount) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
const orderStorageKey = "crosia-last-order";
const browserStorage = {
  getItem(key) {
    return window.localStorage.getItem(key);
  },
  setItem(key, value) {
    window.localStorage.setItem(key, value);
  }
};
const readStorage = (key, fallback) => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : fallback;
  } catch (error) {
    console.error(`Unable to read Crosia storage key "${key}".`, error);
    return fallback;
  }
};

const cartStore = createCartStore({
  storage: browserStorage,
  getProduct,
  onStorageError(error, operation) {
    console.error(`Unable to ${operation === "read" ? "read" : "save"} your Meow.Cro bag.`, error);
    if (operation === "write") showToast("Your bag couldn't be saved in this browser. Please keep this tab open.");
  }
});

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

function initializeEmailForm(selector, endpoint, successMessage, getValues = (form) => Object.fromEntries(new FormData(form).entries())) {
  document.querySelector(selector)?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;

    const button = form.querySelector('[type="submit"]');
    const originalButtonText = button.innerHTML;
    button.disabled = true;
    button.textContent = "Sending…";
    try {
      await postEmail(endpoint, getValues(form));
      form.reset();
      showToast(successMessage);
    } catch (error) {
      console.error(`Unable to submit ${selector}.`, error);
      showToast(error.message);
    } finally {
      button.disabled = false;
      button.innerHTML = originalButtonText;
    }
  });
}

async function postJson(endpoint, values) {
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
  } catch {
    throw new Error("We couldn't reach the server. Check your connection and try again.");
  }
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("The server returned an invalid response. Check that the Node server is running.");
  }
  if (!response.ok) throw new Error(result.error || "We couldn't complete that just now. Please try again.");
  return result;
}

const postEmail = postJson;

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Razorpay Checkout couldn't load. Check your connection and try again."));
    document.head.append(script);
  });
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
  const count = cartStore.quantity();
  document.querySelectorAll(".bag-count").forEach((element) => {
    element.textContent = count;
    element.classList.toggle("count-pop", count > 0);
  });
  document.querySelectorAll(".drawer-count").forEach((element) => element.textContent = `(${count})`);
  document.querySelectorAll(".cart-subtotal strong").forEach((element) => element.textContent = formatPrice(cartStore.total()));
  document.querySelectorAll(".cart-items").forEach((container) => {
    container.innerHTML = cartStore.items.map((item) => {
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
  floatingCheckout.textContent = `Checkout · ${count} ${count === 1 ? "item" : "items"} · ${formatPrice(cartStore.total())} →`;
  renderCheckoutSummary();
}

function renderCheckoutSummary() {
  const target = document.querySelector(".checkout-items");
  if (!target) return;
  if (!cartStore.quantity()) {
    target.innerHTML = `<div class="checkout-empty"><span>✿</span><p>Your bag is taking a little nap.</p><a href="shop.html">Browse the little things →</a></div>`;
    document.querySelector(".place-order")?.setAttribute("disabled", "disabled");
    document.querySelector(".summary-subtotal").textContent = formatPrice(0);
    document.querySelector(".summary-grand-total").textContent = formatPrice(0);
    return;
  }
  document.querySelector(".place-order")?.removeAttribute("disabled");
  target.innerHTML = cartStore.items.map((item) => {
    const product = getProduct(item.id);
    return `<div class="checkout-line"><div class="checkout-line-image"><img src="${imageUrl(product.image, 190)}" alt="" loading="lazy"><span>${item.qty}</span></div><div class="checkout-line-name"><strong>${product.name}</strong><small>${product.color}</small></div><strong>${formatPrice(product.price * item.qty)}</strong></div>`;
  }).join("");
  const subtotal = cartStore.total();
  const shipping = subtotal > 599 ? 0 : 29;
  document.querySelector(".summary-subtotal").textContent = formatPrice(subtotal);
  document.querySelector(".summary-shipping").textContent = shipping === 0 ? "On us ♡" : formatPrice(shipping);
  document.querySelector(".summary-grand-total").textContent = formatPrice(subtotal + shipping);
}

function addToCart(id) {
  const result = cartStore.add(id);
  if (result === "limit") {
    showToast("That little favorite is already at the maximum quantity.");
    return;
  }
  if (result !== "added") return;
  renderCart();
  showToast(`${getProduct(id).name} is in your bag ♡`);
  document.querySelector(".bag-button")?.classList.add("bag-bump");
  window.setTimeout(() => document.querySelector(".bag-button")?.classList.remove("bag-bump"), 420);
}

function changeQuantity(id, change) {
  if (cartStore.changeQuantity(id, change)) renderCart();
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

async function renderConfirmation() {
  const card = document.querySelector(".confirmation-card");
  if (!card?.querySelector(".order-number")) return;
  let order = readStorage(orderStorageKey, null);
  if (order?.payment === "UPI (paid)") {
    if (!order.paymentProof) {
      showUnverifiedConfirmation(card);
      return;
    }
    try {
      const verified = await postJson("/api/payments/razorpay/confirm", order.paymentProof);
      order = { ...verified.order, notificationSent: order.notificationSent };
      try {
        localStorage.setItem(orderStorageKey, JSON.stringify(order));
      } catch (error) {
        console.error("Unable to update the verified Meow.Cro order in browser storage.", error);
      }
    } catch (error) {
      console.error("Unable to confirm the Razorpay payment.", error);
      showUnverifiedConfirmation(card);
      return;
    }
  }
  if (!order) {
    card.innerHTML = `<div class="confirmation-flower">✿</div><p class="eyebrow">A little mix-up</p><h1>No order <em>just yet.</em></h1><p class="confirmation-lede">We couldn't find an order in this browser. Your bag is still here if you'd like to pick up where you left off.</p><a class="button button-primary" href="shop.html">Visit the little shop <span>→</span></a>`;
    return;
  }
  card.querySelector(".confirmation-name").textContent = order.name;
  card.querySelector(".order-number").textContent = order.number;
  card.querySelector(".confirmation-address").textContent = `${order.address}, ${order.city} ${order.pin}`;
  card.querySelector(".confirmation-payment").textContent = order.payment;
  card.querySelector(".confirmation-total").textContent = formatPrice(order.total);
  const note = card.querySelector(".confirmation-note");
  if (order.payment === "UPI (paid)") {
    note.textContent = order.notificationSent === false
      ? "Your payment is confirmed. We couldn't send the order email just now, but your order number is saved above."
      : "Your payment has been received and verified by Razorpay.";
  } else {
    note.textContent = "Payment is due when your Cash on delivery parcel arrives. The studio will follow up to confirm your order.";
  }
}

function showUnverifiedConfirmation(card) {
  card.innerHTML = `<div class="confirmation-flower">✿</div><p class="eyebrow">Payment check</p><h1>We couldn't confirm <em>just yet.</em></h1><p class="confirmation-lede">This page only confirms UPI orders after Razorpay reports a captured payment. Please refresh to check again. If your UPI app shows a debit, don't pay again—contact us with your payment reference.</p><a class="button button-primary" href="contact.html">Contact the studio <span>→</span></a>`;
}

function initializeShop() {
  const search = new URLSearchParams(window.location.search).get("search") || "";
  let selectedFilter = "All";
  const sort = document.querySelector("#sort-products");
  renderProducts(selectedFilter, sort?.value || "popular", search);
  if (search) {
    document.querySelector(".shop-masthead h1").textContent = `A little search for “${search}”.`;
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
    if (!cartStore.quantity()) {
      showToast("Your bag is empty. Find a little something first.");
      return;
    }
    if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form).entries());
    values.payment = form.querySelector('input[name="payment"]:checked')?.value;
    const subtotal = cartStore.total();
    const shipping = subtotal > 599 ? 0 : 29;
    const submitButton = form.querySelector('[type="submit"]');
    const originalButtonText = submitButton.innerHTML;

    if (values.payment === "UPI") {
      submitButton.disabled = true;
      submitButton.textContent = "Opening secure payment…";
      let paymentCallbackReceived = false;
      let paymentReference = "";
      try {
        const paymentOrder = await postJson("/api/payments/razorpay/orders", {
          ...values,
          items: cartStore.items.map(({ id, qty }) => ({ id, qty }))
        });
        await loadRazorpayCheckout();
        const paymentResult = await new Promise((resolve, reject) => {
          const checkout = new window.Razorpay({
            key: paymentOrder.keyId,
            amount: paymentOrder.amount,
            currency: paymentOrder.currency,
            name: "Meow.Cro",
            description: "Handmade crochet order",
            order_id: paymentOrder.orderId,
            prefill: { name: values.name, email: values.email, contact: values.phone },
            method: { upi: true, card: false, netbanking: false, wallet: false, emi: false, paylater: false },
            theme: { color: "#b85f48" },
            handler: async (details) => {
              paymentCallbackReceived = true;
              paymentReference = details.razorpay_payment_id || "";
              try {
                const verified = await postJson("/api/payments/razorpay/verify", {
                  ...details,
                  verificationToken: paymentOrder.verificationToken
                });
                resolve({ verified, details });
              } catch (error) {
                reject(error);
              }
            },
            modal: { ondismiss: () => reject(new Error("Payment was not confirmed. Your bag is still here.")) }
          });
          checkout.on("payment.failed", (result) => {
            reject(new Error(result.error?.description || "Payment wasn't completed. Your bag is still here."));
          });
          checkout.open();
        });
        const order = {
          ...paymentResult.verified.order,
          notificationSent: paymentResult.verified.notificationSent,
          paymentProof: {
            razorpay_order_id: paymentResult.details.razorpay_order_id,
            razorpay_payment_id: paymentResult.details.razorpay_payment_id,
            razorpay_signature: paymentResult.details.razorpay_signature,
            verificationToken: paymentOrder.verificationToken
          }
        };
        try {
          localStorage.setItem(orderStorageKey, JSON.stringify(order));
        } catch (error) {
          console.error("Unable to save the verified Meow.Cro order.", error);
          showToast("Payment received, but this browser couldn't save your receipt. Please contact the studio with your payment reference.");
          submitButton.disabled = false;
          submitButton.innerHTML = originalButtonText;
          return;
        }
        try {
          cartStore.clear();
        } catch (error) {
          console.error("Unable to clear your bag after confirmed payment.", error);
        }
        window.location.assign("confirmation.html");
      } catch (error) {
        console.error("Unable to complete Razorpay checkout.", error);
        showToast(paymentCallbackReceived
          ? `We couldn't verify payment${paymentReference ? ` ${paymentReference}` : ""}. If your UPI app shows a debit, don't pay again—contact the studio.`
          : error.message);
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
      }
      return;
    }

    const order = {
      ...values,
      number: `CR-${String(Date.now()).slice(-7)}`,
      items: cartStore.items.map((item) => ({ id: item.id, qty: item.qty })),
      subtotal,
      shipping,
      total: subtotal + shipping,
      placedAt: new Date().toISOString()
    };
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
        items: cartStore.items.map((item) => {
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
      cartStore.clear();
    } catch (error) {
      console.error("Unable to clear your Crosia bag after sending the order.", error);
    }
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
      showToast("We couldn't prepare your request. Please try again or email meowcrosia@gmail.com.");
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
  initializeEmailForm("#contact-form", "/api/contact", "Thanks for your note! The studio will get back to you.");
  initializeEmailForm(
    ".newsletter-form",
    "/api/newsletter",
    "Thanks! Your signup request has been sent to the studio ♡",
    (form) => ({ email: form.querySelector('input[type="email"]').value })
  );
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
      if (cartStore.remove(remove.dataset.remove)) renderCart();
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
