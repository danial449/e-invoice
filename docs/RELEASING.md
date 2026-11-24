# Releasing a new version

Releases are built by GitHub Actions and published to the
[Releases page](https://github.com/danial449/e-invoice/releases), where users
download the installer.

---

## The short version

```bash
npm run audit          # must be 107/107
npm run typecheck

# edit CHANGELOG.md — add a section for the new version

git add -A
git commit -m "Describe what changed"
npm run release:patch  # or release:minor / release:major
```

`npm run release:patch` bumps the version in `package.json`, commits that,
creates a `v1.0.1` tag and pushes both. Pushing the tag starts the **Release**
workflow, which builds the Windows installer and attaches it to a **draft**
release.

Then open the [Releases page](https://github.com/danial449/e-invoice/releases),
check the installer is attached, paste the changelog section into the notes,
and press **Publish release**.

---

## Which one to use

Versions are `MAJOR.MINOR.PATCH`.

| Command | Use it when | Example |
|---|---|---|
| `npm run release:patch` | Bug fixes only, nothing new | 1.1.0 → 1.1.1 |
| `npm run release:minor` | New features, existing ones still work | 1.1.0 → 1.2.0 |
| `npm run release:major` | Something users must be told about — data migrations, removed features | 1.1.0 → 2.0.0 |

---

## Step by step

### 1. Make sure it works

```bash
npm run typecheck
PGPASSWORD=yourpassword npm run audit
```

The audit must pass all 107 checks. If you added a feature, add checks for it
in `.audit/audit.ts` first — a release with untested behaviour in it is how
money bugs reach customers.

### 2. Write the changelog

Add a section at the top of [CHANGELOG.md](../CHANGELOG.md) under the new
version number, grouped into **Added**, **Changed**, **Fixed**, **Security**.

Write it for the people using the app, not for the people who wrote it. "A
percent discount above 100% produced a negative total" is useful; "fixed
clamping in computeTotals" is not.

### 3. Commit, then tag

```bash
git add -A
git commit -m "Describe what changed"
npm run release:patch
```

Commit your work **before** running the release script — it only bumps the
version and tags, it does not pick up unstaged changes.

### 4. Watch the build

The [Actions tab](https://github.com/danial449/e-invoice/actions) shows the
**Release** workflow. It takes a few minutes: install, type-check, build,
package, upload.

### 5. Publish

Open the [Releases page](https://github.com/danial449/e-invoice/releases). The
draft will be there with `E-Invoice-<version>-setup.exe` attached.

- Paste the changelog section into the notes.
- Check the installer is attached and the size looks right (~80 MB).
- Press **Publish release**.

Users on the Releases page now see the new version at the top.

---

## If the build fails

Open the failed run in the Actions tab and read the failing step.

**Type-check or audit failed** — it is a real problem in the code. Fix it,
commit, delete the tag, and tag again:

```bash
git tag -d v1.0.1
git push --delete origin v1.0.1
# fix, commit, then:
npm run release:patch
```

**The packaging step failed** — usually a dependency problem. Check the
installer builds locally with `npm run dist`.

**No installer attached to the draft** — the publish step did not run. Check
that `GH_TOKEN` is set from `secrets.GITHUB_TOKEN` in
`.github/workflows/release.yml`, and that the workflow has
`permissions: contents: write`.

---

## Building one by hand

Only needed if Actions is unavailable.

```bash
npm run dist
```

The installer lands in `release/`. Upload it to a release on GitHub yourself.
See [DEVELOPMENT.md](DEVELOPMENT.md) if it fails with a symlink error.

---

## A note on code signing

Builds are unsigned, so Windows SmartScreen warns on first run and users must
click **More info → Run anyway**. Removing that warning needs an EV code
signing certificate — a paid yearly purchase from a certificate authority.

With one, add the certificate and password as repository secrets and set
`CSC_LINK` and `CSC_KEY_PASSWORD` in the release workflow instead of
`CSC_IDENTITY_AUTO_DISCOVERY: false`. **Never commit a certificate.**
