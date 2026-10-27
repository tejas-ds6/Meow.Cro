import nodemailer from "nodemailer";

export const emailConfigurationMessage = "Email is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, and MAIL_TO in the server environment.";

export function createEmailService(configuration, createTransport = nodemailer.createTransport) {
  const port = Number(configuration.SMTP_PORT);
  const configured = Boolean(
    configuration.SMTP_HOST &&
    Number.isInteger(port) &&
    port > 0 &&
    port <= 65535 &&
    configuration.SMTP_USER &&
    configuration.SMTP_PASS &&
    configuration.SMTP_FROM &&
    configuration.MAIL_TO
  );
  const transport = configured
    ? createTransport({
        host: configuration.SMTP_HOST,
        port,
        secure: configuration.SMTP_SECURE?.toLowerCase() === "true",
        auth: {
          user: configuration.SMTP_USER,
          pass: configuration.SMTP_PASS
        }
      })
    : null;

  return Object.freeze({
    configured,
    async send(message) {
      if (!transport) throw new Error(emailConfigurationMessage);
      const { attachments, ...messageDetails } = message;
      return transport.sendMail({
        ...messageDetails,
        from: configuration.SMTP_FROM,
        ...(attachments?.length
          ? {
              attachments: attachments.map(({ filename, content, contentType }) => ({
                filename,
                content,
                contentType
              }))
            }
          : {})
      });
    }
  });
}
