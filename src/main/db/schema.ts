/**
 * Full database schema. Idempotent - safe to run on every app start.
 * Schema version is tracked in app_meta so future migrations can be appended.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- =========================== Company / settings ===========================
CREATE TABLE IF NOT EXISTS company_settings (
  id                  INT PRIMARY KEY DEFAULT 1,
  name                TEXT NOT NULL DEFAULT 'Packaging Box Pakistan',
  legal_name          TEXT DEFAULT '',
  address             TEXT DEFAULT '',
  city                TEXT DEFAULT '',
  country             TEXT DEFAULT 'Pakistan',
  phone               TEXT DEFAULT '',
  phone_alt           TEXT DEFAULT '',
  email               TEXT DEFAULT '',
  website             TEXT DEFAULT '',
  ntn                 TEXT DEFAULT '',
  strn                TEXT DEFAULT '',
  logo_data_url       TEXT DEFAULT '',
  signature_data_url  TEXT DEFAULT '',
  bank_details        TEXT DEFAULT '',
  currency_symbol     TEXT NOT NULL DEFAULT 'Rs.',
  currency_code       TEXT NOT NULL DEFAULT 'PKR',
  default_tax_rate    NUMERIC(6,3) NOT NULL DEFAULT 18.000,
  tax_enabled_default BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_prefix      TEXT NOT NULL DEFAULT 'INV-',
  invoice_next_number INT  NOT NULL DEFAULT 1,
  invoice_pad         INT  NOT NULL DEFAULT 4,
  default_terms       TEXT DEFAULT '',
  default_notes       TEXT DEFAULT '',
  terms_url           TEXT DEFAULT '',
  CONSTRAINT company_settings_singleton CHECK (id = 1)
);

-- =========================== Catalogue ===========================
CREATE TABLE IF NOT EXISTS categories (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL UNIQUE,
  parent_id  INT REFERENCES categories(id) ON DELETE SET NULL,
  sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_categories_parent ON categories(parent_id);

CREATE TABLE IF NOT EXISTS products (
  id            SERIAL PRIMARY KEY,
  sku           TEXT UNIQUE,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  category_id   INT REFERENCES categories(id) ON DELETE SET NULL,
  size_text     TEXT DEFAULT '',
  material      TEXT DEFAULT '',
  color         TEXT DEFAULT '',
  unit          TEXT NOT NULL DEFAULT 'pcs',
  pack_size     INT  NOT NULL DEFAULT 1 CHECK (pack_size > 0),
  unit_price    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  pack_price    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (pack_price >= 0),
  cost_price    NUMERIC(14,4) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  tax_rate      NUMERIC(6,3)  NOT NULL DEFAULT 0,
  stock_qty     NUMERIC(14,3) NOT NULL DEFAULT 0,
  reorder_level NUMERIC(14,3) NOT NULL DEFAULT 0,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products (lower(name));
CREATE INDEX IF NOT EXISTS idx_products_category ON products (category_id);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products (is_active);

CREATE TABLE IF NOT EXISTS stock_movements (
  id         SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change_qty NUMERIC(14,3) NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('purchase','sale','adjustment','return','import','opening')),
  reference  TEXT DEFAULT '',
  note       TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stock_mov_product ON stock_movements(product_id, created_at DESC);

-- =========================== Customers ===========================
CREATE TABLE IF NOT EXISTS customers (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  company    TEXT DEFAULT '',
  phone      TEXT DEFAULT '',
  email      TEXT DEFAULT '',
  address    TEXT DEFAULT '',
  city       TEXT DEFAULT '',
  ntn        TEXT DEFAULT '',
  strn       TEXT DEFAULT '',
  notes      TEXT DEFAULT '',
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (lower(name));

-- =========================== Invoice templates ===========================
CREATE TABLE IF NOT EXISTS invoice_templates (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  base       TEXT NOT NULL DEFAULT 'classic',
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  config     JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =========================== Invoices ===========================
CREATE TABLE IF NOT EXISTS invoices (
  id                SERIAL PRIMARY KEY,
  invoice_no        TEXT NOT NULL UNIQUE,
  invoice_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  due_date          DATE,
  customer_id       INT REFERENCES customers(id) ON DELETE SET NULL,
  customer_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  template_id       INT REFERENCES invoice_templates(id) ON DELETE SET NULL,
  po_number         TEXT DEFAULT '',
  subtotal          NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_type     TEXT NOT NULL DEFAULT 'amount' CHECK (discount_type IN ('amount','percent')),
  discount_value    NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  shipping          NUMERIC(14,2) NOT NULL DEFAULT 0,
  round_off         NUMERIC(14,2) NOT NULL DEFAULT 0,
  total             NUMERIC(14,2) NOT NULL DEFAULT 0,
  paid_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','issued','paid','partial','cancelled')),
  stock_applied     BOOLEAN NOT NULL DEFAULT FALSE,
  notes             TEXT DEFAULT '',
  terms             TEXT DEFAULT '',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_invoices_date     ON invoices(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status);

CREATE TABLE IF NOT EXISTS invoice_items (
  id            SERIAL PRIMARY KEY,
  invoice_id    INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  product_id    INT REFERENCES products(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  description   TEXT DEFAULT '',
  uom           TEXT NOT NULL DEFAULT 'pcs' CHECK (uom IN ('pcs','pack')),
  pack_size     INT NOT NULL DEFAULT 1,
  qty           NUMERIC(14,3) NOT NULL DEFAULT 1,
  unit_price    NUMERIC(14,4) NOT NULL DEFAULT 0,
  discount_pct  NUMERIC(6,3)  NOT NULL DEFAULT 0,
  tax_rate      NUMERIC(6,3)  NOT NULL DEFAULT 0,
  line_total    NUMERIC(14,2) NOT NULL DEFAULT 0,
  sort_order    INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items(invoice_id);

CREATE TABLE IF NOT EXISTS payments (
  id         SERIAL PRIMARY KEY,
  invoice_id INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount     NUMERIC(14,2) NOT NULL,
  method     TEXT NOT NULL DEFAULT 'cash',
  paid_on    DATE NOT NULL DEFAULT CURRENT_DATE,
  note       TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- =========================== Migrations ===========================
-- Columns added after the first release. ADD COLUMN IF NOT EXISTS is
-- idempotent, so this runs harmlessly on every connect.
ALTER TABLE company_settings ADD COLUMN IF NOT EXISTS terms_url TEXT DEFAULT '';

-- Products that are made to order or bought in on demand have no meaningful
-- stock figure. track_stock = FALSE means "unlimited": never deducted by an
-- invoice, never counted as low or out of stock.
ALTER TABLE products ADD COLUMN IF NOT EXISTS track_stock BOOLEAN NOT NULL DEFAULT TRUE;

INSERT INTO company_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
INSERT INTO app_meta (key, value) VALUES ('schema_version','3') ON CONFLICT (key) DO UPDATE SET value = '3';
`
