/**
 * The reset of one game mode (owner, 15.10.2026: «при смене ника … прогресс сбрасывается полностью в данном режиме,
 * квесты, и все все обнуляется, но только в выбраном режиме» and «кнопку Престиж +, по этой кнопке просто обнуляется
 * прогресс в выбраном режиме»). Both go through AppState's `resetModeProgress(mode, at, reason)`:
 *   - the mode's records in the profile (src/domain/progress.ts wipeModeProgress) and its epoch `at`, so a rescan of the
 *     logs, the server and the game's screens never bring back anything older;
 *   - here, the per-mode stores outside the profile (afterModeReset), the server of the account signed in now (queued
 *     while offline, sent only to that account; a reset made signed out stays local) and the notice.
 * Other modes, settings, the account and the nickname are not touched.
 */
import { useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { clearTraderLevels } from '../gunsmith/traderLevels'
import { saveCollected } from '../kappa/collector'
import { kappaCongratsKey } from '../kappa/kappaCongratsKey'
import { clearQuestChecks } from '../progression/questChecks'
import { QUEST_SYNC_TIP_KEY } from '../onboarding/guideProgress'
import { queueModeReset } from '../sync/serverSync'

/** What reset the mode: «Престиж +», «Вайп» or a confirmed new nickname (src/account/nicknameChange.ts). */
export type ModeResetReason = 'prestige' | 'wipe' | 'nickname'

export interface ModeResetNotice { id: number; mode: RaidMode; reason: ModeResetReason; at: string }

/**
 * The stores outside the profile that hold progress of the mode: the traders' loyalty (screen readings and the player's
 * own levels), the Collector checklist (the server's goes with the reset route), «Сделал в этом рейде»
 * checks and the Kappa congratulation of this profile and mode. The quest sync tip («Полная синхронизация квестов») shows
 * once more on this computer: the mode's current quests are read from the Tasks table again.
 */
export function wipeModeStores(profileId: string, mode: RaidMode) {
  clearTraderLevels(mode)
  // Local only: the server's list goes with the reset route of the account it was made under (never an empty list pushed
  // to whichever account signs in next).
  saveCollected(mode, [], { fromServer: true })
  clearQuestChecks(profileId, mode)
  try {
    localStorage.removeItem(kappaCongratsKey(profileId, mode))
    localStorage.removeItem(QUEST_SYNC_TIP_KEY)
  } catch { /* storage unavailable */ }
}

/** Called by AppState right after the profile's records of the mode went. */
export function afterModeReset({ profileId, mode, at, reason }: { profileId: string; mode: RaidMode; at: string; reason: ModeResetReason }) {
  wipeModeStores(profileId, mode)
  queueModeReset(mode, at)
  notices = [...notices.filter((notice) => notice.mode !== mode), { id: ++lastId, mode, reason, at }].slice(-3)
  notify()
}

let notices: ModeResetNotice[] = []
let lastId = 0
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }

/** The resets this session has not dismissed yet (the toast, components/ModeResetToast.tsx). */
export function useModeResetNotices() {
  return useSyncExternalStore(subscribe, () => notices, () => notices)
}

export function dismissModeResetNotice(id: number) {
  notices = notices.filter((notice) => notice.id !== id)
  notify()
}

/** PvP, PvE, «Сезон» / Season. */
export function modeResetName(mode: RaidMode, locale: 'ru' | 'en') {
  return mode === 'pvp' ? 'PvP' : mode === 'pve' ? 'PvE' : locale === 'en' ? 'Season' : 'Сезон'
}

/** «Ник изменился — прогресс режима PvE сброшен» / «Nickname changed — PvE progress was reset», the same after «Престиж +» and «Вайп». */
export function modeResetMessage(reason: ModeResetReason, mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  if (locale === 'en') return reason === 'nickname' ? `Nickname changed — ${name} progress was reset` : reason === 'wipe' ? `Wipe — ${name} progress was reset` : `Prestige + — ${name} progress was reset`
  return reason === 'nickname' ? `Ник изменился — прогресс режима ${name} сброшен` : reason === 'wipe' ? `Вайп — прогресс режима ${name} сброшен` : `Престиж + — прогресс режима ${name} сброшен`
}

/**
 * The confirm text of «Престиж +», RU and EN (owner, 15.10.2026): only the game's new log entries count afterwards; the
 * prestige level is chosen in the same window.
 */
export function prestigeResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Prestige +', title: 'Prestige +', question: `Prestige of ${name}: all progress of this mode will be deleted; only new game log entries will count. Other modes will not change.`, choose: 'Choose your prestige', confirm: 'Reset', cancel: 'Cancel', close: 'Close' }
    : { button: 'Престиж +', title: 'Престиж +', question: `Престиж режима ${name}: весь прогресс этого режима будет удалён, учитываться будут только новые записи журналов игры. Другие режимы не изменятся.`, choose: 'Выберите свой престиж', confirm: 'Сбросить', cancel: 'Отмена', close: 'Закрыть' }
}

/**
 * The confirm text of «Вайп» (owner, 15.10.2026: «после вайпа должны читаться только новые журналы, не старые … как и в
 * престиже»). A game wipe keeps the prestige (BSG, patch 0.16.0.0: «Prestige levels and rewards do not reset with wipes»),
 * so the mode's prestige stays.
 */
export function wipeResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Wipe', title: 'Wipe', question: `Wipe of ${name}: all progress of this mode will be deleted and the old game logs will no longer count — progress starts from zero. Other modes will not change.`, confirm: 'Wipe', cancel: 'Cancel', close: 'Close' }
    : { button: 'Вайп', title: 'Вайп', question: `Вайп режима ${name}: весь прогресс этого режима будет удалён, а старые журналы игры больше не будут учитываться — прогресс начнётся с нуля. Другие режимы не изменятся.`, confirm: 'Сделать вайп', cancel: 'Отмена', close: 'Закрыть' }
}
