#!/usr/bin/env node
// «Доступ Claude к заявкам» (owner, 14.10.2026: «2 вариант да»): reads the players' reports with the owner's read-only
// key (server/src/routes/agentRequests.ts) and prints a readable summary:
//   node scripts/read-requests.mjs [--status open|closed|all] [--limit 1-200] [--offset N] [--images <dir>] [--json]
//
// RAIDOS_REQUESTS_KEY: the key the owner created in the owner app («Заявки» → «Доступ Claude к заявкам»), kept in the
// cloud environment's secrets. RAIDOS_API: the API base, https://raidos.app/api by default (the site serves the API
// under /api and /v1 alike). The key goes to that API only, in the Authorization header; it is never printed, logged or
// written anywhere. The API answers without e-mails or accounts.
// --images <dir>: saves the reports' images as <dir>/request-<№>-<n>.<png|jpg|webp>; files already there are not
// fetched again (every image is one request of the key's 120 an hour).
// Node's fetch ignores HTTPS_PROXY unless NODE_USE_ENV_PROXY=1 (Node ≥ 22.21): behind a proxy the script restarts itself
// with it. Exit codes: 0 done, 1 the API failed or could not be reached, 2 wrong arguments or no key, 3 key refused.
// Only Node built-ins here.
import { spawnSync } from 'node:child_process'
import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_API = 'https://raidos.app/api'
const KEY = /^rok_[A-Za-z0-9_-]{43}$/
const ANY_KEY = /rok_[A-Za-z0-9_-]{43}/g
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }
const MAX_IMAGE_BYTES = 6 * 1024 * 1024
const MODES = { pvp: 'PvP', pve: 'PvE', seasonal: 'Season' }
const GAME_EDITIONS = { steam: 'Steam', launcher: 'BSG launcher (not Steam)', 'not-found': 'game logs not found' }
const WHERE_KEY = 'The owner creates the key in the owner app («Заявки» → «Доступ Claude к заявкам») and puts it into the cloud environment\'s secrets as RAIDOS_REQUESTS_KEY.'

export const USAGE = `Usage: node scripts/read-requests.mjs [--status open|closed|all] [--limit 1-200] [--offset N] [--images <dir>] [--json]
Reads the players' reports (Raid OS «Заявки») with the owner's read-only key.
  --status   open (default), closed or all          --limit   reports per page, 1-200 (default 50)
  --offset   skip that many (the next page)         --images  save the reports' images into <dir>
  --json     print the API's answer as JSON
Environment: RAIDOS_REQUESTS_KEY (the key), RAIDOS_API (default ${DEFAULT_API}).`

export class ReadError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

/** Never shows a key: the one in use or anything shaped like one. */
export function redact(text, key = '') {
  const plain = key ? String(text).split(key).join('rok_…') : String(text)
  return plain.replace(ANY_KEY, 'rok_…')
}

/** Text from a report, without control characters (a player's text cannot drive the terminal). */
const clean = (value) => String(value ?? '').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')

export function parseArgs(argv) {
  const options = { status: 'open', limit: 50, offset: 0, images: '', json: false, help: false }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = String(argv[i])
    const eq = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = eq > 0 ? arg.slice(0, eq) : arg
    const value = () => {
      const next = eq > 0 ? arg.slice(eq + 1) : argv[++i]
      if (next === undefined || next === '') throw new ReadError(2, `${name} needs a value`)
      return String(next)
    }
    const count = (min, max) => {
      const number = Number(value())
      if (!Number.isInteger(number) || number < min || number > max) throw new ReadError(2, `${name}: a whole number from ${min} to ${max}`)
      return number
    }
    if (name === '--status') {
      options.status = value()
      if (!['open', 'closed', 'all'].includes(options.status)) throw new ReadError(2, '--status: open, closed or all')
    } else if (name === '--limit') options.limit = count(1, 200)
    else if (name === '--offset') options.offset = count(0, 1_000_000)
    else if (name === '--images') options.images = value()
    else if (name === '--json') options.json = true
    else if (name === '--help' || name === '-h') options.help = true
    // The argument itself is not repeated: it might be a key pasted in the wrong place.
    else throw new ReadError(2, /^--?[a-z][a-z-]{0,20}$/i.test(name) ? `unknown option ${name} (see --help)` : 'unexpected argument (see --help)')
  }
  return options
}

/** RAIDOS_API: https, or http to this computer only; no credentials, query or fragment. */
export function apiBase(env = process.env) {
  const raw = String(env.RAIDOS_API ?? '').trim() || DEFAULT_API
  let url
  try { url = new URL(raw) } catch { throw new ReadError(2, 'RAIDOS_API is not a URL (for example https://raidos.app/api)') }
  const local = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new ReadError(2, 'RAIDOS_API must start with https:// (http:// only for this computer)')
  if (url.username || url.password || url.search || url.hash) throw new ReadError(2, 'RAIDOS_API: only the address, without credentials, query or fragment')
  return url.href.replace(/\/+$/, '')
}

export function readKey(env = process.env) {
  const key = String(env.RAIDOS_REQUESTS_KEY ?? '').trim()
  if (!key) throw new ReadError(2, `RAIDOS_REQUESTS_KEY is not set. ${WHERE_KEY}`)
  if (!KEY.test(key)) throw new ReadError(2, `RAIDOS_REQUESTS_KEY is not a key from the owner app (rok_ and 43 more characters). ${WHERE_KEY}`)
  return key
}

/** One GET with the key; 401, 429 and other failures as a ReadError with what to do. */
async function get(base, path, key) {
  let response
  try {
    response = await fetch(`${base}${path}`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json, image/*' }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  } catch (error) {
    const reason = error?.cause?.code ?? error?.name ?? 'network error'
    throw new ReadError(1, `could not reach ${base} (${reason}). Check RAIDOS_API and the network${process.env.HTTPS_PROXY && process.env.NODE_USE_ENV_PROXY !== '1' ? '; behind an HTTPS proxy run it with NODE_USE_ENV_PROXY=1' : ''}.`)
  }
  if (response.status === 401) throw new ReadError(3, `the key was refused: it is wrong, replaced or revoked. ${WHERE_KEY}`)
  if (response.status === 429) throw new ReadError(1, `too many requests (120 an hour per key and per address): try again in ${response.headers.get('retry-after') ?? 'a few'} s.`)
  if (!response.ok) {
    let detail = ''
    try { detail = clean((await response.json())?.error ?? '').slice(0, 200) } catch { /* not JSON: an older server without the route */ }
    throw new ReadError(1, `${base}${path.split('?')[0]}: HTTP ${response.status}${detail ? ` (${detail})` : response.status === 404 ? ' (this server does not have the route yet)' : ''}.`)
  }
  return response
}

/** Saves the images of `reports` into `dir`; stops at the hourly limit. Returns id → saved paths and notes. */
async function saveImages(base, key, reports, dir) {
  await mkdir(dir, { recursive: true })
  const existing = new Set(await readdir(dir))
  const saved = new Map()
  const notes = []
  for (const report of reports) {
    if (!Number.isSafeInteger(report.id) || report.id < 1 || !Number.isInteger(report.images) || report.images < 1) continue
    const files = []
    for (let index = 0; index < Math.min(report.images, 10); index += 1) {
      const name = `request-${report.id}-${index + 1}`
      const already = Object.values(IMAGE_TYPES).map((extension) => `${name}.${extension}`).find((file) => existing.has(file))
      if (already) { files.push(join(dir, already)); continue }
      let response
      try {
        response = await get(base, `/v1/agent/requests/${report.id}/images/${index}`, key)
      } catch (error) {
        if (error instanceof ReadError && /HTTP 404/.test(error.message)) { notes.push(`№${report.id}: image ${index + 1} is gone (old images are deleted after 30-90 days)`); continue }
        notes.push(`images not saved further: ${error.message}`)
        if (files.length) saved.set(report.id, files)
        return { saved, notes }
      }
      const extension = IMAGE_TYPES[String(response.headers.get('content-type') ?? '').split(';')[0].trim()]
      const skipped = () => notes.push(`№${report.id}: image ${index + 1} skipped (not a PNG / JPEG / WEBP up to 6 MB)`)
      if (!extension || Number(response.headers.get('content-length') ?? 0) > MAX_IMAGE_BYTES) { await response.body?.cancel().catch(() => {}); skipped(); continue }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (bytes.length > MAX_IMAGE_BYTES) { skipped(); continue }
      const file = join(dir, `${name}.${extension}`)
      await writeFile(file, bytes)
      files.push(file)
    }
    if (files.length) saved.set(report.id, files)
  }
  return { saved, notes }
}

const when = (iso) => (typeof iso === 'string' && iso.length >= 16 ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '')

/** One report as a few readable lines. */
export function formatReport(report, images = []) {
  const head = [`№${report.number ?? report.id}`, report.kind, report.category, report.status, when(report.createdAt)].filter(Boolean).map(clean).join(' · ')
  const app = [report.appVersion && `${clean(report.appVersion)}${report.client ? ` (${clean(report.client)})` : ''}`, clean(report.platform), report.gameEdition && `EFT: ${GAME_EDITIONS[report.gameEdition] ?? clean(report.gameEdition)}`, MODES[report.mode]].filter(Boolean).join(' · ')
  const lines = [head, `  Title:    ${clean(report.title)}`]
  if (app) lines.push(`  App:      ${app}`)
  if (report.closedAt) lines.push(`  Closed:   ${when(report.closedAt)}`)
  const quest = report.quest
  if (quest) {
    const place = [quest.mapId && `map ${quest.mapId}`, quest.markerId && `marker ${quest.markerId}`, quest.objectiveId && `objective ${quest.objectiveId}`, quest.stageIndex != null && `stage ${quest.stageIndex + 1}`].filter(Boolean)
    lines.push(`  Quest:    ${quest.questName ? `«${clean(quest.questName)}» (${clean(quest.questId)})` : clean(quest.questId)} · ${clean(quest.issue)}${place.length ? ` · ${place.map(clean).join(' · ')}` : ''}`)
    if (quest.point) lines.push(`            proposed point x ${clean(quest.point.x)}, z ${clean(quest.point.z)}${quest.point.floor ? `, floor ${clean(quest.point.floor)}` : ''}`)
    if (quest.pointNote) lines.push(`            point note: ${clean(quest.pointNote)}`)
    if (quest.questNote) lines.push(`            quest note: ${clean(quest.questNote)}`)
    if (report.matches > 1) lines.push(`            agrees with ${report.matches - 1} other open report(s) (group ${clean(report.group)})`)
  }
  if (report.reporter) lines.push(`  Reporter: ${clean(report.reporter)}`)
  if (report.images) lines.push(`  Images:   ${report.images}${images.length ? ` → ${images.join(', ')}` : ''}`)
  const text = clean(report.text).trim()
  if (text) lines.push('  Text:', ...text.split('\n').map((line) => `    ${line}`))
  return lines.join('\n')
}

export function formatPage(answer, base, saved) {
  const reports = answer.reports
  const counts = answer.counts ?? {}
  const lines = [`Raid OS requests (${clean(answer.status)}): ${reports.length} shown of ${answer.total} · open ${counts.open ?? '?'}, closed ${counts.closed ?? '?'} · ${base}`]
  for (const report of reports) lines.push('', formatReport(report, saved?.saved.get(report.id) ?? []))
  if (answer.offset + reports.length < answer.total) lines.push('', `More: --offset ${answer.offset + reports.length}`)
  for (const note of saved?.notes ?? []) lines.push(`Note: ${note}`)
  return lines.join('\n')
}

/** Everything but the proxy restart: `print` / `warn` get one text each; resolves with the exit code. */
export async function main(argv = process.argv.slice(2), env = process.env, print = (text) => console.log(text), warn = (text) => console.error(text)) {
  let options, base, key
  try {
    options = parseArgs(argv)
    if (options.help) { print(USAGE); return 0 }
    base = apiBase(env)
    key = readKey(env)
  } catch (error) {
    warn(redact(`read-requests: ${error.message}`))
    return error instanceof ReadError ? error.code : 2
  }
  try {
    const query = new URLSearchParams({ status: options.status, limit: String(options.limit), offset: String(options.offset) })
    const answer = await (await get(base, `/v1/agent/requests?${query}`, key)).json().catch(() => null)
    if (!answer || !Array.isArray(answer.reports)) throw new ReadError(1, 'the API answered something unexpected')
    const saved = options.images ? await saveImages(base, key, answer.reports, resolve(options.images)) : undefined
    if (options.json) {
      print(redact(JSON.stringify(saved ? { ...answer, savedImages: Object.fromEntries(saved.saved), notes: saved.notes } : answer, null, 2), key))
    } else {
      print(redact(formatPage(answer, base, saved), key))
    }
    return 0
  } catch (error) {
    warn(redact(`read-requests: ${error instanceof Error ? error.message : String(error)}`, key))
    return error instanceof ReadError ? error.code : 1
  }
}

const entry = process.argv[1] ? resolve(process.argv[1]) : ''
if (entry === fileURLToPath(import.meta.url)) {
  const env = process.env
  let proxied = false
  try { proxied = apiBase(env).startsWith('https:') && Boolean(env.HTTPS_PROXY || env.https_proxy) && env.NODE_USE_ENV_PROXY !== '1' } catch { /* main() explains RAIDOS_API */ }
  if (proxied) {
    // The key stays in the environment; the same arguments go to the restarted script.
    const child = spawnSync(process.execPath, ['--disable-warning=UNDICI-EHPA', ...process.execArgv, entry, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...env, NODE_USE_ENV_PROXY: '1' } })
    process.exit(child.status ?? 1)
  }
  main().then((code) => { process.exitCode = code })
}
