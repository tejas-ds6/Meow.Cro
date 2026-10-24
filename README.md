# Meow.Cro

## Email setup

The server sends email through Resend's HTTPS API, so it does not need an outbound SMTP connection.

1. Create a Resend account and verify a domain you control for sending.
2. Create an API key in Resend.
3. In Render, add these environment variables to the web service:
   - `RESEND_API_KEY`: the Resend API key.
   - `EMAIL_FROM`: a sender using the verified domain, for example `Meow.Cro <hello@your-verified-domain.com>`.
   - `MAIL_TO`: the studio inbox that receives form submissions and order notifications.
4. Save the variables and redeploy the service.

For local development, put the same variables in `.env`. Do not commit `.env` or expose the API key in browser code. Custom-order request photos are sent as email attachments.
