import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { buildOwnerEmails } from './buildEdition.js'

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

/** «Оплата: другие страны (Lava.top)». Both keys are write-only: only whether they are stored is shown. */
export interface LavaSettings { offerId: string; currency: 'USD' | 'EUR'; rubRate: number; paymentMethod: '' | 'UNLIMINT' | 'PAYPAL' | 'STRIPE'; hasApiKey: boolean; hasWebhookKey: boolean }
export interface PaymentSettings { shopId: string; monthPrice: number; receipts: boolean; streamerPercent: number; hasKey: boolean; autopay: boolean; lava: LavaSettings }
interface SavedPayments { shopId?: string; monthPrice?: number; receipts?: boolean; streamerPercent?: number; autopay?: boolean; lava?: { offerId?: string; currency?: 'USD' | 'EUR'; rubRate?: number; paymentMethod?: LavaSettings['paymentMethod'] } }
/** The owner's Lava.top offer (https://app.lava.top/products/3cb41c8c-…/dde8abeb-…), prefilled in the form. */
export const DEFAULT_LAVA_OFFER_ID = 'dde8abeb-b5ae-4a23-87b8-6bda4c7789e1'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const settingsFile = () => join(app.getPath('userData'), 'payments.json')
/** «E-mail владельца»: the accounts that see the owner section of the website (TARKOV_OWNER_EMAILS). */
const ownerFile = () => join(app.getPath('userData'), 'owner.json')
const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/
const keyFile = () => join(app.getPath('userData'), 'payments-key.bin')
const lavaApiKeyFile = () => join(app.getPath('userData'), 'lava-api-key.bin')
const lavaWebhookKeyFile = () => join(app.getPath('userData'), 'lava-webhook-key.bin')
/** «SMS: одноразовые коды»: provider settings in sms.json, the key encrypted in sms-key.bin. */
const smsFile = () => join(app.getPath('userData'), 'sms.json')
const smsKeyFile = () => join(app.getPath('userData'), 'sms-key.bin')

async function readSaved(): Promise<SavedPayments> {
  try {
    return JSON.parse(await readFile(settingsFile(), 'utf8')) as SavedPayments
  } catch {
    return {}
  }
}

async function secretKey(file = keyFile()) {
  if (!existsSync(file)) return ''
  try { return safeStorage.decryptString(await readFile(file)) } catch { return '' }
}

async function storeSecret(file: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать ключ на этом компьютере')
  await writeFile(file, safeStorage.encryptString(value))
}

export async function paymentSettings(): Promise<PaymentSettings> {
  const saved = await readSaved()
  const lava = saved.lava ?? {}
  return {
    shopId: saved.shopId ?? '', monthPrice: saved.monthPrice ?? 0, receipts: saved.receipts === true, streamerPercent: saved.streamerPercent ?? 10, hasKey: existsSync(keyFile()),
    autopay: saved.autopay === true,
    lava: { offerId: lava.offerId ?? DEFAULT_LAVA_OFFER_ID, currency: lava.currency ?? 'USD', rubRate: lava.rubRate ?? 0, paymentMethod: lava.paymentMethod ?? '', hasApiKey: existsSync(lavaApiKeyFile()), hasWebhookKey: existsSync(lavaWebhookKeyFile()) },
  }
}

/** «Оплата: другие страны (Lava.top)»: saved separately from the ЮKassa fields; empty keys keep the stored ones. */
async function setLavaSettings(input: Record<string, unknown>) {
  const saved = await readSaved()
  const offerId = String(input.offerId ?? '').trim()
  const currency = String(input.currency ?? 'USD').toUpperCase()
  const rubRate = Number(input.rubRate ?? 0)
  const paymentMethod = String(input.paymentMethod ?? '').toUpperCase()
  const apiKey = String(input.apiKey ?? '').trim()
  const webhookKey = String(input.webhookKey ?? '').trim()
  if (offerId && !UUID.test(offerId)) throw new Error('offerId — это идентификатор оффера из ссылки на продукт Lava.top (вида dde8abeb-…)')
  if (currency !== 'USD' && currency !== 'EUR') throw new Error('Валюта Lava.top: USD или EUR')
  if (!Number.isFinite(rubRate) || rubRate < 0 || rubRate > 100_000) throw new Error('Укажите курс: сколько рублей считать за 1 USD/EUR')
  if (paymentMethod && !['UNLIMINT', 'PAYPAL', 'STRIPE'].includes(paymentMethod)) throw new Error('Неизвестный способ оплаты Lava.top')
  if (apiKey && (apiKey.length < 10 || apiKey.length > 300 || /\s/.test(apiKey))) throw new Error('Проверьте API-ключ Lava.top: он копируется целиком, без пробелов')
  if (webhookKey && (webhookKey.length < 8 || webhookKey.length > 300)) throw new Error('Ключ вебхука: от 8 символов, тот же, что указан в настройках вебхука Lava.top')
  if (apiKey) await storeSecret(lavaApiKeyFile(), apiKey)
  if (webhookKey) await storeSecret(lavaWebhookKeyFile(), webhookKey)
  if (input.clearKeys === true) {
    await rm(lavaApiKeyFile(), { force: true })
    await rm(lavaWebhookKeyFile(), { force: true })
  }
  const next: SavedPayments = { ...saved, lava: { offerId: offerId || DEFAULT_LAVA_OFFER_ID, currency, rubRate: Math.round(rubRate * 100) / 100, paymentMethod: paymentMethod as LavaSettings['paymentMethod'] } }
  await writeFile(settingsFile(), JSON.stringify(next), 'utf8')
  return paymentSettings()
}

/** Saves the settings; an empty key keeps the stored one, `clearKey` removes it (payments switch off). */
export async function setPaymentSettings(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  if (input.section === 'lava') return setLavaSettings(input)
  const shopId = String(input.shopId ?? '').trim()
  const monthPrice = Number(input.monthPrice)
  const streamerPercent = Number(input.streamerPercent ?? 10)
  const key = String(input.secretKey ?? '').trim()
  if (shopId && !/^\d{1,12}$/.test(shopId)) throw new Error('shopId — это число из личного кабинета ЮKassa')
  if (!Number.isFinite(monthPrice) || monthPrice < 0 || monthPrice > 100_000) throw new Error('Укажите цену месяца в рублях')
  if (!Number.isFinite(streamerPercent) || streamerPercent < 0 || streamerPercent > 100) throw new Error('Доля стримера: от 0 до 100 %')
  if (key && !/^(live|test)_[A-Za-z0-9_-]{10,200}$/.test(key)) throw new Error('Секретный ключ ЮKassa начинается с live_ или test_')
  if (key) await storeSecret(keyFile(), key)
  if (input.clearKey === true) await rm(keyFile(), { force: true })
  const previous = await readSaved()
  const next: SavedPayments = { ...previous, shopId, monthPrice: Math.round(monthPrice * 100) / 100, receipts: input.receipts === true, streamerPercent: Math.round(streamerPercent * 10) / 10, autopay: input.autopay === true }
  await writeFile(settingsFile(), JSON.stringify(next), 'utf8')
  return paymentSettings()
}

/**
 * The owner e-mails in force: those saved in the panel, otherwise the build's default (OWNER_EMAILS at build time,
 * scripts/write-build-info.mjs), so the owner's own build needs no manual setup. The server refuses new
 * registrations of every listed address either way.
 */
export async function ownerEmails(): Promise<string[]> {
  try {
    const saved = JSON.parse(await readFile(ownerFile(), 'utf8')) as { emails?: unknown }
    const emails = Array.isArray(saved.emails) ? saved.emails.filter((email): email is string => typeof email === 'string' && EMAIL.test(email)) : []
    return emails.length ? emails : buildOwnerEmails()
  } catch {
    return buildOwnerEmails()
  }
}

/**
 * Saves the owner e-mails (comma separated in the field). Each must already be registered on the site: the server then
 * refuses new registrations of a listed address, so nobody else can register it and receive owner rights.
 */
export async function setOwnerEmails(raw: unknown) {
  const emails = [...new Set(String(raw ?? '').split(/[\s,;]+/).map((email) => email.trim().toLowerCase()).filter(Boolean))]
  if (emails.length > 5) throw new Error('Не больше пяти e-mail владельца')
  const bad = emails.find((email) => !EMAIL.test(email) || email.length > 254)
  if (bad) throw new Error(`Некорректный e-mail: ${bad}`)
  for (const email of emails) {
    const result = await admin('GET', `/accounts?email=${encodeURIComponent(email)}`) as { exists?: boolean } | null
    if (!result?.exists) throw new Error(`Сначала зарегистрируйте ${email} на сайте, потом укажите его здесь`)
  }
  await writeFile(ownerFile(), JSON.stringify({ emails }), 'utf8')
  return emails
}

// ---------------------------------------------------------------------------------------------------------------
// «SMS: одноразовые коды» (server/src/services/sms, docs/sms-login.md). Set ONLY here, on the owner's PC: the website
// and its admin panel cannot change the provider, so a stolen owner web session cannot redirect one-time codes.
// ---------------------------------------------------------------------------------------------------------------

export type SmsProvider = '' | 'smsru' | 'smsc' | 'smsaero'
/** The key is write-only: only whether it is stored is shown. */
export interface SmsSettings { provider: SmsProvider; login: string; sender: string; dailyLimit: number; countries: string; hasKey: boolean; configured: boolean }
interface SavedSms { provider?: SmsProvider; login?: string; sender?: string; dailyLimit?: number; countries?: string }
const SMS_PROVIDERS: SmsProvider[] = ['smsru', 'smsc', 'smsaero']
export const DEFAULT_SMS_DAILY_LIMIT = 100

async function readSms(): Promise<SavedSms> {
  try { return JSON.parse(await readFile(smsFile(), 'utf8')) as SavedSms } catch { return {} }
}

/** Provider, login and key are all there (SMSC.ru and SMS Aero also need the login). */
function smsComplete(saved: SavedSms, hasKey: boolean) {
  return Boolean(saved.provider && SMS_PROVIDERS.includes(saved.provider) && hasKey && (saved.provider === 'smsru' || saved.login))
}

export async function smsSettings(): Promise<SmsSettings> {
  const saved = await readSms()
  const hasKey = existsSync(smsKeyFile())
  return {
    provider: saved.provider && SMS_PROVIDERS.includes(saved.provider) ? saved.provider : '', login: saved.login ?? '', sender: saved.sender ?? '',
    dailyLimit: saved.dailyLimit ?? DEFAULT_SMS_DAILY_LIMIT, countries: saved.countries ?? '7', hasKey, configured: smsComplete(saved, hasKey),
  }
}

/** Saves the SMS settings; an empty key keeps the stored one, `clearKey` removes it (phone features switch off). */
export async function setSmsSettings(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const provider = String(input.provider ?? '').trim() as SmsProvider
  const login = String(input.login ?? '').trim()
  const sender = String(input.sender ?? '').trim()
  const key = String(input.apiKey ?? '').trim()
  const dailyLimit = Number(input.dailyLimit ?? DEFAULT_SMS_DAILY_LIMIT)
  const countries = [...new Set(String(input.countries ?? '7').split(/[\s,;]+/).map((code) => code.replace(/^\+/, '')).filter(Boolean))]
  if (provider && !SMS_PROVIDERS.includes(provider)) throw new Error('Неизвестный провайдер SMS')
  if (login.length > 254 || /\s/.test(login)) throw new Error('Логин: без пробелов, до 254 символов')
  if ((provider === 'smsc' || provider === 'smsaero') && !login) throw new Error(provider === 'smsc' ? 'Для SMSC.ru укажите логин' : 'Для SMS Aero укажите e-mail аккаунта')
  if (sender.length > 11 || /[^A-Za-z0-9 ._-]/.test(sender)) throw new Error('Имя отправителя: до 11 латинских букв и цифр, как его согласовал провайдер')
  if (key && (key.length < 6 || key.length > 300 || /\s/.test(key))) throw new Error('Проверьте ключ: он копируется целиком, без пробелов')
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 100_000) throw new Error('Лимит SMS в сутки: целое число от 1 до 100 000')
  if (!countries.length || countries.some((code) => !/^[1-9]\d{0,2}$/.test(code))) throw new Error('Страны: коды через запятую, например 7 или 7, 375')
  if (key) await storeSecret(smsKeyFile(), key)
  if (input.clearKey === true) await rm(smsKeyFile(), { force: true })
  const next: SavedSms = { provider, login, sender, dailyLimit, countries: countries.join(',') }
  await writeFile(smsFile(), JSON.stringify(next), 'utf8')
  return smsSettings()
}

/** What the running API reports: whether SMS are on and how many went out in the last 24 hours. */
export async function smsServerStatus() {
  return await admin('GET', '/sms') as { smsEnabled: boolean; provider: string | null; sentToday: number; dailyLimit: number }
}

/** «Отправить тестовое SMS» through the running API (counts towards the daily limit). */
export async function sendTestSms(phone: unknown) {
  return await admin('POST', '/sms/test', { phone: String(phone ?? '').slice(0, 32) }) as { ok: boolean; provider: string; sentToday: number; dailyLimit: number }
}

async function smsEnvironment(): Promise<Record<string, string>> {
  const saved = await readSms()
  const key = await secretKey(smsKeyFile())
  if (!smsComplete(saved, Boolean(key))) return {}
  return {
    TARKOV_SMS_PROVIDER: saved.provider!,
    TARKOV_SMS_API_KEY: key,
    ...(saved.login ? { TARKOV_SMS_LOGIN: saved.login } : {}),
    ...(saved.sender ? { TARKOV_SMS_SENDER: saved.sender } : {}),
    TARKOV_SMS_DAILY_LIMIT: String(saved.dailyLimit ?? DEFAULT_SMS_DAILY_LIMIT),
    TARKOV_SMS_COUNTRIES: saved.countries ?? '7',
  }
}

/** Environment for the API process: owner token, owner e-mails, ЮKassa, Lava.top, SMS and the public site address. */
export async function apiEnvironment(publicUrl: string): Promise<Record<string, string>> {
  const saved = await readSaved()
  const key = await secretKey()
  const lava = saved.lava ?? {}
  const lavaApiKey = await secretKey(lavaApiKeyFile())
  const lavaWebhookKey = await secretKey(lavaWebhookKeyFile())
  const owners = await ownerEmails()
  const sms = await smsEnvironment()
  return {
    TARKOV_ADMIN_TOKEN: ADMIN_TOKEN,
    ...sms,
    ...(owners.length ? { TARKOV_OWNER_EMAILS: owners.join(',') } : {}),
    ...(publicUrl ? { TARKOV_PUBLIC_URL: publicUrl } : {}),
    ...(saved.shopId && key && saved.monthPrice ? {
      YOOKASSA_SHOP_ID: saved.shopId,
      YOOKASSA_SECRET_KEY: key,
      TARKOV_PRICE_MONTH_RUB: String(saved.monthPrice),
      YOOKASSA_RECEIPTS: saved.receipts ? '1' : '0',
      TARKOV_STREAMER_PERCENT: String(saved.streamerPercent ?? 10),
      // Off by default: the ЮKassa manager must enable recurring payments for the shop first.
      YOOKASSA_AUTOPAY: saved.autopay ? '1' : '0',
    } : {}),
    ...(lavaApiKey && lavaWebhookKey && lava.rubRate ? {
      LAVA_API_KEY: lavaApiKey,
      LAVA_WEBHOOK_KEY: lavaWebhookKey,
      LAVA_OFFER_ID: lava.offerId ?? DEFAULT_LAVA_OFFER_ID,
      LAVA_CURRENCY: lava.currency ?? 'USD',
      LAVA_RUB_RATE: String(lava.rubRate),
      ...(lava.paymentMethod ? { LAVA_PAYMENT_METHOD: lava.paymentMethod } : {}),
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
