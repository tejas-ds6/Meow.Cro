import { renderBrandedEmail } from "./email-template.js";

export async function sendPaidOrderEmails(order, emailService, studioEmail) {
  if (!emailService.configured) {
    console.warn("Order confirmation email could not be sent: email is not configured.");
    return false;
  }

  const trackingLink = order.trackingLink || "https://meowcro.in/account.html";
  const supportLink = order.supportLink || "https://meowcro.in/contact.html";
  const items = order.items.map((item) => `- ${item.name} x ${item.qty} — ₹${item.unitPrice * item.qty}`);
  const customerMessage = [
    `Hi ${order.name},`,
    "",
    `Your Meow.Cro order ${order.number} is confirmed! ♡`,
    "",
    `Email: ${order.email}`,
    `Order date: ${new Date(order.createdAt || Date.now()).toLocaleDateString("en-IN", { dateStyle: "medium" })}`,
    "",
    "Your little bundle:",
    ...items,
    ...(order.customOrderId && order.items[0]?.customDescription
      ? ["", "Custom order details:", order.items[0].customDescription]
      : []),
    "",
    `Total: ₹${order.total}`,
    `Payment method: ${order.paymentMethod || "UPI"}`,
    `Payment status: ${order.paymentStatus || "Paid"}`,
    `Order status: ${order.status || "Order Confirmed"}`,
    `Delivery address: ${order.address}, ${order.city} ${order.pin}`,
    "",
    `Track your order: ${trackingLink}`,
    "You may be asked to verify this email before viewing your order.",
    `Need a hand? ${supportLink}`,
    "",
    "Made slowly, with love,",
    "Meow.Cro Studio"
  ].join("\n");
  const studioMessage = [
    `Order: ${order.number}`,
    `Name: ${order.name}`,
    `Email: ${order.email}`,
    `Phone: ${order.phone}`,
    `Address: ${order.address}, ${order.city} ${order.pin}`,
    `Payment: ${order.paymentMethod || "UPI"} — ${order.paymentStatus || "Paid"}`,
    order.paymentId || order.paymentReference ? `Payment reference: ${order.paymentId || order.paymentReference}` : "",
    "",
    "Items:",
    ...items,
    "",
    `Subtotal: ₹${order.subtotal}`,
    `Shipping: ${order.shipping ? `₹${order.shipping}` : "Free"}`,
    `Order total: ₹${order.total}`,
    `Note: ${order.note || "None"}`
  ].filter(Boolean).join("\n");

  let customerEmailSent = false;
  try {
    await emailService.send({
      to: order.email,
      subject: "Your Meow.Cro order is confirmed! ♡",
      text: customerMessage,
      html: renderBrandedEmail(customerMessage, {
        actionLabel: "TRACK MY ORDER",
        actionUrl: trackingLink
      })
    });
    customerEmailSent = true;
  } catch (error) {
    console.error("Customer order confirmation email delivery failed:", error);
  }

  try {
    await emailService.send({
      to: studioEmail,
      replyTo: order.email,
      subject: `New Meow.Cro order ${order.number}`,
      text: studioMessage
    });
  } catch (error) {
    console.error("Studio order notification email delivery failed:", error);
  }

  return customerEmailSent;
}

export async function sendOrderStatusEmail(order, emailService, trackingLink, note = "") {
  if (!emailService.configured) return false;
  const message = [
    `Hi ${order.name},`,
    "",
    `There’s a little update on order ${order.number}: ${order.status}.`,
    note ? `Studio note: ${note}` : "",
    "",
    `Track your order: ${trackingLink}`,
    "You may be asked to verify this email before viewing your order.",
    "",
    "Made slowly, with love,",
    "Meow.Cro Studio"
  ].filter(Boolean).join("\n");
  await emailService.send({
    to: order.email,
    subject: `A little update on your Meow.Cro order ${order.number}`,
    text: message,
    html: renderBrandedEmail(message, {
      actionLabel: "VIEW ORDER STATUS",
      actionUrl: trackingLink
    })
  });
  return true;
}

export async function sendCustomOrderOfferEmail(request, emailService, paymentLink) {
  if (!emailService.configured) return false;
  const message = [
    `Hi ${request.name},`,
    "",
    "We'd love to make your custom crochet idea.",
    `Your custom order price is ₹${request.quotedAmount}.`,
    request.adminNote ? `A note from the studio: ${request.adminNote}` : "",
    "",
    "Review the offer, add your delivery address, and pay securely to confirm your order.",
    `This offer expires on ${new Date(request.quoteExpiresAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`,
    "",
    "Made slowly, with love,",
    "Meow.Cro Studio"
  ].filter(Boolean).join("\n");
  await emailService.send({
    to: request.email,
    subject: "Your Meow.Cro custom order offer is ready",
    text: message,
    html: renderBrandedEmail(message, {
      actionLabel: "REVIEW & CONFIRM YOUR ORDER",
      actionUrl: paymentLink
    })
  });
  return true;
}

export async function sendCustomOrderRejectionEmail(request, emailService) {
  if (!emailService.configured) return false;
  const message = [
    `Hi ${request.name},`,
    "",
    "Thank you for sharing your custom crochet idea with us.",
    request.adminNote || "Unfortunately, we're unable to take on this custom order right now.",
    "",
    "We appreciate you thinking of our little studio.",
    "",
    "Made slowly, with love,",
    "Meow.Cro Studio"
  ].join("\n");
  await emailService.send({
    to: request.email,
    subject: "An update on your Meow.Cro custom request",
    text: message,
    html: renderBrandedEmail(message)
  });
  return true;
}
