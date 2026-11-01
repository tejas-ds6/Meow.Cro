export async function sendPaidOrderEmails(order, emailService, studioEmail) {
  if (!emailService.configured) {
    console.warn("Razorpay payment was captured, but order email could not be sent: email is not configured.");
    return false;
  }

  const items = order.items.map((item) => `- ${item.name} x ${item.qty} — ₹${item.unitPrice * item.qty}`);
  const customerMessage = [
    `Hi ${order.name},`,
    "",
    `Your UPI payment for order ${order.number} has been received.`,
    "",
    ...items,
    "",
    `Subtotal: ₹${order.subtotal}`,
    `Shipping: ${order.shipping ? `₹${order.shipping}` : "Free"}`,
    `Paid total: ₹${order.total}`,
    `Delivery address: ${order.address}, ${order.city} ${order.pin}`,
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
    "Payment: UPI — captured by Razorpay",
    `Razorpay payment ID: ${order.paymentId}`,
    "",
    "Items:",
    ...items,
    "",
    `Subtotal: ₹${order.subtotal}`,
    `Shipping: ${order.shipping ? `₹${order.shipping}` : "Free"}`,
    `Paid total: ₹${order.total}`,
    `Note: ${order.note || "None"}`
  ].join("\n");

  let customerEmailSent = false;
  try {
    await emailService.send({
      to: order.email,
      subject: `Payment received for order ${order.number} — Meow.Cro`,
      text: customerMessage
    });
    customerEmailSent = true;
  } catch (error) {
    console.error("Razorpay payment was captured, but customer confirmation email delivery failed:", error);
  }

  try {
    await emailService.send({
      to: studioEmail,
      replyTo: order.email,
      subject: `Paid Meow.Cro order ${order.number}`,
      text: studioMessage
    });
  } catch (error) {
    console.error("Razorpay payment was captured, but studio order email delivery failed:", error);
  }

  return customerEmailSent;
}
