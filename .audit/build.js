const esbuild = require('esbuild')
esbuild.build({
  entryPoints: ['.audit/audit.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: '.audit/audit.cjs',
  external: ['pg', 'papaparse', 'electron-store'],
  alias: { electron: './.audit/stub-electron.js' },
  logLevel: 'warning'
}).then(() => console.log('bundled')).catch(() => process.exit(1))
