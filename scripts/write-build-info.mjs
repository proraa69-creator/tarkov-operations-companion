// Stamps the build (dist-electron/build-info.json) so the app can tell a newer exe from the one it runs:
// electron/appUpdate.ts compares `build` (build time, ms) with the server's copy.
// TRIAL_LAUNCHES=2 makes a test build for friends that deletes its exe after the 2nd close (electron/trial.ts).
// Two editions (electron/buildEdition.ts):
//   - client (default): the app for players, account sign-in and «Личный кабинет», no server controls;
//   - owner  (OWNER_BUILD=1): the owner's own copy and the server laptop, with «Аккаунт сервера» and the «Сервер» button.
// TARKOV_DEFAULT_SERVER_URL=https://… is the server a fresh install connects to (default for both editions:
// https://raidos.app; the owner's app talks to its own local server only while «Сервер и сайт на этом компьютере» is on).
// OWNER_EMAILS=a@b.c[,…] (owner builds only): the site accounts that are the owner by default, until other e-mails are
// saved in the desktop owner panel («E-mail владельца», electron/ownerAdmin.ts). Never hard-coded in the sources.
//   node scripts/write-build-info.mjs
//   OWNER_BUILD=1 node scripts/write-build-info.mjs
//   OWNER_BUILD=1 OWNER_EMAILS=owner@example.com node scripts/write-build-info.mjs
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
// Both editions connect to the owner's permanent address (site + API under /v1) unless told otherwise;
// TARKOV_DEFAULT_SERVER_URL= (empty) builds one without it (this PC only). The owner's app still uses its own local
// server while the local server mode is on (the server laptop), see electron/serviceGateway.ts.
const OWNER_SITE = 'https://raidos.app'
const serverSetting = process.env.TARKOV_DEFAULT_SERVER_URL ?? OWNER_SITE
let defaultServerUrl = ''
if (serverSetting.trim()) {
  const url = new URL(serverSetting.trim())
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('TARKOV_DEFAULT_SERVER_URL must be https:// (or http://127.0.0.1 / localhost)')
  defaultServerUrl = url.origin
}
// Owner e-mails only ever go into an owner build; a client build ignores the variable.
const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/
const ownerEmails = edition === 'owner'
  ? [...new Set(String(process.env.OWNER_EMAILS ?? '').split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]
  : []
const badEmail = ownerEmails.find((email) => !EMAIL.test(email) || email.length > 254)
if (badEmail) throw new Error(`OWNER_EMAILS: invalid e-mail ${badEmail}`)
if (ownerEmails.length > 5) throw new Error('OWNER_EMAILS: at most five e-mails')
// The server's entitlement public key (docs/subscription-protection.md), built in for the default server so the app
// does not have to trust it on first use: RAIDOS_ENTITLEMENT_PUBLIC_KEY=<43 characters> or RAIDOS_ENTITLEMENT_PUBLIC_KEY_FILE
// pointing to a file with that key or with the JSON of https://raidos.app/v1/entitlement/public-key. Public, not secret.
let entitlementKey = (process.env.RAIDOS_ENTITLEMENT_PUBLIC_KEY ?? '').trim()
if (!entitlementKey && process.env.RAIDOS_ENTITLEMENT_PUBLIC_KEY_FILE) {
  const text = readFileSync(process.env.RAIDOS_ENTITLEMENT_PUBLIC_KEY_FILE, 'utf8').trim()
  entitlementKey = text.startsWith('{') ? String(JSON.parse(text).publicKey ?? '') : text
}
if (entitlementKey && !/^[A-Za-z0-9_-]{43}$/.test(entitlementKey)) throw new Error('RAIDOS_ENTITLEMENT_PUBLIC_KEY: expected the 43-character Ed25519 key from /v1/entitlement/public-key')
if (entitlementKey && !defaultServerUrl) throw new Error('RAIDOS_ENTITLEMENT_PUBLIC_KEY needs TARKOV_DEFAULT_SERVER_URL (the server the key belongs to)')
const entitlementKeys = entitlementKey ? { [defaultServerUrl]: entitlementKey } : undefined
writeFileSync(join(root, 'dist-electron', 'build-info.json'), JSON.stringify({ version, build: Date.now(), commit, edition, ...(defaultServerUrl ? { defaultServerUrl } : {}), ...(ownerEmails.length ? { ownerEmails } : {}), ...(trialLaunches ? { trialLaunches } : {}), ...(entitlementKeys ? { entitlementKeys } : {}) }))
console.log(`Build ${version} ${commit} · ${edition}${defaultServerUrl ? ` · server ${defaultServerUrl}` : ''}${entitlementKeys ? ' · entitlement key built in' : ''}${ownerEmails.length ? ` · owner e-mails: ${ownerEmails.length}` : ''}${trialLaunches ? ` (test build: ${trialLaunches} launches)` : ''} → dist-electron/build-info.json`)
