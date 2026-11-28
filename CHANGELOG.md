# Changelog

All notable changes to E-Invoice. Versions follow
[semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

## [1.9.1] - 2026-11-28

### Fixed

- **Releases on GitHub had an empty description.** The installer was attached
  and the release was published, but the page said nothing about what had
  changed, because electron-builder does not apply its release-notes setting
  when publishing to GitHub. The notes are now written onto the release
  afterwards, straight from the matching section of this changelog, so each
  release page explains itself.

## [1.9.0] - 2026-11-28

### Changed

- **The watermark stays the one you set on the template.** It was being
  overwritten with DRAFT, PAID or CANCELLED on those invoices, so the mark you
  had designed changed by itself from one invoice to the next. The template's
  watermark is now used on every invoice, whatever its status. The status is
  still shown by the stamp and by the payment band under the totals, which is
  where it belongs. The *Use the invoice status instead* option is gone.
- **The thank-you line sits just above the footer rule.** It used to stay up
  with the notes while the pinned footer dropped to the foot of the page,
  leaving a gap between them. The line and the footer now travel down together,
  so the wording sits immediately above the rule. It prints on the invoice
  only, never on the terms sheet.

## [1.8.1] - 2026-11-28

### Changed

- **The terms page is now a separate sheet.** It was appended inside the
  invoice's own sheet, so on screen the two ran together as one long page with
  a seam. The terms now sit on their own sheet with the same paper size,
  margins and drop shadow as the invoice, and a clear gap between the two.
- **The terms link and its wording are no longer settings.** Those two fields
  are gone from the brand form, and nothing is appended to the invoice behind
  your back. Put a link in the terms themselves with the editor's link button,
  where you can word it however you like and place it where you want it. Links
  already typed into the terms keep working and stay clickable in the PDF.

## [1.8.0] - 2026-11-28

### Added

- **Terms print on a page of their own.** They no longer share the foot of the
  first page with the notes and payment details - that row is down to two
  blocks, and the first page stays about the goods and the money. The terms
  follow on a fresh sheet with a heading, the invoice number, date and customer
  so a page that gets separated can still be traced back, and the link to your
  published terms at the end.

  Under **Invoice Templates - Terms page** you can change the heading, switch
  to two columns for long numbered lists, set the text size and line spacing,
  repeat the header or footer, and add a signature and date strip for the
  customer to accept the terms. Turning the page off puts the terms back where
  they were.

- **A proper editor for the terms.** Bold, italic, underline, strikethrough,
  headings, bullet and numbered lists, indent, quotes, alignment, dividers and
  links - with the formatting carried through exactly onto the printed page.
  The same editor is used for the invoice notes and for a brand's default
  terms, so a new invoice starts from formatted wording.

  **Each invoice keeps its own terms.** Editing them on one invoice never
  touches another, and never changes the brand default they started from.

  Pasted content is cleaned on the way in: scripts, event handlers, styles,
  images and anything else off the allow-list are stripped, so a paste out of
  Word or a web page cannot carry anything into a document you send a customer.

### Changed

- **Print shows the invoice before printing it.** Clicking Print now opens a
  full-size preview with **Print now**, **Save as PDF** and **Cancel**, so you
  can scroll through every page - including the terms - before anything reaches
  the printer. Windows opens a printer dialog with no preview of its own, so
  printing from here was previously done sight unseen.

### Fixed

- The stamp was positioned against the whole document rather than the invoice,
  so once a terms page followed it the stamp landed on that page and covered
  its heading.

## [1.7.0] - 2026-11-24

### Changed

- **The application is now called E-Invoice.** The window title, the sidebar,
  the installer, the desktop shortcut and the About box all use the new name,
  and the installer is `E-Invoice-<version>-setup.exe`.

  This is the name of the *software*, not of the business you invoice as. Your
  company details - including Packaging Box Pakistan as the starter brand - are
  untouched and still come from **Brands**, so nothing on an invoice changes.

  The default backup folder for a new setup is now
  `Documents\E-Invoice Backups`. An existing backup folder is left exactly
  where it is.

  **Your saved database connection and backup settings carry over
  automatically.** Renaming moved the folder Windows keeps them in, so the app
  copies them across on first run rather than asking for the database password
  again.

  The installer upgrades your existing copy in place rather than installing a
  second one beside it.

## [1.6.1] - 2026-11-24

### Changed

- **Settings no longer duplicates what a brand already holds.** Adding brands
  left the old **Company** tab asking for the same name, address, contacts,
  logo and signature a second time, with no indication which one an invoice
  would actually use. That tab is gone, and so are the numbering and default
  text cards, all of which now belong to a brand.

  **Invoice defaults** keeps only what is genuinely shared across every
  brand - currency and the default tax rate - and says where the rest lives.

  Nothing was lost: your details were copied into your first brand when you
  upgraded, and that is where you edit them now.

### Fixed

- **A brand new installation ended up with no brand at all.** The brand was
  created from the company settings by the schema, which runs before those
  settings have a row, so the copy found nothing. It is now created once the
  defaults are in place. Existing installations were unaffected; only a first
  run on an empty database hit this.

## [1.6.0] - 2026-11-24

### Added

- **Brands - invoice as more than one business.** Settings now has a **Brands**
  tab. Each brand carries its own trading and legal name, address, phone,
  email, website, NTN/STRN, logo, signature, bank details, default notes and
  terms, terms link - and **its own invoice number sequence**, so
  `INV-0008` and `LPC-0003` run side by side without ever colliding.

  The invoice editor gains an **Invoice as** picker when you have more than one
  brand. Choosing a brand switches the letterhead in the live preview, takes
  the next number from that brand's sequence, and pulls in its default notes
  and terms.

  Products, customers and templates stay shared, so nothing has to be
  duplicated per brand.

  **The brand is snapshotted onto each invoice**, the same way the customer
  already was, so renaming or editing a brand never rewrites invoices you have
  already sent.

  Your existing company details become your first brand automatically, carrying
  the invoice counter across so numbering continues unbroken, and every
  existing invoice is attached to it.

  A brand that has issued invoices is made inactive rather than deleted, so
  those invoices keep their letterhead, and your last active brand cannot be
  removed.

## [1.5.4] - 2026-11-24

### Fixed

- **The stamp ignored the status you chose.** Setting an invoice to *Paid*
  stamped it **UNPAID**, because the automatic stamp was worked out purely from
  how much money had been recorded against the invoice - and marking it paid
  records nothing. The status now decides: Paid stamps PAID, Partially paid
  stamps PART PAID, Cancelled stamps CANCELLED. Only *Issued*, which says
  nothing about money by itself, still follows the payments.
- The payment band under the totals had the same fault and said UNPAID on an
  invoice marked Paid, contradicting the stamp beside it. It now agrees with
  the status, and no longer claims a payment of zero was received.

### Changed

- **Invoice history moved into a popup.** It is now behind an eye button in the
  invoice toolbar rather than a card wedged between the payments and the notes,
  so the form stays short and the history gets the whole dialog to itself. The
  customer history button uses the same eye icon.

## [1.5.3] - 2026-11-24

### Changed

- **New app icon**: the packaging-box artwork on a white plate with rounded
  corners, used for the application, the installer, the desktop shortcut and
  the taskbar.

  The supplied artwork was white line work on a transparent background, which
  would have been invisible on a white plate, so the shape is used as a stencil
  and inked in dark charcoal. The smallest sizes are drawn with less padding
  and built up over several passes, because thin strokes otherwise average away
  to pale grey when scaled down to 16px.

  `scripts/build-icon.ps1` regenerates every size from `build/icon-source.png`,
  so the icon can be changed - or re-inked - without redoing this by hand.

## [1.5.2] - 2026-11-24

**The first version published as a downloadable release on GitHub.** Everything
listed under 1.1.0 to 1.5.1 is in this installer.

### Fixed

- `npm run dist` failed at the final step looking for `release-notes.md`, which
  until now only the CI workflow produced. The notes file is generated as part
  of `dist`, defaulting to the version in `package.json`.

## [1.5.1] - 2026-11-24

**This is the first version to appear as a downloadable release on GitHub.**
Everything listed under 1.1.0 to 1.5.0 is included in this installer.

### Fixed

- **Releases never reached GitHub.** The release workflow ran the type check
  and then went straight to packaging, without compiling first, so
  electron-builder had no `out/main/index.js` to package and failed every time
  - which is why the tags had no releases attached to them. The workflow now
  compiles before packaging, and checks the compiled entry points exist before
  going any further, so this fails loudly and obviously rather than as a
  confusing packaging error.
- Releases are published rather than created as drafts, which are invisible on
  the Releases page.
- Release notes are taken from the matching section of this changelog.

## [1.5.0] - 2026-11-24

### Added

- **A signature per template.** The template designer, under *Notes, terms &
  signature*, now has **Draw** and **Upload** next to the signature settings -
  the same drawing pad as in Settings. A template with its own signature uses
  it; one without falls back to the company signature, exactly as the logo
  does, so nothing has to be set on templates that do not need it. **Use
  company signature** clears the override again. Useful when quotations are
  signed by someone else, or a particular template should go out unsigned.

## [1.4.0] - 2026-11-24

### Added

- **Draw your signature.** Settings - Company now has a **Draw signature**
  button opening a pad you can sign on with a mouse, trackpad, pen or finger.
  Strokes are smoothed, and the line thickens when you press harder or move
  slowly and tapers when you move fast, so it reads as handwriting rather than
  a constant-width scribble. Four ink colours, an adjustable nib, undo by
  stroke, clear, and an optional guide line to sign along. Only the ink is
  exported - the background stays transparent and the image is trimmed to what
  you drew, so it sits neatly above the signature line on the invoice. Uploading
  a scan still works as before.

### Fixed

- **Edits in the invoice history said nothing useful.** Every edit was reported
  as *"Edited with no change to the figures"* unless the total, line count or
  status happened to change - so changing the customer, dates, PO number,
  discount, delivery, round-off, tax, notes, terms or a line's price looked like
  nothing had happened, and the history appeared to contain only payments. An
  edit is now described properly, for example *"Edited: customer none to Lahore
  Sweets & Bakers, PO none to PO-9981, 1 line changed, total 1,000.00 to
  1,250.00"*. A genuine no-op now says *"Saved with no changes"*.
- **History recorded before a customer was assigned went missing.** Entries
  written while an invoice was a walk-in kept no customer, so they never
  appeared in that customer's history even after the invoice was assigned to
  them. They now follow the invoice to its customer, and existing rows are
  backfilled on upgrade.

## [1.3.1] - 2026-11-24

### Fixed

- **Settings - Invoice defaults laid out badly.** The terms link fields had been
  nested inside the notes/terms row, so they were squeezed into a third column
  beside the two text boxes instead of sitting on their own line. The link now
  has its own card, with the address and the wording side by side, help text
  under each, and a preview strip showing exactly how the line will read on the
  invoice - including when no address is set and no link is printed.

## [1.3.0] - 2026-11-24

### Added

- **Invoice history.** Every invoice now keeps a trail of what happened to it -
  created, edited, issued, cancelled, paid, payment removed, duplicated and
  deleted - with who-changed-what spelled out ("Edited: total 112,000.00 to
  118,600.00, 2 to 3 lines"). It appears as a timeline on the invoice itself,
  and the Customers list has a **History** button showing everything across all
  of that customer's invoices.
  - The trail of a **deleted** invoice survives the deletion, with its number
    and customer intact, so there is a record that it existed.
  - Entries written while an invoice was a draft are renumbered when it is
    issued, so the trail reads as one story rather than two.
- **Stamps.** A rubber stamp can be pressed onto the invoice - PAID, PART PAID,
  UNPAID, CANCELLED, DRAFT, ORIGINAL, DUPLICATE or RECEIVED - each with its own
  ink colour and the invoice date inside the frame. Set it to **Automatic** and
  it follows the invoice's status, or pick one to use always. You can also
  upload a scan of your own stamp. Position, size, rotation, opacity and nudge
  are all adjustable, and the automatic stamp stays off drafts.
- **The footer sits at the foot of the page.** Previously it floated directly
  under the content, so a short invoice had its footer halfway up the sheet. It
  is now pinned to the bottom, and can be unpinned per template.

### Changed

- **The terms link reads as wording, not a web address.** The invoice shows
  *Terms & Conditions* as a proper link instead of printing
  `packagingbox.pk/terms-and-conditions` as text. The wording is yours to set
  under Settings. The link stays clickable in the PDF, and anything that is not
  an ordinary http(s) address is never turned into a link.

## [1.2.0] - 2026-11-24

### Added

- **WooCommerce / WordPress product exports import as-is.** A CSV exported
  straight out of WooCommerce is recognised and its columns matched by their
  exact names, so `Type`, `Parent`, `In stock?`, `Regular price`, `Sale price`,
  `Low stock amount` and the dimension columns all land correctly. The forty-odd
  columns the app cannot use are ignored rather than guessed at.
  - **Variable products** are handled properly: the variations carry the real
    SKU, price and stock, so they are imported and the empty parent container is
    skipped. A parent whose variations are absent from the file is still
    imported, so nothing is lost. Importing the parent as well is an option.
  - **Variations are named from their attributes**, turning three identically
    named rows into `Cake Box - Red`, `Cake Box - Blue` and `Cake Box - Gold`.
    Colour, Size and Material attributes also fill those fields on the product.
  - A variation inherits its parent's description and category, as WooCommerce
    does.
  - A **sale price** overrides the regular price, since that is what the
    customer pays. Unpublished products import as inactive.
- **Unlimited stock.** A product can be marked as not counted: invoices never
  deduct it, it is never reported as low or out of stock, it shows as
  **unlimited** in the list, and the stock-adjust button is hidden. Meant for
  made-to-order work, plate and design charges, and anything always available.
- **The import decides what "no stock figure" means.** WooCommerce leaves
  `Stock` blank when stock management is off, which means always available
  rather than none left. Choose between marking those products unlimited (the
  default), treating blank *and* zero as unlimited, or setting everything to 0.
  The summary at the end says how many came in as unlimited.
- **The payment status band colours can be chosen.** Separate colours for paid,
  partially paid and unpaid, plus a slider for how strongly the band is tinted.
  The colour drives the badge text, the left edge and the background together.

### Fixed

- A plain `Stock` or `In Stock` column in a hand-made sheet is read as a
  quantity again. WooCommerce's `In stock?` flag normalises to the same text, so
  the two are now told apart by exact column name rather than by stripping
  punctuation.
- `Tax status` is no longer mistaken for a tax rate, and `Attribute 1 name` is
  no longer mistaken for the product name.

## [1.1.0] — 2026-11-23

### Added

- **Backup & restore from inside the app** (Settings → Database). One click
  writes a compressed `.dump` to your backup folder; automatic backups run on
  an interval you choose with keep-newest-N retention. Restoring drops and
  recreates the database so nothing from the old data survives, and **always
  takes a safety copy first** so restoring the wrong file can be undone.
- **Payment status on the invoice.** A band under the totals reads
  *PAID IN FULL — Rs. 50,000.00 received by Bank Transfer on 23-Nov-2026*,
  *PARTIALLY PAID … Balance of Rs. 68,600.00 is still due*, or *UNPAID*, with
  every payment itemised by date, method and note. Drafts print nothing.
  Can be switched off per template.
- **Full-size preview while editing** (⛶ Preview) — the same render that Print
  and Save PDF produce. The side preview can be hidden for a wider form, and
  the choice is remembered.
- **Round off explained where you use it.** The editor shows the arithmetic
  (`Rs. 118,555.00 + Rs. 45.00 = Rs. 118,600.00`) with one-click buttons to
  round to a whole rupee, the nearest 10 or the nearest 100.
- **Link to your published terms** printed under the terms block, set under
  Settings → Invoice defaults. Defaults to
  `packagingbox.pk/terms-and-conditions`.
- Adjustable blank space below the totals block (per template).
- An app icon, so the installer, desktop shortcut and taskbar no longer show
  the generic Electron logo.
- `npm run audit` — 107 checks covering money maths, invoice numbering, stock
  sync, payments, CSV import, templates, reports, deletion rules and HTML
  escaping, run against a scratch database that is created and dropped.

### Fixed

- **A percent discount above 100% produced a negative total.** Amount discounts
  were clamped to the subtotal but percent discounts were not, so typing `150`
  in the percent box gave a total of −50. Both are now clamped.
- **A round-off was applied but never printed.** `showRoundOff` defaulted to
  off, so an invoice could show `105,000 − 5,250 + 17,955 + 850` against a
  total of `118,600` — figures that do not add up. The adjustment now prints
  whenever it is not zero.
- **Settings dead-ended when the database was unreachable.** The page returned
  a spinner forever, and the Database tab — the only place to fix the
  connection — could not be reached. It now shows the problem and switches to
  that tab.
- **Reconnecting with a wrong password destroyed the working connection.**
  `connect()` disconnected before validating, leaving the app with no database
  while the UI still believed it was connected. The new connection is now fully
  validated before the old one is released, and Test/Reconnect refuse to run
  with an empty password box.
- The renderer no longer keeps showing the app shell after the backend loses
  its connection; it returns to the connect screen.
- Added a pool `error` listener. Without one, an idle connection dropped by the
  server was an unhandled error that could take the whole app down.
- The invoice toolbar no longer pushes Print, PDF and Save off the edge of the
  window, and the product field in the items table is no longer too narrow to
  read a product name in.
- Raised text contrast and bumped small type throughout for legibility.

### Security

- Removed a hardcoded PostgreSQL password from the source. The connect screen
  starts blank; the audit scripts read `PGPASSWORD` from the environment.

## [1.0.0]

First release: products with dual pricing, the 54-category tree, stock tracking
and movement history, CSV import with column auto-matching, invoicing with
drafts and payments, six fully editable templates, PDF/print/batch export, and
the dashboard and sales reports.
