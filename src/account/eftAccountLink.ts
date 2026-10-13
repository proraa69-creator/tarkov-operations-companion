/**
 * One Escape from Tarkov account — one Raid OS account, both ways (owner, 13.10.2026; «Пригласи друга» also counts one
 * friend per game account). The desktop app sends the game AccountId it reads from the player's own logs to the
 * signed-in server account (server: AccountStore.bindEftAccount). The server binds a free one, and refuses this PC the
 * entitlement when the game account belongs to another Raid OS account or this account is bound to another game
 * account: the app then shows why and can check again (Paywall.tsx EftLock, EftAccountBinding.tsx).
 */
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import { LOG_FOLDER_STORAGE_KEY } from '../import/logApply'

export const EFT_IN_USE_TEXT = 'Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.'
export const EFT_OTHER_TEXT = 'К этому аккаунту Raid OS привязан другой аккаунт Escape from Tarkov.'
export const EFT_REPORT_PATH = '/v1/accounts/me/eft-account'

let detected: number | undefined
const listeners = new Set<() => void>()

export function subscribeEftAccount(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The game account the logs showed last, if any. */
export function detectedEftAccount() {
  return detected
}

/** The game account of this PC from a log scan: the PvP one first (the paid service is about PvP), then PvE, Season. */
export function eftAccountIdOf(result: Pick<ModeLogScanResult, 'latestAccountIdByMode' | 'accountIds'>) {
  const byMode = result.latestAccountIdByMode ?? {}
  const id = byMode.pvp ?? byMode.pve ?? byMode.seasonal ?? result.accountIds?.[0]
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

/** Called with every log scan (AppShell): remembers the game account seen in the logs. */
export function rememberEftAccount(result: Pick<ModeLogScanResult, 'latestAccountIdByMode' | 'accountIds'>) {
  const id = eftAccountIdOf(result)
  if (id === undefined || id === detected) return
  detected = id
  for (const listener of listeners) listener()
}

/**
 * The locked app (Paywall.tsx EftLock, on opening and «Проверить снова»): the game's logs are scanned again and the
 * game account they show now is reported, so starting the game under the bound account opens the app. Resolves with
 * whether a game account was found and reported.
 */
export async function recheckEftAccount() {
  const desktop = window.tarkovDesktop
  if (!desktop?.autoFindAndScanLogs || !desktop.serviceRequest) return false
  let saved: string | undefined
  try { saved = localStorage.getItem(LOG_FOLDER_STORAGE_KEY) ?? undefined } catch { saved = undefined }
  const result = await desktop.autoFindAndScanLogs(saved).catch(() => null)
  if (!result) return false
  rememberEftAccount(result)
  const id = eftAccountIdOf(result)
  if (id === undefined) return false
  // Refused (409) or not, the server now decides from this report; the caller asks for the status again.
  await desktop.serviceRequest('POST', EFT_REPORT_PATH, { accountId: String(id) }).catch(() => undefined)
  return true
}
