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
let candidates: readonly number[] = []
const listeners = new Set<() => void>()

export function subscribeEftAccount(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The game account the logs showed last, if any. */
export function detectedEftAccount() {
  return detected
}

/** Every game account the logs show, the one that played last first (the same array until the logs change). */
export function detectedEftAccounts() {
  return candidates
}

/**
 * The game account of this PC from a log scan: the one that played last (`latestMode`, the newest signal of the logs), then
 * PvP, PvE, Season. A game account has one AccountId in every mode, so another id is another player: two players on one PC,
 * one playing the Season under his bound account and the other PvP before, locked the first one out — «PvP first» always
 * picked the other's account, however he restarted (support chat, 20.11.2026).
 */
export function eftAccountIdOf(result: Pick<ModeLogScanResult, 'latestAccountIdByMode' | 'accountIds'> & Partial<Pick<ModeLogScanResult, 'latestMode'>>) {
  const byMode = result.latestAccountIdByMode ?? {}
  const newest = result.latestMode ? byMode[result.latestMode] : undefined
  const id = newest ?? byMode.pvp ?? byMode.pve ?? byMode.seasonal ?? result.accountIds?.[0]
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : undefined
}

/**
 * Every game account of this PC's logs, the one that played last first, then PvP, PvE, Season and the rest: they are offered
 * to the server in turn until it takes one (reportEftAccounts). One player with a second game account (support chat,
 * 20.11.2026: «после обновления… к этому аккаунту Raid OS привязан другой аккаунт») and two players on one PC both get in
 * with the account bound to them, wherever it played.
 */
export function eftAccountIdsOf(result: Pick<ModeLogScanResult, 'latestAccountIdByMode' | 'accountIds'> & Partial<Pick<ModeLogScanResult, 'latestMode'>>) {
  const byMode = result.latestAccountIdByMode ?? {}
  const all = [result.latestMode ? byMode[result.latestMode] : undefined, byMode.pvp, byMode.pve, byMode.seasonal, ...(result.accountIds ?? [])]
  return [...new Set(all.filter((id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0))]
}

/** The server's answer to a report: taken, refused (one game account — one Raid OS account), or not reached. */
export type EftReportResult = { taken: number } | { refused: string } | { failed: true }
type ServiceRequest = (method: 'POST', path: string, body: unknown) => Promise<unknown>
const REFUSED = /уже используется|привязан другой аккаунт/i

/**
 * The game accounts offered to the server in turn, the newest first, until it takes one: the device's report is then that one
 * (AccountStore.eftBlock reads the last report). None taken: the newest one is reported again last, so the lock tells about it.
 */
export async function reportEftAccounts(request: ServiceRequest, ids: readonly number[], errorText: (error: unknown) => string = (error) => String((error as Error)?.message ?? error)): Promise<EftReportResult> {
  let refusal: string | undefined
  for (const id of ids) {
    try {
      await request('POST', EFT_REPORT_PATH, { accountId: String(id) })
      return { taken: id }
    } catch (error) {
      const message = errorText(error)
      if (!REFUSED.test(message)) return { failed: true }
      refusal ??= message
    }
  }
  if (refusal === undefined) return { failed: true }
  if (ids.length > 1) await request('POST', EFT_REPORT_PATH, { accountId: String(ids[0]) }).catch(() => undefined)
  return { refused: refusal }
}

/** Called with every log scan (AppShell): remembers the game account seen in the logs. */
export function rememberEftAccount(result: Pick<ModeLogScanResult, 'latestAccountIdByMode' | 'accountIds'> & Partial<Pick<ModeLogScanResult, 'latestMode'>>) {
  const id = eftAccountIdOf(result)
  const ids = eftAccountIdsOf(result)
  if (id === undefined || (id === detected && ids.join(',') === candidates.join(','))) return
  detected = id
  candidates = ids
  for (const listener of listeners) listener()
}

/**
 * The locked app (Paywall.tsx EftLock, on opening and «Проверить снова»): the game account the logs show now is reported,
 * so starting the game under the bound account opens the app. The main process follows the logs from the app's start
 * (electron/logWatcher.ts): its answer is the identity it already has — the newest launches, read within seconds — not a
 * new read of every launch. Resolves with whether a game account was found and reported.
 */
export async function recheckEftAccount() {
  const desktop = window.tarkovDesktop
  if (!desktop?.autoFindAndScanLogs || !desktop.serviceRequest) return false
  let saved: string | undefined
  try { saved = localStorage.getItem(LOG_FOLDER_STORAGE_KEY) ?? undefined } catch { saved = undefined }
  const result = await desktop.autoFindAndScanLogs(saved).catch(() => null)
  if (!result) return false
  rememberEftAccount(result)
  const ids = eftAccountIdsOf(result)
  if (!ids.length) return false
  // Taken or refused, the server now decides from the last report; the caller asks for the status again.
  await reportEftAccounts(desktop.serviceRequest, ids)
  return true
}
