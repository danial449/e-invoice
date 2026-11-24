# Development

For anyone working on the code. Electron + React + TypeScript, with everything
stored in a local PostgreSQL database.

---

## Getting set up

```bash
git clone https://github.com/danial449/e-invoice.git
cd e-invoice
npm install
npm run dev
```

You need Node 20+ and a PostgreSQL server you can connect to. The app creates
its own database on first connect, so an empty server is fine.

| Script | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` | Compile main, preload and renderer into `out/` |
| `npm run typecheck` | `tsc --noEmit` over both tsconfigs |
| `npm run audit` | 107 checks against a real PostgreSQL (see below) |
| `npm run dist` | Build the Windows installer into `release/` |
| `npm run dist:dir` | Build unpacked, no installer |

---

## Project layout

```
src/
  main/                 Electron main process
    db/pool.ts          connection, database creation, transactions
    db/schema.ts        full SQL schema (idempotent) + migrations
    db/seed.ts          categories, templates, company details
    services/           products, customers, invoices, templates,
                        settings, reports, csv, pdf, backup
    ipc/index.ts        every IPC channel, wrapped as {ok,data}|{ok,error}
  preload/index.ts      contextBridge API over a fixed channel allow-list
  renderer/src/         React UI (pages/, components/, lib/)
  shared/               types, money maths, template presets, and
                        renderInvoice.ts — one renderer used for both the
                        live preview and the PDF
.audit/                 the feature audit (see below)
```

### How a call flows

`renderer/src/lib/api.ts` → `window.api.invoke(channel)` → preload checks the
channel against a fixed allow-list → `main/ipc/index.ts` handler → a service →
`db/pool.ts`.

Every handler is wrapped so the renderer always gets `{ok: true, data}` or
`{ok: false, error}`; it never sees a raw exception. **Adding an IPC channel
means adding it in three places:** the handler in `main/ipc/index.ts`, the
allow-list in `preload/index.ts`, and a method in `renderer/src/lib/api.ts`.

---

## The audit

```bash
# PowerShell
$env:PGPASSWORD = "yourpassword"; npm run audit

# bash
PGPASSWORD=yourpassword npm run audit
```

107 checks over money and tax maths, invoice numbering, stock sync on
issue/edit/cancel/delete, payments and status transitions, CSV import,
templates, reports, deletion rules, rendering and HTML escaping.

It creates a scratch database called `e_invoice_audit`, uses it and drops it
again — **it never touches your real data.** It reads `PGHOST`, `PGPORT`,
`PGUSER` and `PGPASSWORD`, and refuses to run without a password.

It exercises the real service code rather than copies of it: `.audit/build.js`
bundles `.audit/audit.ts` with esbuild, aliasing `electron` to
`.audit/stub-electron.js` so main-process modules can run under plain Node.

`.audit/sample.ts` renders one representative invoice to an HTML file, which is
the quickest way to eyeball a template change:

```bash
node .audit/build.js
node -e "require('esbuild').build({entryPoints:['.audit/sample.ts'],bundle:true,platform:'node',format:'cjs',outfile:'.audit/sample.cjs',external:['pg','papaparse'],alias:{electron:'./.audit/stub-electron.js'}})"
PGPASSWORD=yourpassword node .audit/sample.cjs invoice.html
```

CI runs the audit on every push against a real PostgreSQL 17 service container.

---

## Things that will bite you

- **PDF rendering reuses one hidden window.** Creating a fresh `BrowserWindow`
  per render fails from the second call onwards (`ERR_FAILED`) and can kill the
  process, so `services/pdf.ts` keeps a single window and serialises jobs
  through a queue. Do not change that back.
- **Connecting must never drop a working connection.** `db/pool.ts` validates
  new credentials and applies the schema on the *new* pool before calling
  `disconnect()`. The old order left the app with no database after a single
  typo, while the UI still believed it was connected.
- **The Settings page must render without company settings.** It is the only
  route to the Database tab, so a failed `settings:get` shows a banner and
  switches to that tab rather than returning a spinner forever.
- **The pool needs its `error` listener.** Without one, an idle client dropped
  by the server is an unhandled `EventEmitter` error that takes down the main
  process.
- **A round-off must be printed when it is non-zero.** If it is hidden, the
  printed figures do not add up to the total and the customer will query it.
- **Money is `NUMERIC` in Postgres**, parsed to JS numbers and rounded to 2dp
  in `shared/calc.ts`. All totals are recomputed server-side on save — the UI
  figures are only for display. Discounts are clamped to the subtotal for
  percent as well as amount.
- **Adding a column to an existing table** needs an entry in the migration
  block at the bottom of `db/schema.ts` (`ADD COLUMN IF NOT EXISTS`). The
  tables themselves are only created `IF NOT EXISTS`, so they never change on
  an install that already exists.
- **Invoice HTML escapes every interpolated value**, and the preview iframe is
  `sandbox=""` so no scripts run in it. Keep it that way.
- **Unlimited stock is `track_stock = false`, not a magic quantity.** Anything
  that reads or writes `stock_qty` has to check it: the invoice stock sync, the
  low/out filters, the dashboard counters and stock value, and `adjustStock`.
- **CSV header matching is order-sensitive.** A WooCommerce export is matched by
  exact column name first (`WOOCOMMERCE_HEADERS`), because `In stock?` and
  `In Stock` both normalise to `instock` but mean different things. After that
  come exact alias matches, then fuzzy ones. `NEVER_MATCH` drops the WooCommerce
  columns that would otherwise be mis-matched, and `EXACT_ONLY` marks fields
  that must never be matched fuzzily.
- **`invoice_events` is append-only and must outlive its invoice.** The foreign
  keys are `ON DELETE SET NULL`, not `CASCADE`, and `invoice_no` /
  `customer_name` are copied onto each row so a deleted invoice's trail still
  reads. `recordEvent` swallows its own errors on purpose: recording history
  must never roll back the thing it is recording. When an invoice is renumbered
  out of `DRAFT-xxxx`, call `renumberEvents` so the trail stays one story.
- **Never commit a database password.** The connect screen starts blank and the
  audit reads `PGPASSWORD` from the environment.

### Running from a Claude Code / VS Code terminal

The VS Code extension host exports `ELECTRON_RUN_AS_NODE=1`, which makes
Electron boot as plain Node and crash with
`Cannot read properties of undefined (reading 'isPackaged')`. Unset it:

```bash
(unset ELECTRON_RUN_AS_NODE; npm run dev)
```

### `npm run dist` failing with "Cannot create symbolic link"

electron-builder's `winCodeSign` package contains macOS symlinks that Windows
will not extract without Developer Mode or administrator rights. They are not
needed for a Windows build. Extract it once, skipping that folder:

```bash
cd "$LOCALAPPDATA/electron-builder/Cache/winCodeSign"
rm -rf [0-9]*                   # failed partial extractions
"<repo>/node_modules/7zip-bin/win/x64/7za.exe" x -snld -y <id>.7z \
  -o"winCodeSign-2.6.0" "-x!darwin"
```

The folder must end up named exactly `winCodeSign-2.6.0` and contain
`rcedit-x64.exe` and `windows-10/`.

---

## Releasing

See [RELEASING.md](RELEASING.md).
