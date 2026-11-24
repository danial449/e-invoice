# Installing E-Invoice

For the person setting the app up on a Windows PC. You do not need to be a
developer. Allow about fifteen minutes the first time.

---

## What you need

| | |
|---|---|
| **Windows** | 10 or 11, 64-bit |
| **PostgreSQL** | 14 or newer — this is where all your data lives |
| **Disk space** | about 500 MB for the app, plus room for the database and backups |

---

## Step 1 — Install PostgreSQL

Skip this if PostgreSQL is already on the machine.

1. Download the Windows installer from
   [postgresql.org/download/windows](https://www.postgresql.org/download/windows/).
2. Run it and accept the defaults.
3. **When it asks for a password for the `postgres` user, choose one and write
   it down.** You will need it the first time you open the invoice app, and
   there is no way to recover it afterwards.
4. Leave the port as **5432**.
5. You do not need Stack Builder at the end — click Cancel.

> Keep the PostgreSQL installation on a drive with free space. The database
> grows as you add invoices, and if the drive fills up PostgreSQL stops
> accepting new data.

---

## Step 2 — Install the app

1. Go to the [Releases page](https://github.com/danial449/e-invoice/releases).
2. Under the newest release, download
   **`E-Invoice-<version>-setup.exe`**.
3. Double-click it.
4. Windows will show **"Windows protected your PC"**. This appears because the
   app is not code-signed, not because anything is wrong with it. Click
   **More info**, then **Run anyway**.
5. Choose where to install it and finish the wizard.

The installer does not need administrator rights — it installs for your user
account only. It creates a **E-Invoice** shortcut on the Desktop and
in the Start menu.

### Prefer not to install?

Each release also works unpacked. Download the installer, or build from source
with `npm run dist:dir`, and run `E-Invoice.exe` from the folder —
it runs from a USB drive too.

---

## Step 3 — First run

Open **E-Invoice**. You will see the connect screen.

| Field | What to enter |
|---|---|
| Host | `localhost` |
| Port | `5432` |
| Database name | `e-invoice` — created automatically if it does not exist |
| User | `postgres` |
| Password | the password you chose in Step 1 |

Tick **Remember these details on this computer** so you are not asked again,
then click **Connect**.

> The remembered password is saved as plain text in your Windows user profile
> (`%APPDATA%\e-invoice\dbconfig.json`). On a shared machine, leave
> the box unticked and type it each time.

On the first connection the app creates the database, all the tables, the
54-category tree and the six invoice templates. That takes a few seconds.

---

## Step 4 — Set it up for your business

1. **Settings → Company** — your name, address, phone, email, NTN/STRN, logo
   and signature image. These appear on every invoice.
2. **Settings → Invoice defaults** — invoice number prefix and padding
   (`INV-` and `4` gives `INV-0001`), currency symbol, default tax rate,
   standard terms, and the link to your published terms & conditions.
3. **Settings → Database → Backup & restore** — set a backup folder and turn
   on automatic backups. Do this now, not later. See
   [the backup guide](USER-GUIDE.md#backups).
4. **Import CSV** — bring in your product list, or add products by hand under
   **Products**.

---

## Updating to a new version

1. Download the new installer from the
   [Releases page](https://github.com/danial449/e-invoice/releases).
2. Run it. It installs over the old version.

Your data is in PostgreSQL, not in the app folder, so **updating never touches
your invoices, products or customers.** Your saved connection and backup
settings are kept too.

Take a backup before updating anyway — it takes one click and costs nothing.

---

## Uninstalling

Windows Settings → Apps → **E-Invoice** → Uninstall.

This removes the program only. Your database and your backup files stay where
they are. To remove the data as well, delete the `e-invoice` database in
pgAdmin, and delete your backup folder.

---

## If something goes wrong

**"Password authentication failed for user postgres"**
The password is wrong. There is no way to recover it — you would need to reset
it in PostgreSQL, or reinstall PostgreSQL and start a fresh database.

**"Connection refused" or "could not connect to server"**
PostgreSQL is not running. Press `Win+R`, type `services.msc`, find
**postgresql-x64-17** and start it. Set it to Automatic so it starts with
Windows.

**The app opens on the connect screen every time**
You did not tick "Remember these details", or the saved password is out of
date. Enter it again with the box ticked.

**"pg_dump was not found" when backing up**
The backup feature uses `pg_dump`, which comes with PostgreSQL. Open
Settings → Database → Saved backups → *pg_dump location* and point it at your
PostgreSQL `bin` folder, usually
`C:\Program Files\PostgreSQL\17\bin`.

**Backups fail with a version error**
`pg_dump` refuses to work against a newer server than itself. Install the
client tools matching your server version, then set the path as above.
