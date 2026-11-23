# Changelog

All notable changes to PackagingBox Invoice. Versions follow
[semantic versioning](https://semver.org): `MAJOR.MINOR.PATCH`.

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
