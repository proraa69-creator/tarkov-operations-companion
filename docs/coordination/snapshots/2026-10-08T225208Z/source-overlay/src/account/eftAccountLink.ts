/**
 * «Пригласи друга» counts one friend per Escape from Tarkov account. The desktop app sends the game AccountId it reads
 * from the player's own logs to the signed-in server account (server: AccountStore.bindEftAccount). A game account that
 * already belongs to another Raid OS account is refused, and the app says so (EftAccountBinding.tsx).
 */
import type { ModeLogScanResult } from '../import/eftLogTimeline'

export const EFT_IN_USE_TEXT = 'Этот аккаунт Escape from Tarkov уже используется: он привязан к другому аккаунту Raid OS.'

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
