# User guide

Day-to-day use of PackagingBox Invoice. For getting it onto a PC in the first
place, see [INSTALL.md](INSTALL.md).

- [Products and stock](#products-and-stock)
- [Importing a product list](#importing-a-product-list)
- [Brands](#brands)
- [Customers](#customers)
- [Making an invoice](#making-an-invoice)
- [Round off](#round-off)
- [Payments](#payments)
- [Invoice history](#invoice-history)
- [Stamps](#stamps)
- [Your signature](#your-signature)
- [Printing and PDFs](#printing-and-pdfs)
- [Invoice templates](#invoice-templates)
- [Reports](#reports)
- [Backups](#backups)

---

## Products and stock

### Dual pricing

Every product has **a price per piece and a price per pack**, matching how
packaging is quoted. Enter either one and the app works out the other from the
pack size.

> A cake box at Rs. 3,500 for 50 pieces: type `3500` as the pack price with a
> pack size of `50`, and the per-piece price becomes `70.00`.

### Unlimited stock

Not everything needs counting. Tick **Unlimited stock** on a product and the app
stops tracking a quantity for it:

- invoices never deduct it,
- it is never reported as low or out of stock,
- it shows as **∞ unlimited** in the product list,
- the stock-adjust button disappears, because there is nothing to adjust.

Use it for made-to-order printing, design and plate charges, or anything you can
always get hold of. Turning it back off asks you for a starting quantity.

### Stock

Each product has a stock quantity and a reorder level. The sidebar shows a
badge counting products at or below their reorder level, and the dashboard
lists them.

Stock moves on its own:

| What you do | What happens to stock |
|---|---|
| Save an invoice as a **draft** | Nothing — drafts never touch stock |
| **Issue** an invoice | Deducted |
| Record a payment on a draft | The draft is issued, so stock is deducted |
| **Cancel** an invoice | Returned |
| **Delete** an invoice | Returned |
| Edit an issued invoice | Old quantities returned, new ones deducted |

To correct stock by hand, open the product and use **Adjust stock** — a
purchase, a return, an opening balance or a plain adjustment. Everything is
recorded under **Stock History** with the reason and the invoice number.

### Deleting

A product that has never appeared on an invoice is deleted outright. One that
has is **deactivated** instead, so your old invoices keep their lines. The same
applies to customers.

---

## Importing a product list

**Import CSV** in the sidebar.

1. **Choose a file.** Columns are matched to fields automatically — it
   recognises `Item Code`, `SKU`, `Product Title`, `Name`, `Qty Per Pack`,
   `Price Per Piece`, `Regular price`, `In Stock` and many more spellings.
2. **Check the matching** and correct anything it got wrong.
3. **Set the options:**
   - *Create categories* — make categories found in the file. Nested paths
     work: `Bakery Packaging > Cake Boxes` creates the child under the parent.
     A plain name like `Cake Boxes` matches the existing category rather than
     making a duplicate.
   - *On duplicate* — **update** the existing product or **skip** it. Matching
     is by SKU or by name, your choice.
   - *Derive prices* — work out the per-piece price from the pack price.
4. **Import.** You get a count of inserted, updated and skipped rows, plus any
   errors with their row numbers.

Prices are cleaned automatically: `₨ 3,500` and `Rs. 1,250.50` both import
correctly.

**Download sample CSV** writes a ready-to-fill file with real products in it,
which is the easiest way to see the expected format.

### Importing from WooCommerce / WordPress

A product CSV exported straight out of WooCommerce works as-is — no editing, no
deleting columns. The app recognises the export and maps the columns by their
exact WooCommerce names, so `Type`, `Parent`, `In stock?`, `Regular price`,
`Sale price`, `Low stock amount` and the dimension columns all land in the right
place. The forty-odd columns it cannot use (`Tax status`, `Images`, `Tags`,
`Backorders allowed?` and so on) are ignored rather than guessed at.

**Simple products** import directly.

**Variable products** are containers — in WooCommerce the sellable items are
their *variations*, which hold the real SKU, price and stock. By default the
variations are imported and the empty parent is skipped. A parent whose
variations are not in the file is always imported anyway, so nothing is lost.
If you would rather have the parent as well, switch *Variable products* to
**Import the parent product as well**.

**Variation names.** WooCommerce gives every variation the same name, with only
the attributes telling them apart. With *Add attribute values to variation
names* ticked, `Cake Box` becomes `Cake Box - Red`, `Cake Box - Blue` and so on,
so you can actually find the right one when invoicing. Attributes called
Colour, Size or Material are also copied into those fields on the product.
Anything a variation leaves blank — description, category — is inherited from
its parent, exactly as WooCommerce does.

**Prices.** The regular price is used, unless there is a sale price, which is
what the customer actually pays.

**Stock.** WooCommerce leaves `Stock` blank when stock management is switched
off for a product — that means *always available*, not *none left*. The
**When the file gives no stock figure** setting decides what happens:

| Setting | Blank stock | `0` stock | Marked out of stock |
|---|---|---|---|
| *Mark the product unlimited* (default) | unlimited | 0, tracked | 0, tracked |
| *Mark unlimited when blank or zero* | unlimited | unlimited | unlimited |
| *Set the stock to 0* | 0, tracked | 0, tracked | 0, tracked |

Products that arrive as unlimited are counted on the summary at the end, and you
can change any of them on the product itself.

**Unpublished products** (`Published` = `-1`) import as inactive, so they stay
out of your invoicing but are not lost.

---

## Brands

A brand is a business you invoice as. If you trade under more than one name,
each gets its own letterhead and its own invoice numbers, while sharing one
product catalogue and one customer list.

**Settings - Brands.** Each brand holds:

- trading name, legal name, address, city, country
- phone, WhatsApp, email, website, NTN and STRN
- logo and signature (draw it or upload a scan)
- payment / bank details
- default notes and terms for new invoices
- the link to that brand's terms & conditions, and its wording
- **its own invoice numbering** - prefix, next number and padding

Give each brand a different prefix - `INV-` and `LPC-`, say - so their numbers
can never collide. The next number for each is shown in the list.

One brand is the **default** and is used for new invoices. Press the star on
another row to change that.

### Invoicing under a brand

Once you have more than one, the invoice editor shows an **Invoice as** box.
Changing it switches the letterhead in the preview, takes the next number from
that brand's sequence, and brings in that brand's default notes and terms.

The brand's details are **copied onto the invoice when you save it**, so
editing a brand later never rewrites invoices you have already sent - exactly
as with customer details.

### Removing a brand

A brand that has issued invoices is made **inactive** rather than deleted, so
those invoices keep their letterhead. An unused one is deleted outright. You
cannot remove your only active brand.

## Customers

Name, company, phone, email, address, city, NTN and STRN. Search by any of
them.

Customer details are **copied onto each invoice at the moment you save it**.
Editing a customer later never rewrites an invoice you have already sent —
which is what you want when an address changes.

You do not have to create a customer at all. Leave it as *Walk-in customer*.

---

## Making an invoice

**New Invoice** (or `Ctrl+N`).

### Lines

Type in the product box to search by name, SKU or size, and pick a match. Or
just type anything you like — **a line does not have to be a product in the
catalogue**. A line that is not a product never affects stock, which makes it
right for delivery charges, printing plates or one-off work.

Per line you set:

- **Unit** — pieces or packs. Choosing packs multiplies by the pack size when
  stock is deducted, so 3 packs of 100 removes 300 pieces.
- **Qty**, **Rate** — the rate is yours to change on any line.
- **Disc %** — a discount on that line alone.
- **Tax %** — only shown when *Apply sales tax* is ticked.

### Whole-invoice figures

- **Discount** — a rupee amount or a percentage. It is spread across the lines
  proportionally, so each line is still taxed at its own rate.
- **Delivery / courier**
- **Round off** — see below.

### Draft or issued

A **draft** keeps a temporary number like `DRAFT-M3K9P2`, does not touch stock
and does not use up an invoice number. **Issuing** assigns the next real number
(`INV-0001`) and deducts stock.

Numbers are handed out under a database lock, so two windows can never take the
same one.

---

## Round off

Round off nudges the final total to a neat figure — useful when you would
rather hand over `Rs. 118,600` than `Rs. 118,555`.

You do not have to work it out. The buttons do it:

| Button | Effect |
|---|---|
| **Whole** | Removes the paisa |
| **To 10** | Nearest ten rupees |
| **To 100** | Nearest hundred rupees |
| **None** | No rounding |

The line underneath always shows the sum:

> Rs. 118,555.00 + Rs. 45.00 = **Rs. 118,600.00**

The adjustment is **printed on the invoice** whenever it is not zero, so the
figures on the page always add up to the total. You can type your own amount
instead, positive or negative.

---

## Payments

Open an invoice and use **Record payment**. Each payment has an amount, a
method (cash, bank transfer, Easypaisa, JazzCash, card, cheque or other), a
date and an optional note such as a cheque number or transaction ID.

The status follows the money by itself:

- Part paid → **partial**
- Paid in full → **paid**
- Delete a payment → the status goes back

Recording a payment against a draft issues it first.

### What the customer sees

Under the totals the invoice prints a payment band:

> **PAID IN FULL** — Rs. 50,000.00 received by Bank Transfer on 23-Nov-2026.
> No balance outstanding — thank you.

> **PARTIALLY PAID** — Rs. 50,000.00 received by Bank Transfer on 23-Nov-2026.
> Balance of Rs. 68,600.00 is still due.

> **UNPAID** — Full amount of Rs. 118,600.00 is due.

Every payment is listed underneath with its date, method, note and amount.
Drafts and cancelled invoices print nothing.

**The colours are yours to pick.** In the template designer under *Totals* there
is a colour for each state — paid, partially paid and unpaid — plus a slider for
how strongly the band is tinted with that colour. The colour drives the badge
text, the left edge and the background tint together. Set the tint to 0 for a
plain band. To hide the band entirely, turn off *Show payment status band*.

---

## Invoice history

Every invoice keeps a record of what has happened to it. Open an invoice and
scroll to **History** to see it: created, edited, issued, cancelled, each
payment taken or removed, and duplications - newest first, with both how long
ago and the exact date and time.

An edit says what actually moved - the customer, dates, PO number, a line's
price, the discount, delivery, round-off, tax, the notes or the terms - not just
that something did:

> **Edited** - Edited: total 112,000.00 to 118,600.00, 2 to 3 lines
>
> **Payment** - Payment of 50,000.00 by Bank Transfer, 68,600.00 still due
>
> **Status** - Status changed from draft to issued

For the whole picture of one customer, go to **Customers** and press the
**clock** button on their row. That shows everything across all of their
invoices, each entry labelled with its invoice number.

Two details worth knowing:

- **Deleting an invoice does not erase its history.** The trail stays, with the
  invoice number and customer on it, and a *Deleted* entry is added. So there is
  always a record that the invoice existed and what happened to it.
- Entries recorded while an invoice was still a draft are **renumbered** when it
  is issued, so the whole trail carries the real invoice number.
- An invoice raised for a walk-in and later assigned to a customer takes its
  whole history with it, so the customer's trail starts where the invoice did.

## Stamps

A stamp is pressed onto the invoice the way a rubber stamp would be - small,
solid and at an angle - as opposed to the watermark, which washes across the
whole page. Set it up in the template designer under **Stamp**.

**Which stamp.** Leave it on **Automatic** and it follows the invoice:

| Invoice | Stamp |
|---|---|
| Paid in full | **PAID** (green) |
| Part paid | **PART PAID** (amber) |
| Issued, nothing paid | **UNPAID** (red) |
| Cancelled | **CANCELLED** (red) |

Or choose one to use on every invoice with that template - PAID, PART PAID,
UNPAID, CANCELLED, DRAFT, ORIGINAL, DUPLICATE or RECEIVED. Each carries the
invoice date inside the frame.

**Your own stamp.** Choose *My own image* and upload a scan of your company
stamp. A PNG with a transparent background looks best.

**Placing it.** Pick one of seven positions, then set the size, rotation,
opacity and a nudge across or down. The default sits in the clear space beside
the totals so it does not cover the signature line.

Drafts are not stamped by the automatic setting, since they are not usually
sent out. An explicitly chosen stamp still prints on them.

## Your signature

**Settings - Company - Signature.** Two ways to set it:

- **Draw signature** opens a pad you can sign on with a mouse, trackpad, pen or
  finger. Press harder or move slowly for a thicker line; move quickly and it
  tapers. Pick one of four ink colours and a nib size, undo a stroke at a time,
  or clear and start again. The dashed guide line is there to sign along and is
  never part of the saved image.
- **Upload image...** takes a scan or photo of a signature you already have.

Either way the signature appears above the signature line on every invoice. A
drawn signature is saved with a transparent background and trimmed to the ink,
so it sits on the page without a white box around it.

### A different signature on one template

The template designer has the same **Draw** and **Upload** buttons under
*Notes, terms & signature*. A signature set there is used by **that template
only**; every other template carries on using the company one. Press **Use
company signature** to clear it again.

That is the way to have quotations signed by one person and invoices by
another, or to keep one template deliberately unsigned for printing and signing
by hand.

Remember to press **Save** afterwards - drawing alone does not save the setting.

## Printing and PDFs

- **⛶ Preview** — the whole invoice at full size, exactly as it will print.
- **◧** — hide the side preview when you want a wider form.
- **Print** — any Windows printer.
- **Save PDF** — one file.
- On the **Invoices** list, select several and export them all to a folder at
  once.

Page numbers are placed by the print engine, so they are right on multi-page
invoices.

---

## Invoice templates

Six designs ship with the app: Classic Teal, Modern Blue, Minimal Mono, Bold
Header, Compact Dense and Thermal 80mm. Any of them can be edited, duplicated
or replaced, and you can pick a different one per invoice.

**Invoice Templates** in the sidebar opens the designer, with a live preview
beside it. You can change:

| Area | What you can change |
|---|---|
| Page | A4 / Letter / Legal / A5, portrait or landscape, all four margins, background |
| Fonts | Family, and separate sizes for body, company name, headings, table header, table body, totals and footer; line height; letter spacing; colours |
| Logo | Own image per template — width, height, opacity, alignment and position |
| Header | Title and subtitle text, alignment, colours, padding, company and contact blocks, underline |
| Document title | Text (INVOICE / TAX INVOICE / QUOTATION…), size, colour, alignment, uppercase |
| Items table | Which of 10 columns appear, their heading, width, alignment and order; zebra striping; grid lines; row height; padding |
| Totals | Position and width; which rows show; amount in words (crore/lakh); the payment status band and **its colours**; space below |
| Blocks | Notes, terms, payment details, signature (with its own drawn or uploaded image), thank-you line |
| Footer | Text with placeholders, alignment, colours, page numbers, and whether it is pinned to the foot of the page |
| Stamp | PAID / UNPAID / CANCELLED and the rest, or your own image; colour, position, size, rotation, opacity |
| Watermark | Text or image, size, colour, opacity, rotation, tiling, and automatic DRAFT / PAID / CANCELLED stamps |

Header, footer and title text accept placeholders:
`{{company_name}}`, `{{company_address}}`, `{{company_phone}}`,
`{{company_email}}`, `{{company_website}}`, `{{company_ntn}}`,
`{{invoice_no}}`, `{{invoice_date}}`, `{{due_date}}`, `{{customer_name}}`,
`{{total}}`, `{{balance}}`, `{{year}}`, `{{page}}`, `{{pages}}`.

**Restore presets** brings the six originals back without touching the ones you
made.

---

## Reports

**Dashboard** — revenue this month and in total, outstanding balance, stock
value, low and out-of-stock counts, best sellers, recent invoices and a
twelve-month revenue chart.

**Reports** — pick a date range and get totals grouped by day, by customer and
by product.

---

## Backups

**Everything you have is in one PostgreSQL database.** If that is lost and you
have no backup, it is gone. Set this up on day one.

**Settings → Database → Backup & restore.**

### Taking one

**Back up now** writes a single compressed `.dump` file to your backup folder
(by default `Documents\PackagingBox Backups`). Copy it to a USB drive or a
cloud folder — a backup on the same disk does not help if the disk dies.

### Automatic backups

Turn on **Back up automatically while the app is open**, choose how many hours
between backups and how many to keep. Only automatic backups are pruned; ones
you take yourself are kept for good.

### Restoring

Pick a backup from the list and press **Restore**, or **Restore from file…**
for one from elsewhere.

Restoring **replaces everything** in the database with the contents of that
backup. Anything created since it was taken is gone.

Before it does that, the app **takes a safety copy of your current data** and
names it `…-pre-restore-….dump`. If you restore the wrong file, restore that
one to get back to where you were. If the safety copy fails, the restore is
abandoned rather than risking your data.

### If backups will not run

The feature uses `pg_dump` and `pg_restore`, which come with PostgreSQL. They
are found automatically — the newest installed version is used, because they
refuse to work against a newer server than themselves. If they are somewhere
unusual, set the path under *pg_dump location*.
