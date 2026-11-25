// Local Windows pack that mirrors the VPS release (docs/coordination/ops-reference/auto-release.mjs): a players' (client)
// exe is packed without the API server and the website (dist-electron/local-server, dist-electron/website) — only the
// owner's build carries and runs them (electron/localServer.ts). The VPS already drops them from its client edition;
// this wrapper gives a local `npm run dist:win` the same result, so a client exe built on this PC also ships without the
// server code. The owner edition (OWNER_BUILD=1) keeps everything.
//
// The edition is read from dist-electron/build-info.json (written by `npm run build`), with OWNER_BUILD as a fallback.
// Every argument is passed straight through to electron-builder, e.g.:
//   node scripts/pack-windows.mjs --win portable
//   node scripts/pack-windows.mjs --win --dir --config.directories.output=<somewhere outside the worktree>
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function edition() {
  try {
    const info = JSON.parse(readFileSync(join(root, 'dist-electron', 'build-info.json'), 'utf8'))
    if (info.edition === 'owner' || info.edition === 'client') return info.edition
  } catch { /* no build-info.json yet: fall back to the environment */ }
  return process.env.OWNER_BUILD === '1' ? 'owner' : 'client'
}

const current = edition()
let exclude = []
if (current === 'client') {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const base = pkg.build?.files
  if (!Array.isArray(base) || !base.length || base.some((pattern) => typeof pattern !== 'string')) throw new Error('package.json build.files missing')
  // Same shape as the VPS: rebuild the full files list and add the two negations (electron-builder replaces the config
  // array when --config.files is given on the command line, so the base patterns must be repeated).
  exclude = [...base, '!dist-electron/local-server{,/**/*}', '!dist-electron/website{,/**/*}'].map((pattern) => `--config.files=${pattern}`)
}

const cli = join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js')
const args = [cli, ...process.argv.slice(2), ...exclude]
console.log(`electron-builder (${current}${current === 'client' ? ', without local-server and website' : ''})`)
const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env })
if (result.error) throw result.error
process.exit(result.status ?? 1)
