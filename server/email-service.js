import { readFileSync } from "node:fs";
import { Resend } from "resend";
import { renderBrandedEmail } from "./email-template.js";

export const emailConfigurationMessage = "Email is not configured. Set RESEND_API_KEY, SMTP_FROM to an address on a verified Resend domain, and MAIL_TO in the server environment.";
const logoAttachment = {
  filename: "meow-cro-logo.jpg",
  content: readFileSync(new URL("../public/Images/email-logo.jpg", import.meta.url)),
  contentType: "image/jpeg",
  contentId: "meow-cro-logo"
};

export function createEmailService(configuration, createResendClient = (apiKey) => new Resend(apiKey)) {
  const configured = Boolean(
    configuration.RESEND_API_KEY &&
    configuration.SMTP_FROM &&
    configuration.MAIL_TO
  );
  const resend = configured ? createResendClient(configuration.RESEND_API_KEY) : null;

  return Object.freeze({
    configured,
    async send(message) {
      if (!resend) throw new Error(emailConfigurationMessage);

      const { data, error } = await resend.emails.send({
        ...message,
        from: configuration.SMTP_FROM,
        html: message.html ?? renderBrandedEmail(message.text),
        attachments: [logoAttachment, ...(message.attachments ?? [])]
      });
      if (error) throw new Error(`Resend could not send the email: ${error.message}`);
      if (!data?.id) throw new Error("Resend returned no email ID after sending.");
      return data;
    }
  });
}
