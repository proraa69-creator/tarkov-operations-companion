import { generateKeyPairSync, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import { buildOwnerEmails } from './buildEdition.js'

/**
 * The owner's controls for the server on this PC (Server panel → «Оплата» and «Стримеры»):
 * - The global streamer share (TARKOV_STREAMER_PERCENT) is kept in userData/payments.json. Secrets of other
 *   services are encrypted with safeStorage and only ever handed to the local API process through its environment
 *   (never to the renderer, never logged).
 * - Streamer invitations through the API's owner-only /v1/admin routes, authorised by a random token made for each
 *   start of the API (TARKOV_ADMIN_TOKEN) — it never leaves this PC, and the public link does not forward /v1/admin.
 */
const API = 'http://127.0.0.1:8787'
export const ADMIN_TOKEN = randomBytes(32).toString('base64url')

/** «Доля стримеров»: the share of every payment credited to the referring streamer (server default 10 %). */
export interface StreamerShareSettings { streamerPercent: number }
/**
 * payments.json is kept as is: older versions also stored settings of former payment services there. Only
 * `streamerPercent` is read now; the other fields (and the old encrypted key files next to it) are the owner's data
 * and are left untouched on disk, just no longer read.
 */
interface SavedPayments { streamerPercent?: number }
export const DEFAULT_STREAMER_PERCENT = 10

const settingsFile = () => join(app.getPath('userData'), 'payments.json')
/** «E-mail владельца»: the accounts that see the owner section of the website (TARKOV_OWNER_EMAILS). */
const ownerFile = () => join(app.getPath('userData'), 'owner.json')
const EMAIL = /^[^\s@,;]{1,64}@[^\s@,;]{1,190}\.[^\s@,;]{2,}$/
/** «SMS: одноразовые коды»: provider settings in sms.json, the key encrypted in sms-key.bin. */
const smsFile = () => join(app.getPath('userData'), 'sms.json')
const smsKeyFile = () => join(app.getPath('userData'), 'sms-key.bin')
/** «Почта: коды подтверждения»: provider settings in email.json, the key encrypted in email-key.bin. */
const emailFile = () => join(app.getPath('userData'), 'email.json')
const emailKeyFile = () => join(app.getPath('userData'), 'email-key.bin')

async function readSaved(): Promise<SavedPayments> {
  try {
    const saved = JSON.parse(await readFile(settingsFile(), 'utf8')) as unknown
    return saved && typeof saved === 'object' ? saved as SavedPayments : {}
  } catch {
    return {}
  }
}

async function secretKey(file: string) {
  if (!existsSync(file)) return ''
  try { return safeStorage.decryptString(await readFile(file)) } catch { return '' }
}

async function storeSecret(file: string, value: string) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows не даёт зашифровать ключ на этом компьютере')
  await writeFile(file, safeStorage.encryptString(value))
}

function savedPercent(saved: SavedPayments) {
  const value = Number(saved.streamerPercent)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : DEFAULT_STREAMER_PERCENT
}

export async function streamerShareSettings(): Promise<StreamerShareSettings> {
  return { streamerPercent: savedPercent(await readSaved()) }
}

/** Saves «Доля стримеров, %» (0–100); the other fields of payments.json are kept as they are. */
export async function setStreamerShare(raw: unknown): Promise<StreamerShareSettings> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const streamerPercent = Number(input.streamerPercent)
  if (input.streamerPercent === '' || input.streamerPercent == null || !Number.isFinite(streamerPercent) || streamerPercent < 0 || streamerPercent > 100) throw new Error('Доля стримеров: от 0 до 100 %')
  const previous = await readSaved()
  const next = { ...previous, streamerPercent: Math.round(streamerPercent * 10) / 10 }
  await writeFile(settingsFile(), JSON.stringify(next), 'utf8')
  return streamerShareSettings()
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

// ---------------------------------------------------------------------------------------------------------------
// «Почта: коды подтверждения» (server/src/services/email, docs/email-codes.md). Set ONLY here, on the owner's PC, for
// the same reason as SMS: whoever controls the e-mail provider could redirect registration and sign-in codes.
// ---------------------------------------------------------------------------------------------------------------

export type EmailProvider = '' | 'resend'
/** The key is write-only: only whether it is stored is shown. */
export interface EmailSettings { provider: EmailProvider; from: string; dailyLimit: number; hasKey: boolean; configured: boolean }
interface SavedEmail { provider?: EmailProvider; from?: string; dailyLimit?: number }
const EMAIL_PROVIDERS: EmailProvider[] = ['resend']
export const DEFAULT_EMAIL_FROM = 'Raid OS <noreply@raidos.app>'
export const DEFAULT_EMAIL_DAILY_LIMIT = 500
/** `Name <box@domain>` or `box@domain` (the same rule as the server, server/src/services/email/index.ts). */
const FROM = /^(?:[^<>@"\r\n]{1,80} <[^\s<>@]{1,64}@[^\s<>@]{1,190}\.[A-Za-z]{2,}>|[^\s<>@]{1,64}@[^\s<>@]{1,190}\.[A-Za-z]{2,})$/

async function readEmail(): Promise<SavedEmail> {
  try { return JSON.parse(await readFile(emailFile(), 'utf8')) as SavedEmail } catch { return {} }
}

export async function emailSettings(): Promise<EmailSettings> {
  const saved = await readEmail()
  const hasKey = existsSync(emailKeyFile())
  const provider = saved.provider && EMAIL_PROVIDERS.includes(saved.provider) ? saved.provider : ''
  return { provider, from: saved.from || DEFAULT_EMAIL_FROM, dailyLimit: saved.dailyLimit ?? DEFAULT_EMAIL_DAILY_LIMIT, hasKey, configured: Boolean(provider && hasKey) }
}

/** Saves the e-mail settings; an empty key keeps the stored one, `clearKey` removes it (e-mail codes switch off). */
export async function setEmailSettings(raw: unknown) {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const provider = String(input.provider ?? '').trim() as EmailProvider
  const from = String(input.from ?? '').trim() || DEFAULT_EMAIL_FROM
  const key = String(input.apiKey ?? '').trim()
  const dailyLimit = Number(input.dailyLimit ?? DEFAULT_EMAIL_DAILY_LIMIT)
  if (provider && !EMAIL_PROVIDERS.includes(provider)) throw new Error('Неизвестный почтовый сервис')
  if (from.length > 200 || !FROM.test(from)) throw new Error('Адрес отправителя: «Raid OS <noreply@raidos.app>» или просто noreply@raidos.app')
  if (key && !/^re_[A-Za-z0-9_-]{8,200}$/.test(key)) throw new Error('Ключ Resend начинается с re_ и копируется целиком, без пробелов')
  if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 1_000_000) throw new Error('Лимит писем в сутки: целое число от 1 до 1 000 000')
  if (key) await storeSecret(emailKeyFile(), key)
  if (input.clearKey === true) await rm(emailKeyFile(), { force: true })
  const next: SavedEmail = { provider, from, dailyLimit }
  await writeFile(emailFile(), JSON.stringify(next), 'utf8')
  return emailSettings()
}

/** What the running API reports: whether e-mail codes are on and how many e-mails went out in the last 24 hours. */
export async function emailServerStatus() {
  return await admin('GET', '/email') as { emailEnabled: boolean; provider: string | null; from: string | null; sentToday: number; dailyLimit: number }
}

/** «Отправить тестовое письмо» through the running API (counts towards the daily limit). */
export async function sendTestEmail(to: unknown) {
  return await admin('POST', '/email/test', { to: String(to ?? '').trim().slice(0, 254) }) as { ok: boolean; provider: string; sentToday: number; dailyLimit: number }
}

async function emailEnvironment(): Promise<Record<string, string>> {
  const saved = await readEmail()
  const key = await secretKey(emailKeyFile())
  if (!saved.provider || !EMAIL_PROVIDERS.includes(saved.provider) || !key) return {}
  return {
    TARKOV_EMAIL_PROVIDER: saved.provider,
    TARKOV_EMAIL_API_KEY: key,
    TARKOV_EMAIL_FROM: saved.from || DEFAULT_EMAIL_FROM,
    TARKOV_EMAIL_DAILY_LIMIT: String(saved.dailyLimit ?? DEFAULT_EMAIL_DAILY_LIMIT),
  }
}

/** Environment for the API process: owner token, owner e-mails, streamer share, SMS, e-mail and the public site address. */
export async function apiEnvironment(publicUrl: string): Promise<Record<string, string>> {
  const saved = await readSaved()
  const owners = await ownerEmails()
  const sms = await smsEnvironment()
  const email = await emailEnvironment()
  return {
    TARKOV_ADMIN_TOKEN: ADMIN_TOKEN,
    ...sms,
    ...email,
    ...(owners.length ? { TARKOV_OWNER_EMAILS: owners.join(',') } : {}),
    ...(publicUrl ? { TARKOV_PUBLIC_URL: publicUrl } : {}),
    TARKOV_STREAMER_PERCENT: String(savedPercent(saved)),
  }
}

/** The API's Ed25519 key for signed entitlements (docs/subscription-protection.md), encrypted with safeStorage here. */
const entitlementKeyFile = () => join(app.getPath('userData'), 'entitlement-key.bin')
/** Where the API keeps its key when it runs without this app (server/src/services/entitlement.ts). */
const SERVER_KEY_FILE = 'entitlement-ed25519.pem'

/**
 * TARKOV_ENTITLEMENT_PRIVATE_KEY for the API on this PC. Made once and kept encrypted (DPAPI) in userData; a key the
 * API made earlier next to the database is taken over (so the players' apps that pinned it keep working) and its plain
 * file removed. An encrypted key that cannot be decrypted any more is never replaced silently: the API then keeps
 * using its own file (or makes one), and the players sign out and in once (docs/subscription-protection.md).
 */
export async function entitlementKeyEnvironment(serverDataDir: string): Promise<Record<string, string>> {
  if (!safeStorage.isEncryptionAvailable()) return {}
  const file = entitlementKeyFile()
  let pem = await secretKey(file)
  if (!pem && existsSync(file)) return {}
  if (!pem) {
    const plain = join(serverDataDir, SERVER_KEY_FILE)
    const existing = existsSync(plain) ? await readFile(plain, 'utf8').catch(() => '') : ''
    pem = existing.includes('PRIVATE KEY') ? existing : generateKeyPairSync('ed25519').privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()
    await storeSecret(file, pem)
    if ((await secretKey(file)) !== pem) return {}
    if (existing) await rm(plain, { force: true }).catch(() => {})
  }
  return { TARKOV_ENTITLEMENT_PRIVATE_KEY: Buffer.from(pem, 'utf8').toString('base64') }
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
