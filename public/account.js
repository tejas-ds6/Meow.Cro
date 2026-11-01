const accountMessage = document.querySelector("#account-message");
const authPanel = document.querySelector("#account-auth");
const dashboard = document.querySelector("#account-dashboard");
const authForms = ["login", "register", "forgot", "reset"].map((name) => document.querySelector(`#${name}-form`));
let accountData;
let orders = [];
let currentOrderDetail;
const reviewPhotosByForm = new WeakMap();

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const price = (amount) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 0
}).format(amount);

function reviewFormMarkup(orderId, productId) {
  return `<form class="order-review-form" data-review-order="${escapeHtml(orderId)}" data-review-product="${escapeHtml(productId)}">
    <label class="field">Your rating<select name="rating" required><option value="">Choose a rating</option>${[5, 4, 3, 2, 1].map((rating) => `<option value="${rating}">${rating} ${rating === 1 ? "star" : "stars"}</option>`).join("")}</select></label>
    <label class="field">Your review<textarea name="reviewText" rows="3" maxlength="1000" minlength="8" required placeholder="Tell us what you love about it."></textarea></label>
    <label class="field">Product photos <span class="optional">(up to 5)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
    <div class="review-photo-previews" aria-live="polite"></div>
    <div class="order-review-form-actions"><button class="button button-primary" type="submit">Submit review <span>→</span></button><button class="account-text-button" type="button" data-review-cancel>Cancel</button></div>
  </form>`;
}

function renderReviewPhotoPreviews(form) {
  const preview = form.querySelector(".review-photo-previews");
  if (!preview) return;
  const photos = reviewPhotosByForm.get(form) || [];
  preview.innerHTML = photos.map((photo, index) => `<div class="review-photo-preview"><img src="${escapeHtml(photo.dataUrl)}" alt="Selected review photo ${index + 1}"><button type="button" data-review-photo-remove="${index}" aria-label="Remove photo ${index + 1}">×</button></div>`).join("");
}

function readReviewPhoto(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ file, dataUrl: reader.result });
    reader.onerror = () => reject(new Error("A selected photo could not be read. Please choose it again."));
    reader.readAsDataURL(file);
  });
}

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

function renderOrderDetails(order, scroll = true) {
  const detail = document.querySelector("#order-detail");
  currentOrderDetail = order;
  detail.dataset.orderId = order.id;
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
      const reviewStatus = order.reviewStatuses?.[productId];
      const reviewAction = reviewStatus === "approved"
        ? '<span class="review-submission-status">Review approved</span>'
        : reviewStatus === "pending"
          ? '<span class="review-submission-status">Review submitted – Awaiting approval</span>'
          : reviewStatus === "rejected"
            ? '<span class="review-submission-status">Review not approved</span>'
          : order.status === "Delivered" && productId
            ? `<button class="button button-outline" type="button" data-review-write data-review-order="${escapeHtml(order.id)}" data-review-product="${escapeHtml(productId)}">Write a review</button>`
            : "";
      return `<article class="detail-order-item"><div class="detail-item">${item.image ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">` : ""}<div><strong>${escapeHtml(item.name)}</strong><small>Quantity ${item.qty} · ${price(item.unitPrice)} each</small></div><strong>${price(item.qty * item.unitPrice)}</strong></div><div class="order-item-review">${reviewAction}</div></article>`;
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
      const { order } = await request(`/api/account/orders/${encodeURIComponent(viewOrder.dataset.orderView)}`);
      renderOrderDetails(order);
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }
  const writeReview = event.target.closest("[data-review-write]");
  if (writeReview) {
    const action = writeReview.closest(".order-item-review");
    action.innerHTML = reviewFormMarkup(writeReview.dataset.reviewOrder, writeReview.dataset.reviewProduct);
    action.querySelector('[name="rating"]')?.focus();
    return;
  }
  const cancelReview = event.target.closest("[data-review-cancel]");
  if (cancelReview) {
    const action = cancelReview.closest(".order-item-review");
    if (currentOrderDetail) renderOrderDetails(currentOrderDetail, false);
    else action.innerHTML = "";
    return;
  }
  const removeReviewPhoto = event.target.closest("[data-review-photo-remove]");
  if (removeReviewPhoto) {
    const form = removeReviewPhoto.closest(".order-review-form");
    const photos = reviewPhotosByForm.get(form) || [];
    photos.splice(Number(removeReviewPhoto.dataset.reviewPhotoRemove), 1);
    reviewPhotosByForm.set(form, photos);
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

document.querySelector("#account-dashboard").addEventListener("submit", async (event) => {
  const reviewForm = event.target.closest(".order-review-form");
  if (reviewForm) {
    event.preventDefault();
    const photos = reviewPhotosByForm.get(reviewForm) || [];
    const restore = setFormBusy(reviewForm, true, "Submitting review…");
    try {
      await request(`/api/account/orders/${encodeURIComponent(reviewForm.dataset.reviewOrder)}/items/${encodeURIComponent(reviewForm.dataset.reviewProduct)}/review`, {
        method: "POST",
        body: JSON.stringify({
          rating: Number(reviewForm.elements.rating.value),
          reviewText: reviewForm.elements.reviewText.value,
          photos: photos.map((photo) => photo.dataUrl)
        })
      });
      currentOrderDetail.reviewStatuses = {
        ...(currentOrderDetail.reviewStatuses || {}),
        [reviewForm.dataset.reviewProduct]: "pending"
      };
      renderOrderDetails(currentOrderDetail, false);
      showMessage("Review submitted – Awaiting approval");
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      restore();
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

document.querySelector("#account-dashboard").addEventListener("change", async (event) => {
  const input = event.target.closest('.order-review-form input[name="photos"]');
  if (!input) return;
  const form = input.closest(".order-review-form");
  const selected = [...input.files];
  input.value = "";
  const existing = reviewPhotosByForm.get(form) || [];
  if (existing.length + selected.length > 5) {
    showMessage("Choose up to five photos for each review.", true);
    return;
  }
  if (selected.some((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024)) {
    showMessage("Choose JPG, PNG, or WebP photos up to 5 MB each.", true);
    return;
  }
  try {
    reviewPhotosByForm.set(form, [...existing, ...await Promise.all(selected.map(readReviewPhoto))]);
    renderReviewPhotoPreviews(form);
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
      const { order } = await request(`/api/account/orders/${encodeURIComponent(detail.dataset.orderId)}`);
      renderOrderDetails(order, false);
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
