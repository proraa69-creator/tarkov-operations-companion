// Packs the API server (server/) into one file and builds the website, both into dist-electron, so the
// desktop app can run them on the owner's PC («Сервер и сайт на этом компьютере», electron/localServer.ts).
//   node scripts/build-local-server.mjs
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// esbuild ships with the server's dev dependencies (tsx).
const require = createRequire(join(root, 'server', 'package.json'))
const esbuild = require('esbuild')

await esbuild.build({
  entryPoints: [join(root, 'server', 'src', 'index.ts')],
  outfile: join(root, 'dist-electron', 'local-server', 'server.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  // node:sqlite and the other built-ins come from the Node inside Electron.
  external: ['node:*'],
  logLevel: 'warning',
  legalComments: 'none',
})
console.log('API server → dist-electron/local-server/server.cjs')

const { build } = await import('vite')
await build({
  configFile: join(root, 'website', 'vite.config.ts'),
  // The site is served by the app itself: the download button takes the exe the app runs from.
  define: {
    'import.meta.env.VITE_DOWNLOAD_URL': JSON.stringify('/download/windows'),
    // Same address as the site (the app forwards /v1 and /health to the API), so a public link works too.
    'import.meta.env.VITE_API_URL': JSON.stringify('/'),
  },
  build: { outDir: join(root, 'dist-electron', 'website'), emptyOutDir: true },
  logLevel: 'warn',
})
console.log('Website → dist-electron/website')
