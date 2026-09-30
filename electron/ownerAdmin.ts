import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'

/**
 * The owner's controls for the server on this PC (Server panel → «Оплата» and «Стримеры»):
 * - ЮKassa settings: shop id, price, receipts and streamer share are kept in userData; the secret key is encrypted
 *   with safeStorage and only ever handed to the local API process through its environment (never to the renderer,
 *   never logged).
 * - Streamer invitations through the API's owner-only /v1/admin routes, authorised by a random token made for each
 *   start of the API (TARKOV_ADMIN_TOKEN) — it never leaves this PC, and the public link does not forward /v1/admin.
 */
const API = 'http://127.0.0.1:8787'
export const ADMIN_TOKEN = randomBytes(32).toString('base64url')

export interface PaymentSettings { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; hasKey: boolean }
interface SavedPayments { shopId?: string; monthPrice?: number; receipts?: boolean; streamerPercent?: number }

const settingsFile = () => join(app.getPath('userData'), 'payments.json')
const keyFile = () => join(app.getPath('userData'), 'payments-key.bin')

async function readSaved(): Promise<SavedPayments> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as SavedPayments
  } catch {
    return {}
  }
}

async function secretKey() {
  if (!existsSync(keyFile())) return ''
  try { return safeStorage.decryptString(await readFile(keyFile())) } catch { return '' }
}

export async function paymentSettings(): Promise<PaymentSettings> {
  const saved = await readSaved()
  return { shopId: saved.shopId ?? '', monthPrice: saved.monthPrice ?? 0, receipts: saved.receipts === true, streamerPercent: saved.streamerPercent ?? 0, hasKey: existsSync(keyFile()) }
}

/** Saves the settings; an empty key keeps the stored one, `clearKey` removes it (payments switch off). */
export async function setPaymentSettings(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const shopId = String(input.shopId ?? '').trim()
  const monthPrice = Number(input.monthPrice)
  const streamerPercent = Number(input.streamerPercent ?? 0)
  const key = String(input.secretKey ?? '').trim()
  if (shopId && !/^\d{1,12}$/.test(shopId)) throw new Error('shopId — это число из личного кабинета ЮKassa')
  if (!Number.isFinite(monthPrice) || monthPrice < 0 || monthPrice > 100_000) throw new Error('Укажите цену месяца в рублях')
  if (!Number.isFinite(streamerPercent) || streamerPercent < 0 || streamerPercent > 100) throw new Error('Доля стримера: от 0 до 100 %')
  if (key && !/^(live|test)_[A-Za-z0-9_-]{10,200}$/.test(key)) throw new Error('Секретный ключ ЮKassa начинается с live_ или test_')
  if (key) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать ключ на этом компьютере')
    await writeFile(keyFile(), safeStorage.encryptString(key))
  }
  if (input.clearKey === true) await rm(keyFile(), { force: true })
  const next: SavedPayments = { shopId, monthPrice: Math.round(monthPrice * 100) / 100, receipts: input.receipts === true, streamerPercent: Math.round(streamerPercent * 10) / 10 }
  await writeFile(settingsFile(), JSON.stringify(next), 'utf8')
  return paymentSettings()
}

/** Environment for the API process: owner token, ЮKassa and the public site address. */
export async function apiEnvironment(publicUrl: string): Promise<Record<string, string>> {
  const saved = await readSaved()
  const key = await secretKey()
  return {
    TARKOV_ADMIN_TOKEN: ADMIN_TOKEN,
    ...(publicUrl ? { TARKOV_PUBLIC_URL: publicUrl } : {}),
    ...(saved.shopId && key && saved.monthPrice ? {
      YOOKASSA_SHOP_ID: saved.shopId,
      YOOKASSA_SECRET_KEY: key,
      TARKOV_PRICE_MONTH_RUB: String(saved.monthPrice),
      YOOKASSA_RECEIPTS: saved.receipts ? '1' : '0',
      TARKOV_STREAMER_PERCENT: String(saved.streamerPercent ?? 0),
    } : {}),
  }
}

async function admin(method: 'GET' | 'POST', path: string, body?: unknown) {
  let response: Response
  try {
    response = await fetch(`${API}/v1/admin${path}`, {
      method,
      signal: AbortSignal.timeout(8000),
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Сервер на этом компьютере не запущен')
  }
  const result = await response.json().catch(() => null) as { error?: string } | null
  if (response.status === 404 && result && 'error' in result && result.error === 'Not found') throw new Error('Сервер запущен не из этого приложения: перезапустите его кнопкой «Сервер»')
  if (!response.ok) throw new Error(result?.error ?? `Ошибка сервера: ${response.status}`)
  return result
}

export function listStreamers() {
  return admin('GET', '/streamers')
}

/** A one-time link for the streamer: /streamer/<token> on the public site (or this PC's site without one). */
export async function inviteStreamer(code: unknown, siteUrl: string) {
  const result = await admin('POST', '/streamer-invites', { code: String(code ?? '') }) as { token: string; code: string; expiresAt: string }
  return { link: `${siteUrl}/streamer/${result.token}`, code: result.code, expiresAt: result.expiresAt }
}
