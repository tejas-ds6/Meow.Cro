const accountMessage = document.querySelector("#account-message");
const authPanel = document.querySelector("#account-auth");
const dashboard = document.querySelector("#account-dashboard");
const authForms = ["login", "register", "forgot", "reset"].map((name) => document.querySelector(`#${name}-form`));
let accountData;
let orders = [];

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const price = (amount) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0
}).format(amount);

function showMessage(message, isError = false) {
  accountMessage.textContent = message;
  accountMessage.classList.toggle("message-error", isError);
  accountMessage.classList.toggle("message-success", !isError);
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
      credentials: "same-origin"
    });
  } catch {
    throw new Error("We couldn't reach the studio. Check your connection and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "That didn't work just now. Please try again.");
    error.status = response.status;
    throw error;
  }
  return result;
}

function showAuth(view) {
  authPanel.hidden = false;
  dashboard.hidden = true;
  for (const form of authForms) form.hidden = form.id !== `${view}-form`;
  document.querySelectorAll("[data-auth-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.authView === view);
  });
}

function showDashboard(view = "orders") {
  authPanel.hidden = true;
  dashboard.hidden = false;
  document.querySelectorAll("[data-account-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.accountView === view);
  });
  document.querySelectorAll("[data-account-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.accountPanel !== view;
  });
}

function renderOrders() {
  const container = document.querySelector("#account-orders");
  if (!orders.length) {
    container.innerHTML = '<div class="account-card account-empty"><span>✿</span><h3>No orders here just yet.</h3><p>Your next little treasure will show up here.</p><a class="button button-outline" href="shop.html">Visit the shop <span>→</span></a></div>';
    return;
  }
  container.innerHTML = orders.map((order) => {
    const firstItem = order.items[0];
    return `<article class="account-card order-card">
      <div class="order-card-top"><div><p class="eyebrow">${escapeHtml(new Date(order.createdAt).toLocaleDateString("en-IN", { dateStyle: "medium" }))}</p><h3>Order ${escapeHtml(order.number)}</h3></div><span class="status-pill">${escapeHtml(order.status)}</span></div>
      <div class="order-card-content">${firstItem?.image ? `<img src="${escapeHtml(firstItem.image)}" alt="" loading="lazy">` : '<span class="order-image-placeholder">✿</span>'}<div><strong>${escapeHtml(firstItem?.name || "Your order")}${order.items.length > 1 ? ` + ${order.items.length - 1} more` : ""}</strong><small>${order.items.reduce((sum, item) => sum + item.qty, 0)} item(s) · ${escapeHtml(order.paymentMethod)}</small></div><strong class="order-card-price">${price(order.total)}</strong></div>
      <div class="order-card-bottom"><p>Payment: <strong>${escapeHtml(order.paymentStatus)}</strong></p><button class="button button-outline" type="button" data-order-view="${escapeHtml(order.id)}">View details <span>→</span></button></div>
    </article>`;
  }).join("");
}

function renderOrderDetails(order, reviewStatuses = [], scroll = true) {
  const detail = document.querySelector("#order-detail");
  detail.dataset.orderId = order.id;
  const reviewsByProduct = new Map(reviewStatuses.map((review) => [review.productId, review.status]));
  const delivery = order.deliveryMethod === "Self Delivery"
    ? '<div class="delivery-note"><strong>Delivered by MEOWCRO</strong><span>Delivery progress is updated by our studio.</span></div>'
    : order.deliveryMethod === "Courier"
      ? `<div class="delivery-note"><strong>${escapeHtml(order.courierName || "Courier partner")}</strong>${order.trackingId ? `<span>Tracking ID: ${escapeHtml(order.trackingId)}</span>` : ""}${order.trackingUrl ? `<a class="button button-outline" href="${escapeHtml(order.trackingUrl)}" target="_blank" rel="noopener noreferrer">Track shipment <span>↗</span></a>` : ""}${order.courierStatus ? `<span>Latest update: ${escapeHtml(order.courierStatus)}</span>` : ""}${order.estimatedDelivery ? `<span>Estimated delivery: ${escapeHtml(new Date(`${order.estimatedDelivery}T00:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" }))}</span>` : ""}</div>`
      : '<div class="delivery-note"><span>Delivery details will appear here when the studio arranges dispatch.</span></div>';
  detail.innerHTML = `<div class="order-detail-heading"><div><p class="eyebrow">Order details</p><h3>${escapeHtml(order.number)}</h3></div><button class="account-text-button" type="button" data-order-close>Close</button></div>
    <p class="order-current-status">Current status <strong>${escapeHtml(order.status)}</strong></p>
    <div class="order-timeline">${(order.events || []).map((event) => `<div class="timeline-event"><span></span><div><strong>${escapeHtml(event.status)}</strong>${event.note ? `<p>${escapeHtml(event.note)}</p>` : ""}<time>${escapeHtml(new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</time></div></div>`).join("")}</div>
    ${delivery}
    <div class="order-detail-items">${order.items.map((item) => {
      const productId = String(item.id ?? item.productId ?? "");
      const reviewStatus = reviewsByProduct.get(productId);
      const reviewMessage = reviewStatus === "approved"
        ? "Review approved"
        : reviewStatus === "pending"
          ? "Review submitted – Awaiting approval"
          : reviewStatus === "rejected"
            ? "Review not approved"
            : "";
      const reviewAction = order.status === "Delivered"
        ? reviewStatus
          ? `<p class="order-review-status">${reviewMessage}</p>`
          : `<button class="account-text-button" type="button" data-write-review="${escapeHtml(productId)}">Write a review</button>
             <form class="account-review-form" data-review-form data-order-id="${escapeHtml(order.id)}" data-product-id="${escapeHtml(productId)}" hidden>
               <fieldset class="review-rating"><legend>Your rating</legend><div>${[1, 2, 3, 4, 5].map((rating) => `<label aria-label="${rating} stars"><input type="radio" name="rating" value="${rating}" required><span aria-hidden="true">★</span></label>`).join("")}</div></fieldset>
               <label class="field">Your review<textarea name="reviewText" rows="3" maxlength="1000" minlength="8" required placeholder="Tell us what you think of your handmade piece."></textarea></label>
               <label class="field">Product photos <span class="optional">(up to 5)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple data-review-photos></label>
               <div class="review-photo-previews" data-review-previews></div>
               <button class="button button-primary" type="submit">Submit review <span>→</span></button>
             </form>`
        : "";
      return `<div class="detail-item-row"><div class="detail-item">${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">` : ""}<div><strong>${escapeHtml(item.name)}</strong><small>Quantity ${item.qty} · ${price(item.unitPrice)} each</small></div><strong>${price(item.qty * item.unitPrice)}</strong></div>${reviewAction}</div>`;
    }).join("")}</div>
    <div class="order-detail-totals"><p>Subtotal <strong>${price(order.subtotal)}</strong></p><p>Shipping <strong>${price(order.shipping)}</strong></p>${order.discount ? `<p>Discount <strong>−${price(order.discount)}</strong></p>` : ""}<p class="grand-total">Total <strong>${price(order.total)}</strong></p></div>
    <div class="order-detail-address"><h4>Delivery address</h4><p>${escapeHtml(order.name)} · ${escapeHtml(order.phone)}<br>${escapeHtml(order.address)}, ${escapeHtml(order.city)} ${escapeHtml(order.pin)}</p><p>${escapeHtml(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)}</p></div>
    ${order.cancellationRequestStatus ? `<p class="cancellation-state">Cancellation request: ${escapeHtml(order.cancellationRequestStatus)}</p>` : ""}
    ${!["Delivered", "Cancelled", "Returned"].includes(order.status) && !order.cancellationRequested ? `<form class="cancel-order-form"><input name="id" type="hidden" value="${escapeHtml(order.id)}"><label class="field">Request cancellation <textarea name="note" rows="2" maxlength="500" placeholder="Optional note for the studio"></textarea></label><button class="button button-outline" type="submit">Request cancellation</button></form>` : order.cancellationRequested ? '<p class="cancellation-state">Your cancellation request is waiting for the studio.</p>' : ""}`;
  detail.hidden = false;
  if (scroll) detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderProfile() {
  document.querySelector("#account-name").textContent = accountData.customer.name;
  const profileForm = document.querySelector("#profile-form");
  profileForm.elements.name.value = accountData.customer.name;
  profileForm.elements.email.value = accountData.customer.email;
  profileForm.elements.phone.value = accountData.customer.phone;
  const overview = accountData.overview;
  document.querySelector("#account-stats").innerHTML = [
    ["Total orders", overview.total],
    ["In progress", overview.pending],
    ["On the way", overview.inTransit],
    ["Delivered", overview.delivered]
  ].map(([label, count]) => `<article class="account-card account-stat"><strong>${count}</strong><span>${label}</span></article>`).join("");
  renderAddresses();
}

function renderAddresses() {
  const container = document.querySelector("#address-list");
  container.innerHTML = accountData.addresses.length
    ? accountData.addresses.map((address) => `<article class="account-card address-card"><div><span class="status-pill">${escapeHtml(address.label)}</span><h3>${escapeHtml(address.recipientName)}</h3><p>${escapeHtml(address.address)}, ${escapeHtml(address.city)} ${escapeHtml(address.pin)}<br>${escapeHtml(address.phone)}</p></div><div class="address-actions"><button class="account-text-button" type="button" data-address-edit="${escapeHtml(address.id)}">Edit</button><button class="account-text-button" type="button" data-address-delete="${escapeHtml(address.id)}">Delete</button></div></article>`).join("")
    : '<div class="account-card account-empty"><p>No saved addresses yet. Add one for quicker checkout.</p></div>';
}

function renderReviewPhotoPreviews(form) {
  const previewContainer = form.querySelector("[data-review-previews]");
  const input = form.querySelector("[data-review-photos]");
  if (!previewContainer || !input) return;
  previewContainer.querySelectorAll("img").forEach((image) => {
    if (image.src.startsWith("blob:")) URL.revokeObjectURL(image.src);
  });
  previewContainer.innerHTML = [...input.files].map((file, index) => `
    <figure><img src="${URL.createObjectURL(file)}" alt="Selected product photo ${index + 1}">
      <button type="button" data-remove-review-photo="${index}" aria-label="Remove photo ${index + 1}">×</button></figure>
  `).join("");
}

async function refreshDashboard() {
  const [profile, orderResult] = await Promise.all([
    request("/api/account/me"),
    request("/api/account/orders")
  ]);
  accountData = profile;
  orders = orderResult.orders;
  renderProfile();
  renderOrders();
}

function setFormBusy(form, busy, label) {
  const button = form.querySelector('[type="submit"]');
  if (!button) return () => {};
  const original = button.textContent;
  button.disabled = busy;
  if (busy) button.textContent = label;
  return () => {
    button.disabled = false;
    button.textContent = original;
  };
}

document.addEventListener("click", async (event) => {
  const authTab = event.target.closest("[data-auth-view]");
  if (authTab) {
    showAuth(authTab.dataset.authView);
    accountMessage.textContent = "";
    return;
  }
  const accountTab = event.target.closest("[data-account-view]");
  if (accountTab) {
    showDashboard(accountTab.dataset.accountView);
    accountMessage.textContent = "";
    return;
  }
  const viewOrder = event.target.closest("[data-order-view]");
  if (viewOrder) {
    try {
      const orderId = encodeURIComponent(viewOrder.dataset.orderView);
      const [{ order }, { reviews }] = await Promise.all([
        request(`/api/account/orders/${orderId}`),
        request(`/api/account/orders/${orderId}/reviews`)
      ]);
      renderOrderDetails(order, reviews);
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }
  const writeReview = event.target.closest("[data-write-review]");
  if (writeReview) {
    const form = writeReview.nextElementSibling;
    if (form?.matches("[data-review-form]")) {
      form.hidden = !form.hidden;
      writeReview.textContent = form.hidden ? "Write a review" : "Close review form";
      if (!form.hidden) form.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    return;
  }
  const removePhoto = event.target.closest("[data-remove-review-photo]");
  if (removePhoto) {
    const form = removePhoto.closest("[data-review-form]");
    const input = form?.querySelector("[data-review-photos]");
    if (!input) return;
    const transfer = new DataTransfer();
    [...input.files].forEach((file, index) => {
      if (index !== Number(removePhoto.dataset.removeReviewPhoto)) transfer.items.add(file);
    });
    input.files = transfer.files;
    renderReviewPhotoPreviews(form);
    return;
  }
  if (event.target.closest("[data-order-close]")) document.querySelector("#order-detail").hidden = true;
  const editAddress = event.target.closest("[data-address-edit]");
  if (editAddress) {
    const address = accountData.addresses.find((item) => item.id === editAddress.dataset.addressEdit);
    if (!address) return;
    const form = document.querySelector("#address-form");
    for (const [key, value] of Object.entries(address)) {
      if (form.elements.namedItem(key)) form.elements.namedItem(key).value = value;
    }
    document.querySelector("#address-form-heading").textContent = "Edit saved address";
    form.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  const deleteAddress = event.target.closest("[data-address-delete]");
  if (deleteAddress) {
    try {
      await request(`/api/account/addresses/${encodeURIComponent(deleteAddress.dataset.addressDelete)}`, { method: "DELETE" });
      await refreshDashboard();
      showMessage("Saved address deleted.");
    } catch (error) {
      showMessage(error.message, true);
    }
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const restore = setFormBusy(form, true, "Signing in…");
  try {
    await request("/api/account/login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(new FormData(form)))
    });
    await refreshDashboard();
    showDashboard("orders");
    showMessage("You’re signed in. Your little account is ready.");
    form.reset();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    restore();
  }
});

document.querySelector("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    showMessage("Your passwords don’t match.", true);
    return;
  }
  const restore = setFormBusy(form, true, "Creating account…");
  try {
    await request("/api/account/register", {
      method: "POST",
      body: JSON.stringify({
        name: form.elements.name.value,
        email: form.elements.email.value,
        phone: form.elements.phone.value,
        password: form.elements.password.value
      })
    });
    await refreshDashboard();
    showDashboard("orders");
    showMessage("Your account is ready. Welcome to Meow.Cro!");
    form.reset();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    restore();
  }
});

document.querySelector("#forgot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const restore = setFormBusy(form, true, "Sending link…");
  try {
    const result = await request("/api/account/forgot-password", {
      method: "POST",
      body: JSON.stringify({ email: form.elements.email.value })
    });
    showMessage(result.message);
    form.reset();
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    restore();
  }
});

document.querySelector("#reset-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  if (form.elements.password.value !== form.elements.confirmPassword.value) {
    showMessage("Your passwords don’t match.", true);
    return;
  }
  const restore = setFormBusy(form, true, "Updating password…");
  try {
    await request("/api/account/reset-password", {
      method: "POST",
      body: JSON.stringify({ token: new URLSearchParams(location.search).get("reset"), password: form.elements.password.value })
    });
    history.replaceState(null, "", "account.html");
    form.reset();
    showAuth("login");
    showMessage("Your password was reset. Please sign in.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    restore();
  }
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await request("/api/account/profile", {
      method: "PATCH",
      body: JSON.stringify({ name: form.elements.name.value, phone: form.elements.phone.value })
    });
    accountData.customer = result.customer;
    renderProfile();
    showMessage("Your profile has been updated.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#address-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = form.elements.id.value;
  const method = id ? "PATCH" : "POST";
  const path = id ? `/api/account/addresses/${encodeURIComponent(id)}` : "/api/account/addresses";
  try {
    await request(path, {
      method,
      body: JSON.stringify({
        label: form.elements.label.value,
        recipientName: form.elements.recipientName.value,
        phone: form.elements.phone.value,
        address: form.elements.address.value,
        city: form.elements.city.value,
        pin: form.elements.pin.value
      })
    });
    form.reset();
    document.querySelector("#address-form-heading").textContent = "Add an address";
    await refreshDashboard();
    showMessage("Your address has been saved.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const result = await request("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: form.elements.currentPassword.value,
        newPassword: form.elements.newPassword.value
      })
    });
    form.reset();
    dashboard.hidden = true;
    showAuth("login");
    showMessage(result.message);
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#account-dashboard").addEventListener("change", (event) => {
  const input = event.target.closest("[data-review-photos]");
  if (!input) return;
  const form = input.closest("[data-review-form]");
  if (input.files.length > 5) {
    input.value = "";
    renderReviewPhotoPreviews(form);
    showMessage("Choose up to 5 product photos.", true);
    return;
  }
  if ([...input.files].some((file) => file.size > 5 * 1024 * 1024)) {
    input.value = "";
    renderReviewPhotoPreviews(form);
    showMessage("Each product photo must be 5 MB or smaller.", true);
    return;
  }
  renderReviewPhotoPreviews(form);
});

document.querySelector("#account-dashboard").addEventListener("submit", async (event) => {
  const reviewForm = event.target.closest("[data-review-form]");
  if (reviewForm) {
    event.preventDefault();
    const submitButton = reviewForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    const originalLabel = submitButton.textContent;
    submitButton.textContent = "Submitting…";
    try {
      const files = [...reviewForm.elements.photos.files];
      const photos = await Promise.all(files.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Your selected photos could not be read."));
        reader.readAsDataURL(file);
      })));
      const orderId = reviewForm.dataset.orderId;
      await request(`/api/account/orders/${encodeURIComponent(orderId)}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          productId: reviewForm.dataset.productId,
          rating: Number(reviewForm.elements.rating.value),
          reviewText: reviewForm.elements.reviewText.value,
          photos
        }),
        headers: { "Content-Type": "application/json" }
      });
      const [{ order }, { reviews }] = await Promise.all([
        request(`/api/account/orders/${encodeURIComponent(orderId)}`),
        request(`/api/account/orders/${encodeURIComponent(orderId)}/reviews`)
      ]);
      renderOrderDetails(order, reviews, false);
      showMessage("Review submitted – Awaiting approval");
    } catch (error) {
      showMessage(error.message, true);
      submitButton.disabled = false;
      submitButton.textContent = originalLabel;
    }
    return;
  }
  const form = event.target.closest(".cancel-order-form");
  if (!form) return;
  event.preventDefault();
  try {
    await request(`/api/account/orders/${encodeURIComponent(form.elements.id.value)}/cancellation`, {
      method: "POST",
      body: JSON.stringify({ note: form.elements.note.value })
    });
    await refreshDashboard();
    showMessage("Your cancellation request was sent to the studio.");
    document.querySelector("#order-detail").hidden = true;
    showDashboard("orders");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector("#account-logout").addEventListener("click", async () => {
  try {
    await request("/api/account/logout", { method: "POST" });
    showAuth("login");
    showMessage("You’ve signed out safely.");
  } catch (error) {
    showMessage(error.message, true);
  }
});

document.querySelector(".menu-toggle")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const open = button.getAttribute("aria-expanded") !== "true";
  button.setAttribute("aria-expanded", String(open));
  button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
  document.querySelector(".main-nav")?.classList.toggle("nav-open", open);
});

const resetToken = new URLSearchParams(location.search).get("reset");
if (resetToken) {
  showAuth("reset");
  showMessage("");
} else {
  request("/api/account/me")
    .then(async (profile) => {
      accountData = profile;
      const result = await request("/api/account/orders");
      orders = result.orders;
      renderProfile();
      renderOrders();
      showDashboard("orders");
      showMessage("");
    })
    .catch((error) => {
      if (error.status === 401) {
        showAuth("login");
        showMessage("");
      }
      else {
        showAuth("login");
        showMessage(error.message, true);
      }
    });
}

window.setInterval(async () => {
  if (dashboard.hidden) return;
  try {
    await refreshDashboard();
    const detail = document.querySelector("#order-detail");
    if (!detail.hidden && detail.dataset.orderId) {
      const orderId = encodeURIComponent(detail.dataset.orderId);
      const [{ order }, { reviews }] = await Promise.all([
        request(`/api/account/orders/${orderId}`),
        request(`/api/account/orders/${orderId}/reviews`)
      ]);
      renderOrderDetails(order, reviews, false);
    }
  } catch (error) {
    if (error.status === 401) {
      accountData = undefined;
      orders = [];
      document.querySelector("#order-detail").hidden = true;
      showAuth("login");
      showMessage("Please sign in again to continue.", true);
      return;
    }
    showMessage(error.message, true);
  }
}, 30_000);
