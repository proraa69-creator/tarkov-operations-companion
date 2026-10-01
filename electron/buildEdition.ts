import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Which app this exe is (scripts/write-build-info.mjs → dist-electron/build-info.json):
 *
 * - `client` (default): the app for players. Account sign-in, «Личный кабинет», no server controls.
 * - `owner` (`OWNER_BUILD=1` at build time): the owner's own copy and the server laptop — «Аккаунт сервера», the
 *   «Сервер» button, the server and website on this PC, the public link, payments and streamers.
 *
 * The edition is fixed when the exe is built; it is never taken from the command line or the environment of an
 * installed exe. Only a development run without build-info.json falls back to `OWNER_BUILD` in the environment.
 * `TARKOV_DEFAULT_SERVER_URL` at build time is the server address a fresh install uses (the owner's permanent
 * address), so a player does not have to type it. `OWNER_EMAILS` (owner builds only) are the site accounts that are the
 * owner by default, until the owner saves others in the desktop panel (electron/ownerAdmin.ts).
 */
export type BuildEdition = 'owner' | 'client'

interface BuildInfo { edition?: unknown; defaultServerUrl?: unknown; ownerEmails?: unknown }
let cached: BuildInfo | null | undefined

function buildInfo(): BuildInfo | null {
  if (cached !== undefined) return cached
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json')
    cached = JSON.parse(readFileSync(file, 'utf8')) as BuildInfo
  } catch {
    cached = null
  }
  return cached
}

export function buildEdition(): BuildEdition {
  const info = buildInfo()
  if (info?.edition === 'owner' || info?.edition === 'client') return info.edition
  if (!info) return process.env.OWNER_BUILD === '1' ? 'owner' : 'client'
  // An exe built before editions existed was the owner's own app.
  return 'owner'
}

export const isOwnerBuild = () => buildEdition() === 'owner'

/** The server address baked into this build ('' = none: this PC, http://127.0.0.1:8787). */
export function buildDefaultServerUrl() {
  const raw = buildInfo()?.defaultServerUrl
  if (typeof raw !== 'string' || !raw.trim()) return ''
  try {
    const url = new URL(raw.trim())
    const local = url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)
    return url.protocol === 'https:' || local ? url.origin : ''
  } catch {
    return ''
  }
}

const OWNER_EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/

/** Default owner e-mails baked into an owner build (OWNER_EMAILS at build time); [] for client builds. */
export function buildOwnerEmails(): string[] {
  if (!isOwnerBuild()) return []
  const raw = buildInfo()?.ownerEmails
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((email): email is string => typeof email === 'string').map((email) => email.trim().toLowerCase()).filter((email) => email.length <= 254 && OWNER_EMAIL.test(email)))].slice(0, 5)
}
