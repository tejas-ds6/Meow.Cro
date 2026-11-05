CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_sessions (
  token_hash TEXT PRIMARY KEY,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  customer_email TEXT,
  role TEXT NOT NULL CHECK (role IN ('customer', 'admin')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE customer_sessions ADD COLUMN IF NOT EXISTS customer_email TEXT;

CREATE INDEX IF NOT EXISTS customer_sessions_expiry_idx ON customer_sessions (expires_at);
CREATE INDEX IF NOT EXISTS customer_sessions_customer_email_idx ON customer_sessions (customer_email);

CREATE TABLE IF NOT EXISTS customer_email_otp_tokens (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_email_otp_email_idx ON customer_email_otp_tokens (email, created_at DESC);
CREATE INDEX IF NOT EXISTS customer_email_otp_expires_idx ON customer_email_otp_tokens (expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_hash TEXT PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_addresses (
  id UUID PRIMARY KEY,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pin TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS customer_addresses_customer_idx ON customer_addresses (customer_id);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY,
  number TEXT NOT NULL UNIQUE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  customer_email TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  pin TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  items JSONB NOT NULL,
  subtotal NUMERIC(12, 2) NOT NULL,
  shipping NUMERIC(12, 2) NOT NULL,
  discount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL,
  payment_method TEXT NOT NULL,
  payment_status TEXT NOT NULL,
  payment_reference TEXT,
  razorpay_order_id TEXT,
  order_status TEXT NOT NULL DEFAULT 'Order Placed',
  delivery_method TEXT,
  courier_name TEXT,
  tracking_id TEXT,
  tracking_url TEXT,
  courier_status TEXT,
  estimated_delivery DATE,
  nimbuspost_order_id TEXT,
  nimbuspost_awb TEXT,
  nimbuspost_label_url TEXT,
  cancellation_requested BOOLEAN NOT NULL DEFAULT FALSE,
  cancellation_request_status TEXT,
  checkout_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS nimbuspost_order_id TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS nimbuspost_awb TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS nimbuspost_label_url TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS checkout_key TEXT;

CREATE INDEX IF NOT EXISTS orders_customer_created_idx ON orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_created_idx ON orders (customer_email, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_normalized_email_created_idx ON orders (LOWER(BTRIM(customer_email)), created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key_unique_idx ON orders (checkout_key) WHERE checkout_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS product_reviews (
  id UUID PRIMARY KEY,
  product_id TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id) ON DELETE CASCADE,
  order_id UUID REFERENCES orders(id) ON DELETE SET NULL,
  customer_name TEXT NOT NULL,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  is_featured BOOLEAN NOT NULL DEFAULT FALSE,
  admin_note TEXT NOT NULL DEFAULT '',
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_id, customer_id, order_id)
);

CREATE TABLE IF NOT EXISTS product_review_photos (
  id UUID PRIMARY KEY,
  review_id UUID NOT NULL REFERENCES product_reviews(id) ON DELETE CASCADE,
  storage_reference TEXT NOT NULL,
  alt_text TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_reviews_product_status_idx ON product_reviews (product_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS product_reviews_customer_idx ON product_reviews (customer_id, product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS product_review_photos_review_idx ON product_review_photos (review_id, sort_order);

CREATE TABLE IF NOT EXISTS order_status_events (
  id UUID PRIMARY KEY,
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS order_status_events_order_idx ON order_status_events (order_id, created_at);
