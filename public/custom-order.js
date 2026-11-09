import { tabSessionHeaders } from "./tab-session.js";

const message = document.querySelector("#custom-order-message");
const content = document.querySelector("#custom-order-content");
const form = document.querySelector("#custom-order-payment-form");
const token = new URLSearchParams(window.location.search).get("token") || "";
const formatPrice = (amount) => new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
}).format(amount);

function showMessage(value, isError = false) {
  message.textContent = value;
  message.classList.toggle("message-error", isError);
  message.classList.toggle("message-success", !isError);
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
    throw new Error("Could not reach the studio. Check your connection and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "We couldn't load this custom order. Please try again.");
  return result;
}

function showOffer(offer) {
  document.querySelector("#custom-order-name").textContent = offer.name;
  document.querySelector("#custom-order-idea").textContent = offer.idea;
  document.querySelector("#custom-order-details").textContent = offer.details ? `Details: ${offer.details}` : "";
  document.querySelector("#custom-order-note").textContent = offer.adminNote ? `Studio note: ${offer.adminNote}` : "";
  document.querySelector("#custom-order-price").textContent = formatPrice(offer.quotedAmount);
  content.hidden = false;
  showMessage(`Offer sent to ${offer.email}. The price shown is the total for your custom piece.`);
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!form.reportValidity()) return;
  if (!window.Razorpay) {
    showMessage("Secure payment could not be loaded. Refresh the page or contact the studio.", true);
    return;
  }

  const button = form.querySelector('[type="submit"]');
  button.disabled = true;
  const originalText = button.innerHTML;
  button.textContent = "Preparing secure payment…";
  try {
    const checkout = Object.fromEntries(new FormData(form));
    const payment = await request("/api/custom-orders/payment", {
      method: "POST",
      body: JSON.stringify({ ...checkout, token })
    });
    const razorpay = new window.Razorpay({
      key: payment.keyId,
      order_id: payment.orderId,
      amount: payment.amount,
      currency: payment.currency,
      name: "Meow.Cro",
      description: "Custom crochet order",
      handler: async (details) => {
        try {
          const result = await request("/api/payments/razorpay/verify", {
            method: "POST",
            body: JSON.stringify({ ...details, verificationToken: payment.verificationToken })
          });
          window.location.assign(`/account.html?order=${encodeURIComponent(result.order.id)}`);
        } catch (error) {
          showMessage(`${error.message} If your UPI app shows a debit, don't pay again—contact the studio.`, true);
          button.disabled = false;
          button.innerHTML = originalText;
        }
      },
      modal: {
        ondismiss() {
          button.disabled = false;
          button.innerHTML = originalText;
        }
      },
      prefill: { name: document.querySelector("#custom-order-name").textContent }
    });
    razorpay.open();
  } catch (error) {
    showMessage(error.message, true);
    button.disabled = false;
    button.innerHTML = originalText;
  }
});

if (!token) {
  showMessage("This offer link is missing. Please open the link in your studio email.", true);
} else {
  request(`/api/custom-orders/offer?token=${encodeURIComponent(token)}`)
    .then(({ offer }) => showOffer(offer))
    .catch((error) => showMessage(error.message, true));
}
