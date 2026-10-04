// Runs physics-check.ts (TypeScript, the app's own modules) in Node through vite's module loader:
//   node scripts/bosses/physics-check.mjs [key ...]      one JSON line per model
import { createServer } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
process.chdir(root)
const vite = await createServer({ root, configFile: false, logLevel: 'warn', appType: 'custom', server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true, include: [] } })
try {
  const { run } = await vite.ssrLoadModule('/scripts/bosses/physics-check.ts')
  await run(process.argv.slice(2))
} finally {
  await vite.close()
}
