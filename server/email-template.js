function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderBrandedEmail(text, { actionLabel, actionUrl } = {}) {
  const body = escapeHtml(text ?? "").replace(/\r?\n/g, "<br>");
  const action = actionLabel && actionUrl
    ? `<p style="margin:24px 0;text-align:center;"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;padding:13px 22px;background:#b85f48;color:#fffdf9;font-size:13px;font-weight:bold;letter-spacing:1px;text-decoration:none;">${escapeHtml(actionLabel)}</a></p>`
    : "";

  return `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px 12px;background-color:#f8f4ec;color:#38261d;font-family:Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;margin:0 auto;border:1px solid #e5dbcd;background-color:#fffdf9;">
      <tr>
        <td align="center" style="padding:28px 24px 20px;background-color:#f8f4ec;">
          <img src="cid:meow-cro-logo" width="120" height="120" alt="Meow.Cro — Handmade Crochet Creations" style="display:block;width:120px;height:120px;border:0;">
          <p style="margin:12px 0 0;color:#78816b;font-size:11px;font-weight:bold;letter-spacing:2px;">MADE SLOWLY, MADE WITH LOVE</p>
        </td>
      </tr>
      <tr>
        <td style="padding:28px 32px;color:#38261d;font-size:15px;line-height:1.75;overflow-wrap:anywhere;">${body}${action}</td>
      </tr>
      <tr>
        <td align="center" style="padding:18px 24px;border-top:1px solid #e5dbcd;color:#827469;font-size:12px;line-height:1.6;">
          Little things, made with a lot of love.<br>
          <span style="color:#ca5739;">Meow.Cro Studio</span>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
