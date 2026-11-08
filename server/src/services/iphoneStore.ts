import { readFile } from 'node:fs/promises'

/**
 * Where the iPhone app updates (owner, 09.11.2026: «сделай себе переключатель в онлайн-режиме… мы просто поменяем ссылку, и
 * будет перекидывать без обновления приложения. На App Store»). A small JSON file on the server, read again every few
 * seconds, so turning it on or off needs neither a release nor a restart:
 *   { "url": "https://apps.apple.com/app/raid-os/id1234567890", "version": "0.6.0.281" }
 * `url` — the App Store page every iPhone app's «Обновить» opens instead of the site's download page; `version` — the
 * newest version on the App Store (the App Store build compares itself with it; without it that build says nothing).
 * No file, or a file that does not parse: the site as before.
 */
export interface IphoneStore { url: string; version?: string }

const STORE_URL = /^https:\/\/apps\.apple\.com\/[A-Za-z0-9/_\-.%?=&]{1,300}$/
const VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:[.-]\d{1,6})?$/
const FRESH_MS = 5_000

export function parseIphoneStore(value: unknown): IphoneStore | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { url, version } = value as { url?: unknown; version?: unknown }
  if (typeof url !== 'string' || !STORE_URL.test(url)) return undefined
  return { url, ...(typeof version === 'string' && VERSION.test(version) ? { version } : {}) }
}

/** Reads `path` at most every FRESH_MS; a missing or broken file is «off». */
export function iphoneStoreReader(path: string, now: () => number = Date.now) {
  let cached: { at: number; value: IphoneStore | undefined } | undefined
  return async (): Promise<IphoneStore | undefined> => {
    if (cached && now() - cached.at < FRESH_MS) return cached.value
    let value: IphoneStore | undefined
    try { value = parseIphoneStore(JSON.parse(await readFile(path, 'utf8'))) } catch { value = undefined }
    cached = { at: now(), value }
    return value
  }
}
