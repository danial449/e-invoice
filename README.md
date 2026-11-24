# E-Invoice

Desktop inventory and invoicing for small businesses. A Windows app built with
Electron, React and TypeScript that keeps everything in a **local PostgreSQL**
database — no cloud, no subscription, your data stays on your machine.

Invoice as **more than one brand** from a single catalogue: each brand carries
its own letterhead, bank details, terms and invoice number sequence. The
starter data is pre-filled for
[packagingbox.pk](https://packagingbox.pk), and is yours to change.

[![CI](https://github.com/danial449/e-invoice/actions/workflows/ci.yml/badge.svg)](https://github.com/danial449/e-invoice/actions/workflows/ci.yml)

---

## Download

**[Download the latest release](https://github.com/danial449/e-invoice/releases/latest)**
— grab `E-Invoice-<version>-setup.exe` and run it.

You need PostgreSQL 14 or newer on the same machine. The installer needs no
administrator rights and creates a Desktop and Start menu shortcut.

Windows will warn that the app is unsigned — click **More info → Run anyway**.
Full steps, including installing PostgreSQL, are in
**[docs/INSTALL.md](docs/INSTALL.md)**.

---

## Documentation

| | |
|---|---|
| **[Install guide](docs/INSTALL.md)** | Setting it up on a PC, first run, updating, troubleshooting |
| **[User guide](docs/USER-GUIDE.md)** | Products, CSV import, invoicing, payments, templates, backups |
| **[Development](docs/DEVELOPMENT.md)** | Build from source, project layout, the audit, things that will bite you |
| **[Releasing](docs/RELEASING.md)** | How a new version gets built and published |
| **[Changelog](CHANGELOG.md)** | What changed in each version |

---

## What it does

### Inventory
- Products with **dual pricing**: price per piece *and* price per pack. Enter
  either one and the other is calculated from the pack size — matching how
  packagingbox.pk quotes (e.g. Rs. 3,500 for 50 pcs = Rs. 70/piece).
- Category tree pre-loaded with all 54 categories from the website
  (Food, Bakery, Pouches & Bags, Boxes & Tins, Disposables & ECO, Plastic).
- Stock tracking with reorder levels, low/out-of-stock alerts, and a full
  movement history (purchase, sale, return, adjustment, import, opening).
- Stock is deducted automatically when an invoice is issued and returned if it
  is cancelled or deleted.

### CSV import
- Choose a file, and columns are **auto-matched** to fields. Recognises many
  header spellings (`Item Code`, `Product Title`, `Qty Per Pack`,
  `Price Per Piece`, `In Stock`, `Regular price`, …).
- Prices are cleaned automatically: `₨ 3,500` and `Rs. 1,250.50` both import
  correctly.
- Categories can be created on import, including nested paths
  (`Bakery Packaging > Cake Boxes`). A flat name (`Cake Boxes`) is matched to
  the existing category instead of creating a duplicate.
- Update or skip existing products, matched by SKU or name.
- *Download sample CSV* writes a ready-to-fill file with real products.

### Invoicing
- Pick products by typing (search by name, SKU or size), or write a **custom
  line** with your own description and your own unit price — nothing has to be
  in the catalogue.
- Per line: pieces or packs, quantity, your own rate, discount %, tax %.
- Invoice level: discount (amount or percent), delivery/courier, round-off,
  optional sales tax.
- Drafts keep a temporary number and do not touch stock. Issuing assigns the
  next real number (`INV-0001`, prefix and padding configurable) and deducts
  stock. Numbers are allocated under a row lock, so two windows can never take
  the same one.
- Payments with method and date; status moves to partial/paid automatically.
- **Round off is explained where you use it.** The editor shows the sum —
  `Rs. 118,555.00 + Rs. 45.00 = Rs. 118,600.00` — and one-click buttons round
  the total to a whole rupee, the nearest 10 or the nearest 100. The adjustment
  is printed on the invoice whenever it is not zero, so the figures always add
  up.
- **Preview before you commit.** The side preview can be hidden for a wider
  form, and **⛶ Preview** opens the whole page at full size — the same render
  that Print and Save PDF produce.
- **The invoice says how it was paid.** A band under the totals reads
  *PAID IN FULL — Rs. 50,000.00 received by Bank Transfer on 23-Nov-2026*, or
  *PARTIALLY PAID … Balance of Rs. 68,600.00 is still due*, or *UNPAID*, with
  each payment listed underneath. Switch it off per template if you prefer.
- Terms print with a link to your published T&Cs
  (`packagingbox.pk/terms-and-conditions`), set under Settings → Invoice
  defaults.
- Customer details are **snapshotted** onto each invoice, so editing a customer
  never rewrites past invoices.
- Live preview beside the editor, rendered by the same engine that makes the PDF.

### Invoice templates — fully editable
Six presets ship with the app (Classic Teal, Modern Blue, Minimal Mono, Bold
Header, Compact Dense, Thermal 80mm). Every one can be edited, duplicated or
replaced. Controls cover:

| Area | What you can change |
|---|---|
| **Page** | A4 / Letter / Legal / A5, portrait or landscape, all four margins, background colour |
| **Fonts & text size** | Font family, and independent sizes for body, company name, headings, table header, table body, totals and footer; line height; letter spacing; text colours |
| **Logo** | Show/hide, own image per template, **width, height, opacity, alignment and position** (header left/centre/right, or full width above) |
| **Header** | Show/hide, repeat on every page, title and subtitle text, alignment, background and text colour, padding, company block, contact block, underline and its thickness |
| **Document title** | Text (INVOICE / TAX INVOICE / QUOTATION…), size, colour, alignment, letter spacing, uppercase |
| **Items table** | Which of 10 columns appear, their heading text, width, alignment and order; zebra striping; grid lines; row height; cell padding; blank-row padding |
| **Totals** | Position and width; show/hide subtotal, discount, tax, delivery, round-off, paid, balance; **amount in words** (crore/lakh); grand-total styling |
| **Blocks** | Notes, terms, payment details, signature (with image and width), thank-you line — each with its own heading |
| **Footer** | Show/hide, repeat on every page, text with placeholders, alignment, colours, padding, top line, **page numbers** and their format |
| **Watermark** | **Enable/disable**, text or image, size, colour, opacity, rotation, position, tiling, and an automatic DRAFT / PAID / CANCELLED stamp |

Placeholders usable in header, footer and title text:
`{{company_name}}`, `{{company_legal_name}}`, `{{company_address}}`,
`{{company_full_address}}`, `{{company_city}}`, `{{company_phone}}`,
`{{company_email}}`, `{{company_website}}`, `{{company_ntn}}`,
`{{company_strn}}`, `{{invoice_no}}`, `{{invoice_date}}`, `{{due_date}}`,
`{{po_number}}`, `{{customer_name}}`, `{{customer_company}}`, `{{total}}`,
`{{balance}}`, `{{year}}`, `{{page}}`, `{{pages}}`.

### Output
- Save as PDF, print to any Windows printer, or batch-export many invoices to a
  folder at once.
- Page numbers are placed in the page margin by the print engine, so they are
  correct on multi-page invoices.

### Reports
Dashboard (revenue, outstanding, stock value, alerts, best sellers, 12-month
chart) and a date-range sales report grouped by day, customer and product.

---

## Contributing

```bash
git clone https://github.com/danial449/e-invoice.git
cd e-invoice
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
PGPASSWORD=yourpassword npm run audit     # must be 107/107
```

The audit creates a scratch database, uses it and drops it again — your own
data is never touched. If you add a feature, add checks for it.

[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) covers the architecture and the
non-obvious constraints (the PDF render window, connection handling, schema
migrations, and why a round-off must always be printed).

---

## Licence

Proprietary. Copyright (c) Packaging Box Pakistan. All rights reserved.
