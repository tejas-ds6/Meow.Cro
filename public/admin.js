import {
  clearSessionExpiry,
  observeSessionExpiry,
  tabSessionError,
  tabSessionHeaders
} from "./tab-session.js?v=tab-session-20261106";

const message = document.querySelector("#admin-message");
const loginPanel = document.querySelector("#admin-login");
const dashboard = document.querySelector("#admin-dashboard");
const orderList = document.querySelector("#admin-orders");
const ordersView = document.querySelector("#admin-orders-view");
const customOrdersView = document.querySelector("#admin-custom-orders-view");
const customOrderList = document.querySelector("#admin-custom-orders");
const customViewToggle = document.querySelector("#admin-custom-toggle");
const reviewsSection = document.querySelector("#admin-review-section");
const dashboardTitle = document.querySelector("#admin-view-title");
const viewToggle = document.querySelector("#admin-view-toggle");
const reviewList = document.querySelector("#admin-reviews");
const reviewTabs = [...document.querySelectorAll(".review-tab")];
const statuses = [
  "Order Placed", "Order Confirmed", "Processing", "Ready for Delivery",
  "Shipped / Out for Delivery", "Delivered", "Cancelled", "Failed Delivery", "Returned"
];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);
const price = (amount) => new Intl.NumberFormat("en-IN", {
  style: "currency", currency: "INR", maximumFractionDigits: 2
}).format(amount);

let dashboardView = "orders";
const reviewPhotoObjectUrls = new Set();
const customPhotoObjectUrls = new Set();

function handleExpiredSession() {
  clearSessionExpiry();
  loginPanel.hidden = false;
  dashboard.hidden = true;
  showMessage("Your admin session has expired. Please sign in again.", true);
}

function showMessage(value, isError = false) {
  message.textContent = value;
  message.classList.toggle("message-error", isError);
  message.classList.toggle("message-success", !isError);
}

function showListError(container, label, error) {
  const card = document.createElement("div");
  card.className = "account-card account-empty";
  const text = document.createElement("p");
  text.textContent = `${label}: ${error.message}`;
  card.append(text);
  container.replaceChildren(card);
}

function setDashboardView(view) {
  dashboardView = view;
  const showingReviews = view === "reviews";
  const showingCustomOrders = view === "custom";
  ordersView.hidden = showingReviews || showingCustomOrders;
  customOrdersView.hidden = !showingCustomOrders;
  reviewsSection.hidden = !showingReviews;
  dashboardTitle.innerHTML = showingReviews ? "Customer <em>reviews.</em>"
    : showingCustomOrders ? "Custom <em>requests.</em>" : "Recent <em>orders.</em>";
  viewToggle.textContent = showingReviews ? "Recent orders" : "Customer reviews";
  viewToggle.setAttribute("aria-pressed", String(showingReviews));
  customViewToggle.textContent = showingCustomOrders ? "Recent orders" : "Custom requests";
  customViewToggle.setAttribute("aria-pressed", String(showingCustomOrders));
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: tabSessionHeaders({
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }),
      credentials: "same-origin"
    });
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    if (!dashboard.hidden && path.startsWith("/api/admin/")) {
      clearSessionExpiry();
      loginPanel.hidden = false;
      dashboard.hidden = true;
      showMessage("We couldn't verify your admin session. Please try again.", true);
    }
    throw new Error("Could not reach the server. Check your connection and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(result.error || "That didn't work. Please try again.");
    error.status = response.status;
    error.code = result.code;
    if (response.status === 401 && result.code === "SESSION_EXPIRED") handleExpiredSession();
    else if (response.status >= 500 && !dashboard.hidden && path.startsWith("/api/admin/")) {
      clearSessionExpiry();
      loginPanel.hidden = false;
      dashboard.hidden = true;
      showMessage("We couldn't verify your admin session. Please try again.", true);
    }
    throw error;
  }
  if (path.startsWith("/api/admin/")) observeSessionExpiry(response, handleExpiredSession);
  return result;
}

document.querySelectorAll("[data-show-password]").forEach((toggle) => {
  toggle.addEventListener("change", () => {
    const input = document.getElementById(toggle.getAttribute("aria-controls"));
    if (input) input.type = toggle.checked ? "text" : "password";
  });
});

function displayOrders(orders) {
  if (!orders.length) {
    orderList.innerHTML = '<div class="account-card account-empty"><p>There are no saved orders yet.</p></div>';
    return;
  }
  orderList.innerHTML = orders.map((order) => `<article class="account-card admin-order">
    <header class="admin-order-heading"><div><p class="eyebrow">${escapeHtml(new Date(order.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</p><h3>${escapeHtml(order.number)}</h3></div><span class="status-pill">${escapeHtml(order.status)}</span></header>
    <div class="admin-customer"><strong>${escapeHtml(order.name)}</strong><span>${escapeHtml(order.email)} · ${escapeHtml(order.phone)}</span><span>${escapeHtml(order.address)}, ${escapeHtml(order.city)} ${escapeHtml(order.pin)}</span></div>
    <div class="admin-order-items">${order.items.map((item) => `<span>${escapeHtml(item.name)} × ${item.qty} · ${price(item.unitPrice * item.qty)}</span>`).join("")}</div>
    <p class="admin-order-payment">${escapeHtml(order.paymentMethod)} · ${escapeHtml(order.paymentStatus)} · <strong>${price(order.total)}</strong></p>
    ${order.nimbuspostLabelUrl ? `<p><a href="${escapeHtml(order.nimbuspostLabelUrl)}" target="_blank" rel="noopener noreferrer">Open NimbusPost shipping label</a></p>` : ""}
    ${order.cancellationRequested ? `<div class="cancellation-alert"><strong>Cancellation requested</strong><span>${escapeHtml(order.cancellationRequestStatus)}</span></div>` : ""}
    <form class="admin-order-form" data-admin-order="${escapeHtml(order.id)}">
      <label class="field">Order status<select name="status">${statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === order.status ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label>
      <label class="field">Payment status<select name="paymentStatus">${["Pending", "Due on delivery", "Paid", "Failed", "Refund required (manual)", "Refunded"].map((status) => `<option value="${escapeHtml(status)}" ${status === order.paymentStatus ? "selected" : ""}>${escapeHtml(status)}</option>`).join("")}</select></label>
      <label class="field">Delivery method<select name="deliveryMethod" ${order.nimbuspostAwb ? "disabled" : ""}><option value="">Not assigned</option><option value="Courier" ${order.deliveryMethod === "Courier" ? "selected" : ""}>Courier</option><option value="NimbusPost" ${order.deliveryMethod === "NimbusPost" ? "selected" : ""}>NimbusPost</option><option value="Self Delivery" ${order.deliveryMethod === "Self Delivery" ? "selected" : ""}>Self Delivery</option></select></label>
      <label class="field">Courier partner name<input name="courierName" maxlength="100" value="${escapeHtml(order.courierName)}" ${order.nimbuspostAwb ? "readonly" : ""}></label>
      <label class="field">Shipment tracking ID<input name="trackingId" maxlength="120" value="${escapeHtml(order.trackingId)}" ${order.nimbuspostAwb ? "readonly" : ""}></label>
      <label class="field field-wide">Secure tracking URL<input name="trackingUrl" type="url" maxlength="500" placeholder="https://…" value="${escapeHtml(order.trackingUrl)}" ${order.nimbuspostAwb ? "readonly" : ""}></label>
      <label class="field">Latest courier update<input name="courierStatus" maxlength="120" value="${escapeHtml(order.courierStatus)}"></label>
      <label class="field">Estimated delivery date<input name="estimatedDelivery" type="date" value="${escapeHtml(order.estimatedDelivery ? new Date(order.estimatedDelivery).toISOString().slice(0, 10) : "")}"></label>
      <label class="field field-wide">Status update note<input name="statusNote" maxlength="500" placeholder="Optional note visible to the customer"></label>
      ${order.cancellationRequested ? '<label class="field">Cancellation request<select name="cancellationDecision"><option value="">Leave pending</option><option value="approve">Approve cancellation</option><option value="reject">Reject cancellation</option></select></label>' : ""}
      <button class="button button-primary" type="submit">Save order update <span>→</span></button>
    </form>
    ${order.deliveryMethod === "NimbusPost" && !order.nimbuspostAwb ? `<form class="admin-order-form admin-nimbus-form" data-nimbus-order="${escapeHtml(order.id)}">
      ${order.nimbuspostOrderId ? '<p class="field-wide">NimbusPost order created. Retry courier booking without creating a duplicate order.</p>' : `
      <label class="field">Delivery state<input name="state" maxlength="100" required placeholder="State / region"></label>
      <label class="field">Parcel weight (kg)<input name="weight" type="number" min="0.001" max="100" step="0.001" required></label>
      <label class="field">Parcel length (cm)<input name="length" type="number" min="0.1" max="200" step="0.1" required></label>
      <label class="field">Parcel width (cm)<input name="width" type="number" min="0.1" max="200" step="0.1" required></label>
      <label class="field">Parcel height (cm)<input name="height" type="number" min="0.1" max="200" step="0.1" required></label>`}
      <button class="button button-primary" type="submit">${order.nimbuspostOrderId ? "Retry NimbusPost booking" : "Create and book NimbusPost shipment"} <span>→</span></button>
    </form>` : ""}
  </article>`).join("");
}

function displayCustomOrders(requests) {
  for (const url of customPhotoObjectUrls) URL.revokeObjectURL(url);
  customPhotoObjectUrls.clear();
  if (!requests.length) {
    customOrderList.innerHTML = '<div class="account-card account-empty"><p>There are no custom requests yet.</p></div>';
    return;
  }
  customOrderList.innerHTML = requests.map((request) => `<article class="account-card admin-order admin-custom-order">
    <header class="admin-order-heading"><div><p class="eyebrow">${escapeHtml(new Date(request.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</p><h3>Custom request</h3></div><span class="status-pill">${escapeHtml(request.status)}</span></header>
    <div class="admin-customer"><strong>${escapeHtml(request.name)}</strong><span>${escapeHtml(request.email)} · ${escapeHtml(request.whatsapp)}</span></div>
    <p><strong>Idea:</strong> ${escapeHtml(request.idea)}</p>
    ${request.details ? `<p><strong>Details:</strong> ${escapeHtml(request.details)}</p>` : ""}
    <p><strong>Budget:</strong> ${request.budget ? price(request.budget) : "Not specified"} · <strong>Needed by:</strong> ${escapeHtml(request.neededBy ? new Date(`${request.neededBy}T00:00:00`).toLocaleDateString("en-IN") : "Not specified")}</p>
    ${request.hasReferencePhoto ? `<button class="text-link" type="button" data-custom-photo="${escapeHtml(request.id)}">View reference photo</button>` : ""}
    ${request.status === "offered" ? `<p><strong>Current quote:</strong> ${price(request.quotedAmount)} · expires ${escapeHtml(new Date(request.quoteExpiresAt).toLocaleDateString("en-IN"))}</p>` : ""}
    ${request.adminNote ? `<p><strong>Studio note:</strong> ${escapeHtml(request.adminNote)}</p>` : ""}
    ${request.status === "rejected" ? `<button class="button button-outline" type="button" data-custom-reject="${escapeHtml(request.id)}" data-custom-note="${escapeHtml(request.adminNote)}">Resend decline email</button>` : ""}
    ${request.status === "pending" || request.status === "offered" ? `<form class="admin-order-form admin-custom-offer" data-custom-order="${escapeHtml(request.id)}">
      <label class="field">Final price (₹)<input name="amount" type="number" min="0.01" max="500000" step="0.01" value="${escapeHtml(request.quotedAmount ?? "")}" required></label>
      <label class="field field-wide">Note for the customer <textarea name="adminNote" rows="2" maxlength="500">${escapeHtml(request.adminNote)}</textarea></label>
      <button class="button button-primary" type="submit">${request.status === "offered" ? "Update & resend offer" : "Accept & send priced offer"} <span>→</span></button>
      ${request.status === "pending" ? `<button class="button button-outline" type="button" data-custom-reject="${escapeHtml(request.id)}">Decline request</button>` : ""}
    </form>` : ""}
  </article>`).join("");
}

function displayReviews(reviews) {
  for (const url of reviewPhotoObjectUrls) URL.revokeObjectURL(url);
  reviewPhotoObjectUrls.clear();
  if (!reviews.length) {
    reviewList.innerHTML = '<div class="account-card account-empty"><p>No reviews match this queue yet.</p></div>';
    return;
  }
  reviewList.innerHTML = reviews.map((review) => `
    <article class="account-card admin-review-card">
      <header class="admin-review-header"><div><p class="eyebrow">${escapeHtml(review.status)}</p><h4>${escapeHtml(review.customerName)}</h4></div><span class="admin-review-rating" role="img" aria-label="${Number(review.rating)} out of 5 stars"><span class="admin-review-rating-stars" aria-hidden="true">${"★".repeat(Number(review.rating))}<span class="admin-review-rating-empty">${"★".repeat(5 - Number(review.rating))}</span></span><strong>${escapeHtml(`${review.rating}/5`)}</strong></span></header>
      ${review.reviewTitle ? `<h5>${escapeHtml(review.reviewTitle)}</h5>` : ""}
      ${review.reviewText ? `<p class="admin-review-copy">${escapeHtml(review.reviewText)}</p>` : ""}
      <div class="admin-review-meta"><span>Product: ${escapeHtml(review.productName || review.productId)}</span><span>Order: ${escapeHtml(review.orderNumber || review.orderId)}</span><span>${escapeHtml(new Date(review.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</span></div>
      ${review.photos?.length ? `<div class="admin-review-photos">${review.photos.map((photo) => `<img data-review-photo="${escapeHtml(photo.url)}" alt="${escapeHtml(photo.altText)}" loading="lazy">`).join("")}</div>` : ""}
      ${review.status === "approved" ? `<label class="field"><input type="checkbox" data-feature-toggle="${escapeHtml(review.id)}" ${review.isFeatured ? "checked" : ""}>Feature this review</label>` : ""}
      <label class="field admin-review-note">Moderation note <input type="text" maxlength="400" data-review-note="${escapeHtml(review.id)}" value="${escapeHtml(review.adminNote)}"></label>
      ${review.moderationHistory?.length ? `<details class="admin-review-history"><summary>Moderation history (${review.moderationHistory.length})</summary><ol>${review.moderationHistory.map((entry) => `<li><strong>${escapeHtml(entry.action)}</strong><span>${escapeHtml(entry.actor)} · ${escapeHtml(new Date(entry.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }))}</span>${entry.previousStatus || entry.nextStatus ? `<small>${escapeHtml(entry.previousStatus || "new")} → ${escapeHtml(entry.nextStatus || "removed")}</small>` : ""}${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ""}</li>`).join("")}</ol></details>` : ""}
      <div class="admin-review-actions">
        ${review.status !== "approved" ? `<button class="button button-primary" type="button" data-review-action="approve" data-review-id="${escapeHtml(review.id)}">${review.status === "hidden" ? "Restore review" : "Approve"}</button>` : ""}
        ${review.status !== "rejected" && review.status !== "hidden" ? `<button class="button button-outline" type="button" data-review-action="reject" data-review-id="${escapeHtml(review.id)}">Reject</button>` : ""}
        ${review.status !== "hidden" ? `<button class="button button-outline" type="button" data-review-action="hide" data-review-id="${escapeHtml(review.id)}">Hide</button>` : ""}
        <button class="button button-outline" type="button" data-review-action="delete" data-review-id="${escapeHtml(review.id)}">Delete permanently</button>
      </div>
    </article>
  `).join("");
  loadReviewPhotos().catch((error) => showMessage(error.message, true));
}

async function loadReviewPhotos() {
  const images = [...reviewList.querySelectorAll("[data-review-photo]")];
  for (const image of images) {
    const response = await fetch(image.dataset.reviewPhoto, {
      headers: tabSessionHeaders({ Accept: "image/*" }),
      credentials: "same-origin"
    });
    if (!response.ok) {
      if (response.status === 401) {
        const body = await response.json().catch(() => ({}));
        if (body.code === "SESSION_EXPIRED") handleExpiredSession();
      }
      throw new Error("Unable to load a review photo. Please refresh the moderation queue.");
    }
    observeSessionExpiry(response, handleExpiredSession);
    const objectUrl = URL.createObjectURL(await response.blob());
    if (image.isConnected) {
      reviewPhotoObjectUrls.add(objectUrl);
      image.src = objectUrl;
    } else {
      URL.revokeObjectURL(objectUrl);
    }
  }
}

async function loadReviews(status = "pending") {
  const result = await request(`/api/admin/reviews?status=${encodeURIComponent(status)}`);
  displayReviews(result.reviews);
}

async function loadOrders() {
  const ordersResult = await request("/api/admin/orders");
  displayOrders(ordersResult.orders);
  loginPanel.hidden = true;
  dashboard.hidden = false;

  const activeTab = document.querySelector(".review-tab.is-active")?.dataset.reviewTab || "pending";
  const [customResult, reviewResult] = await Promise.allSettled([
    request("/api/admin/custom-orders"),
    loadReviews(activeTab)
  ]);
  if (customResult.status === "fulfilled") {
    displayCustomOrders(customResult.value.requests);
  } else {
    showListError(customOrderList, "Custom requests couldn't be loaded", customResult.reason);
    showMessage("Orders loaded, but custom requests couldn't be loaded. Refresh and try again.", true);
  }
  if (reviewResult.status === "rejected") {
    showListError(reviewList, "Reviews couldn't be loaded", reviewResult.reason);
    if (customResult.status === "fulfilled") {
      showMessage("Orders loaded, but customer reviews couldn't be loaded. Refresh and try again.", true);
    }
  }
}

document.querySelector("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ email: form.elements.email.value, password: form.elements.password.value })
    });
    form.reset();
    await loadOrders();
    showMessage("Signed in to the studio order desk.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

customOrderList.addEventListener("submit", async (event) => {
  const form = event.target.closest(".admin-custom-offer");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await request(`/api/admin/custom-orders/${encodeURIComponent(form.dataset.customOrder)}/offer`, {
      method: "POST",
      body: JSON.stringify(values)
    });
    await loadOrders();
    showMessage(result.notificationSent
      ? "Priced offer emailed to the customer."
      : "Offer saved, but its email wasn't sent. Check email configuration and resend the offer.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

customOrderList.addEventListener("click", async (event) => {
  const reject = event.target.closest("[data-custom-reject]");
  if (reject) {
    const isResend = reject.closest(".admin-custom-order").querySelector(".status-pill").textContent === "rejected";
    if (!window.confirm(isResend ? "Resend the decline email to this customer?" : "Decline this custom request and email the customer?")) return;
    reject.disabled = true;
    try {
      const result = await request(`/api/admin/custom-orders/${encodeURIComponent(reject.dataset.customReject)}/reject`, {
        method: "POST",
        body: JSON.stringify({
          adminNote: reject.closest(".admin-custom-order").querySelector('[name="adminNote"]')?.value ??
            reject.dataset.customNote ?? ""
        })
      });
      await loadOrders();
      showMessage(result.notificationSent
        ? isResend ? "Decline email sent again." : "Request declined and customer emailed."
        : isResend ? "The decline email still couldn't be sent." : "Request declined, but the customer email wasn't sent.");
    } catch (error) {
      showMessage(error.message, true);
    }
    return;
  }

  const photoButton = event.target.closest("[data-custom-photo]");
  if (!photoButton) return;
  photoButton.disabled = true;
  try {
    const response = await fetch(`/api/admin/custom-orders/${encodeURIComponent(photoButton.dataset.customPhoto)}/photo`, {
      headers: tabSessionHeaders({ Accept: "image/jpeg, image/png, image/webp" }),
      credentials: "same-origin"
    });
    if (!response.ok) throw new Error("We couldn't load this reference photo.");
    const url = URL.createObjectURL(await response.blob());
    customPhotoObjectUrls.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Open reference photo";
    photoButton.replaceWith(link);
  } catch (error) {
    showMessage(error.message, true);
    photoButton.disabled = false;
  }
});

orderList.addEventListener("submit", async (event) => {
  const nimbusForm = event.target.closest(".admin-nimbus-form");
  if (nimbusForm) {
    event.preventDefault();
    const button = nimbusForm.querySelector('[type="submit"]');
    button.disabled = true;
    try {
      const values = Object.fromEntries(new FormData(nimbusForm));
      const result = await request(`/api/admin/orders/${encodeURIComponent(nimbusForm.dataset.nimbusOrder)}/nimbuspost`, {
        method: "POST",
        body: JSON.stringify(values)
      });
      await loadOrders();
      showMessage(`NimbusPost shipment booked. AWB: ${result.order.trackingId}`);
    } catch (error) {
      showMessage(error.message, true);
    } finally {
      button.disabled = false;
    }
    return;
  }
  const form = event.target.closest(".admin-order-form");
  if (!form) return;
  event.preventDefault();
  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(form));
    const result = await request(`/api/admin/orders/${encodeURIComponent(form.dataset.adminOrder)}`, {
      method: "PATCH",
      body: JSON.stringify(values)
    });
    await loadOrders();
    showMessage(result.notificationSent === false
      ? "Order updated, but we couldn't send the customer status email."
      : "Order and customer tracking have been updated.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#admin-refresh").addEventListener("click", async () => {
  const button = document.querySelector("#admin-refresh");
  button.disabled = true;
  try {
    await loadOrders();
    showMessage("Orders refreshed.");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    button.disabled = false;
  }
});

viewToggle.addEventListener("click", async () => {
  if (dashboardView === "reviews") {
    setDashboardView("orders");
    return;
  }
  viewToggle.disabled = true;
  try {
    const activeTab = document.querySelector(".review-tab.is-active")?.dataset.reviewTab || "pending";
    await loadReviews(activeTab);
    setDashboardView("reviews");
  } catch (error) {
    showMessage(error.message, true);
  } finally {
    viewToggle.disabled = false;
  }
});

customViewToggle.addEventListener("click", () => {
  setDashboardView(dashboardView === "custom" ? "orders" : "custom");
});

reviewTabs.forEach((button) => {
  button.addEventListener("click", async () => {
    const status = button.dataset.reviewTab;
    reviewTabs.forEach((tab) => {
      const active = tab === button;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    try {
      await loadReviews(status);
    } catch (error) {
      showMessage(error.message, true);
    }
  });
});

if (reviewList) {
  reviewList.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-review-action]");
    if (!action) return;
    const id = action.dataset.reviewId;
    const actionName = action.dataset.reviewAction;
    const card = action.closest(".admin-review-card");
    const adminNote = card.querySelector(`[data-review-note="${CSS.escape(id)}"]`)?.value || "";
    if (actionName === "delete" && !window.confirm("Delete this review and its photos permanently? This action cannot be undone.")) return;
    try {
      if (actionName === "delete") {
        await request(`/api/admin/reviews/${encodeURIComponent(id)}`, {
          method: "DELETE",
          body: JSON.stringify({ adminNote })
        });
      } else {
        const status = actionName === "approve" ? "approved" : actionName === "reject" ? "rejected" : "hidden";
        await request(`/api/admin/reviews/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify({ status, adminNote })
        });
      }
      const activeTab = document.querySelector(".review-tab.is-active")?.dataset.reviewTab || "pending";
      await loadReviews(activeTab);
      showMessage(actionName === "delete" ? "Review permanently deleted." : `Review ${actionName === "hide" ? "hidden" : actionName === "approve" ? "approved" : "rejected"}.`);
    } catch (error) {
      showMessage(error.message, true);
    }
  });

  reviewList.addEventListener("change", async (event) => {
    const toggle = event.target.closest("[data-feature-toggle]");
    if (!toggle) return;
    try {
      const card = toggle.closest(".admin-review-card");
      await request(`/api/admin/reviews/${encodeURIComponent(toggle.dataset.featureToggle)}`, {
        method: "PATCH",
        body: JSON.stringify({
          isFeatured: toggle.checked,
          adminNote: card.querySelector(`[data-review-note="${CSS.escape(toggle.dataset.featureToggle)}"]`)?.value || ""
        })
      });
      const activeTab = document.querySelector(".review-tab.is-active")?.dataset.reviewTab || "pending";
      await loadReviews(activeTab);
      showMessage(toggle.checked ? "Review featured." : "Review removed from featured list.");
    } catch (error) {
      showMessage(error.message, true);
    }
  });
}

document.querySelector("#admin-logout").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
    clearSessionExpiry();
    loginPanel.hidden = false;
    dashboard.hidden = true;
    showMessage("Signed out.");
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

loadOrders().catch((error) => {
  loginPanel.hidden = false;
  dashboard.hidden = true;
  if (error.code === "SESSION_EXPIRED") showMessage(error.message, true);
  else if (error.message.includes("administrator")) showMessage("");
  else showMessage(error.message, true);
});

if (tabSessionError) showMessage(tabSessionError, true);
