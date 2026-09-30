// Stamps the build (dist-electron/build-info.json) so the app can tell a newer exe from the one it runs:
// electron/appUpdate.ts compares `build` (build time, ms) with the server's copy.
//   node scripts/write-build-info.mjs
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let commit = ''
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() } catch { /* not a git checkout */ }
mkdirSync(join(root, 'dist-electron'), { recursive: true })
writeFileSync(join(root, 'dist-electron', 'build-info.json'), JSON.stringify({ version, build: Date.now(), commit }))
console.log(`Build ${version} ${commit} → dist-electron/build-info.json`)
