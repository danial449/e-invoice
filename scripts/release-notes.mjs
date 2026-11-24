/**
 * Pull one version's section out of CHANGELOG.md for use as GitHub release
 * notes.
 *
 *   node scripts/release-notes.mjs [version] [outfile]
 *
 * With no version it uses the one in package.json, so `npm run dist` always
 * has a notes file to hand to electron-builder.
 *
 * Writes the text between `## [1.5.0] ...` and the next `## [` heading. If
 * there is no such section it writes a short placeholder instead, so a release
 * never fails just because the changelog was not updated.
 */
import fs from 'node:fs'
import path from 'node:path'

const outFile = process.argv[3] ?? 'release-notes.md'
const changelog = process.argv[4] ?? 'CHANGELOG.md'

/** The tag name, or the version in package.json when run without one. */
let version = String(process.argv[2] ?? '').replace(/^v/, '').trim()
if (!version) {
  try {
    version = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8')).version
  } catch {
    console.error('No version given and package.json could not be read.')
    process.exit(2)
  }
}

let body = ''
try {
  const lines = fs.readFileSync(path.resolve(changelog), 'utf8').split(/\r?\n/)
  // Headings look like:  ## [1.5.0] - 2026-11-24
  const isHeading = (l) => /^##\s+\[/.test(l)
  const matchesVersion = (l) => {
    const m = /^##\s+\[([^\]]+)\]/.exec(l)
    return m ? m[1].trim() === version : false
  }

  const start = lines.findIndex((l) => isHeading(l) && matchesVersion(l))
  if (start !== -1) {
    const rest = lines.slice(start + 1)
    const end = rest.findIndex(isHeading)
    body = (end === -1 ? rest : rest.slice(0, end)).join('\n').trim()
  }
} catch (err) {
  console.error(`Could not read ${changelog}: ${err.message}`)
}

if (!body) {
  console.error(`No changelog section for ${version}; writing a placeholder.`)
  body = `Release ${version}\n\nSee CHANGELOG.md for details.`
}

fs.writeFileSync(outFile, `${body}\n`, 'utf8')
console.log(`Wrote ${outFile} (${body.split('\n').length} lines) for ${version}`)
