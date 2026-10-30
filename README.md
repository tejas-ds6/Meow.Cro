<div align="center">

# ✿ Meow.Cro — Handmade, With Love

**A little online home for handmade crochet creations.**

A full-stack crochet storefront built to help a talented independent maker showcase her work, connect with customers, and manage orders online.

[Explore the project](#-what-i-built) · [Run locally](#-getting-started) · [Tech stack](#-tech-stack)

</div>

---

## 1. The Problem — Who Had It?

The problem came from someone close to me: **my cousin.**

She is genuinely talented at creating beautiful crochet products by hand. Every piece takes time, patience, creativity, and care. But despite having the skill to make products people would love, she did not have a dedicated online platform to display her creations or a reliable way to reach enough potential customers.

### Why did it hurt?

- **Limited visibility:** Her work was not easy for new people to discover.
- **No dedicated storefront:** Customers had no single place to browse products, see details, and explore the collection.
- **Missed opportunities:** People who might have wanted to buy or request a custom piece could not easily find a clear buying journey.
- **Manual coordination:** Enquiries and orders needed a more organized process instead of depending only on informal conversations.

**Problem statement:** How might we give a skilled handmade creator an affordable, accessible online presence that showcases her crochet work and makes it easier for customers to discover, request, and purchase products?

---

## 2. What I Built

I built **Meow.Cro**, a full-stack e-commerce website designed around a small handmade crochet business. It gives the creator a storefront and gives customers a simple way to explore products and place orders.

### Customer experience

- **Product storefront** — browse a visual catalogue of crochet products with images, descriptions, categories, and prices.
- **Search and discovery** — find products and explore the collection.
- **Shopping cart** — add items, update quantities, remove products, and review the subtotal.
- **Checkout** — submit delivery details and choose Cash on Delivery or UPI payment.
- **Custom orders** — send a request for a personalised crochet creation.
- **Customer accounts** — register, sign in, manage profile details and saved addresses, and view order history.
- **Order updates** — follow order progress from the customer account.
- **Studio communication** — contact and newsletter forms help customers stay connected.

### Studio experience

- **Admin order desk** — a protected area for the studio to view orders and update their status.
- **Order management** — keep delivery progress and cancellation requests organized.
- **Email notifications** — send order and customer-request emails through Resend.

### Tech stack

| Area | Technology |
|---|---|
| Frontend | HTML, CSS, JavaScript (ES modules) |
| Backend | Node.js, Express 5 |
| Database | PostgreSQL (Neon-compatible) |
| Payments | Razorpay (UPI) |
| Email | Resend |
| Testing | Node.js built-in test runner |

---

## 3. The Hardest Problem I Solved

### Making checkout and payment trustworthy

The most challenging part was not simply building a cart or adding a payment button. It was making sure that an order is only treated as paid when the payment provider has actually confirmed it.

A browser-side success message cannot be trusted on its own. Payment details need to be checked on the server before an order is marked as paid.

**How I approached it:**

1. The server creates the Razorpay order using the order total and INR currency.
2. It creates a time-limited, signed verification token for the pending checkout.
3. After the customer completes UPI payment, the server verifies the Razorpay signature.
4. The server fetches the payment from Razorpay and checks that the order ID, amount, currency, and captured status match.
5. Only after those checks pass is the payment accepted as verified.

I also worked on the supporting order flow: validating customer input, keeping product and order data consistent, protecting customer and admin routes, and storing account and order information in PostgreSQL.

**Why this mattered:** A smooth checkout is useful, but a trustworthy checkout is essential. The creator needs confidence that paid orders are real, and customers need confidence that their payments and orders are handled correctly.

---

## 4. The Result

The result is a working, end-to-end storefront that gives the crochet business a more professional digital presence.

- A central place to display and discover handmade products.
- A clear path from browsing to cart and checkout.
- Support for COD and server-verified Razorpay UPI payments.
- A custom-request path for customers who want something made personally.
- Customer accounts, saved addresses, and order history.
- A studio-side order desk for managing fulfilment and updates.

Most importantly, the project turns a real-world problem into a practical product: **it helps bring handmade work closer to the people who may want to buy it.**

> This project was built to solve a problem I could see up close. It is a reminder that useful software does not always have to start with a big idea — sometimes it starts by helping one person take the next step.

---

## ✨ Project Structure

```text
Div's crochet/
├── public/                 # Storefront pages, styles, scripts, and product images
│   ├── Images/
│   ├── app.js
│   ├── catalog.js
│   ├── cart-store.js
│   ├── account.js
│   ├── admin.js
│   └── *.html
├── server/                 # Database, account, email, payment, and validation services
│   ├── schema.sql
│   ├── database.js
│   ├── account-service.js
│   ├── email-service.js
│   ├── payment-service.js
│   └── validation.js
├── tests/                  # Automated tests
├── server.js               # Express application and API routes
├── package.json
├── .env.example
└── README.md
```

## 🚀 Getting Started

### Prerequisites

- Node.js 20 or later
- npm
- A PostgreSQL database (for customer accounts and persistent order management)
- Razorpay credentials (to enable UPI payments)
- A Resend account and verified sending domain (to enable email delivery)

### 1. Clone the repository

```bash
git clone https://github.com/<your-username>/<your-repository>.git
cd your-repository
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Copy `.env.example` to `.env` and fill in the values for the services you want to enable.

```bash
cp .env.example .env
```

Never commit your real `.env` file or publish API keys, database URLs, payment secrets, or admin credentials.

### 4. Start the application

```bash
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser. The server initializes the PostgreSQL schema on startup when `DATABASE_URL` is configured.

### 5. Run checks

```bash
npm test
npm run build
```

`npm test` runs the automated tests. `npm run build` performs JavaScript syntax checks on the main application files.

## 🔐 Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | Port used by the Express server (defaults to `3000`) |
| `DATABASE_URL` | PostgreSQL connection string; enables accounts and persistent order management |
| `DATABASE_SSL` | Set to `true` when the database connection requires certificate verification |
| `RAZORPAY_KEY_ID` | Razorpay public key ID for UPI checkout |
| `RAZORPAY_KEY_SECRET` | Server-side Razorpay secret; keep private |
| `RESEND_API_KEY` | Resend API key for outgoing email |
| `SMTP_FROM` | Verified sender address used for email delivery |
| `MAIL_TO` | Studio inbox that receives customer enquiries and order notifications |

Some integrations are optional during local development. Features that depend on an unconfigured service will not be available until its environment variables are provided.

## 🧪 Tests

The test suite covers key application logic, including:

- Cart behaviour and product catalogue consistency.
- Customer account service behaviour.
- Email service configuration and message creation.
- Razorpay payment verification logic and input validation.

Run all tests with:

```bash
npm test
```

## 🌱 Future Improvements

- Add product inventory and availability management.
- Add analytics for product views, orders, and customer engagement.
- Add more detailed shipping and fulfilment integrations.
- Gather customer feedback and iterate on the shopping experience.

---

<div align="center">

**Made slowly, made with love. ✿**

*A small-business project with a personal story behind every stitch.*

</div>
