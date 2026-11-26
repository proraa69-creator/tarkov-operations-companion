// Minifies the compiled main process in place (dist-electron/electron and the few dist-electron/src files the main
// process uses): comments and blank space removed, syntax compacted, no source maps — so a players' exe gives little
// away when its app.asar is unpacked and read in a decompiler. Identifier names are kept on purpose: dynamic require()
// and import(), import.meta.url paths, native-module lookups and the VPS release gate's substring checks
// (docs/coordination/ops-reference/auto-release.mjs greps appUpdate.js for 'startupConsumed' and 'blockedByRaid') must
// all survive. The server bundle (owner only) and the built website are left untouched.
//
// Runs inside `npm run build` (both editions share the one build). esbuild comes with the server's dev dependencies.
import { createRequire } from 'node:module'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, sep } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const distElectron = join(root, 'dist-electron')
const require = createRequire(join(root, 'server', 'package.json'))
let esbuild
try {
  esbuild = require('esbuild')
} catch (error) {
  // No esbuild (e.g. server dev dependencies not installed): ship the main process unminified rather than fail the
  // build. Minification is hardening, never a release blocker.
  console.warn(`minify-electron: esbuild unavailable, main process left unminified (${error instanceof Error ? error.message : String(error)})`)
  process.exit(0)
}

// Never minify the server bundle (owner only, already one file) or the vite-built website (its own output).
const SKIP = [join(distElectron, 'local-server'), join(distElectron, 'website')]

function jsFiles(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (SKIP.some((skip) => path === skip || path.startsWith(skip + sep))) continue
    if (entry.isDirectory()) out.push(...jsFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(path)
  }
  return out
}

let count = 0
let before = 0
let after = 0
for (const file of jsFiles(distElectron)) {
  const code = readFileSync(file, 'utf8')
  try {
    const result = await esbuild.transform(code, {
      minifyWhitespace: true,
      minifySyntax: true,
      minifyIdentifiers: false,
      legalComments: 'none',
      format: 'esm',
      target: 'es2022',
      loader: 'js',
      sourcemap: false,
    })
    writeFileSync(file, result.code)
    count += 1
    before += code.length
    after += result.code.length
  } catch (error) {
    // A single file that will not minify ships as tsc emitted it (readable), never a failed release.
    console.warn(`minify-electron: left ${file} unminified (${error instanceof Error ? error.message : String(error)})`)
  }
}
console.log(`Minified main process: ${count} file(s), ${(before / 1024).toFixed(0)} → ${(after / 1024).toFixed(0)} KB (comments and blank space removed, names kept)`)
