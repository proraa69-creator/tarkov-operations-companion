// Stamps the build (dist-electron/build-info.json) so the app can tell a newer exe from the one it runs:
// electron/appUpdate.ts compares `build` (build time, ms) with the server's copy.
// TRIAL_LAUNCHES=2 makes a test build for friends that deletes its exe after the 2nd close (electron/trial.ts).
// Two editions (electron/buildEdition.ts):
//   - client (default): the app for players, account sign-in and «Личный кабинет», no server controls;
//   - owner  (OWNER_BUILD=1): the owner's own copy and the server laptop, with «Аккаунт сервера» and the «Сервер» button.
// TARKOV_DEFAULT_SERVER_URL=https://… is the server a fresh install connects to (client default: https://raidos.app).
//   node scripts/write-build-info.mjs
//   OWNER_BUILD=1 node scripts/write-build-info.mjs
import { execSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
let commit = ''
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim() } catch { /* not a git checkout */ }
mkdirSync(join(root, 'dist-electron'), { recursive: true })
const trialLaunches = Math.max(0, Math.floor(Number(process.env.TRIAL_LAUNCHES) || 0))
const edition = process.env.OWNER_BUILD === '1' ? 'owner' : 'client'
// Players' builds connect to the owner's permanent address (site + API under /v1) unless told otherwise;
// TARKOV_DEFAULT_SERVER_URL= (empty) builds a client without one. The owner's build keeps its own local server.
const OWNER_SITE = 'https://raidos.app'
const serverSetting = process.env.TARKOV_DEFAULT_SERVER_URL ?? (edition === 'client' ? OWNER_SITE : '')
let defaultServerUrl = ''
if (serverSetting.trim()) {
  const url = new URL(serverSetting.trim())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('TARKOV_DEFAULT_SERVER_URL must be https:// (or http://127.0.0.1 / localhost)')
  defaultServerUrl = url.origin
}
writeFileSync(join(root, 'dist-electron', 'build-info.json'), JSON.stringify({ version, build: Date.now(), commit, edition, ...(defaultServerUrl ? { defaultServerUrl } : {}), ...(trialLaunches ? { trialLaunches } : {}) }))
console.log(`Build ${version} ${commit} · ${edition}${defaultServerUrl ? ` · server ${defaultServerUrl}` : ''}${trialLaunches ? ` (test build: ${trialLaunches} launches)` : ''} → dist-electron/build-info.json`)
