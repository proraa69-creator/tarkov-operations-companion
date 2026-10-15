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

/** What reset the mode: «Престиж +» or a confirmed new nickname (src/account/nicknameChange.ts). */
export type ModeResetReason = 'prestige' | 'nickname'

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

/** «Ник изменился — прогресс режима PvE сброшен» / «Nickname changed — PvE progress was reset», and the same for «Престиж +». */
export function modeResetMessage(reason: ModeResetReason, mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  if (locale === 'en') return reason === 'nickname' ? `Nickname changed — ${name} progress was reset` : `Prestige + — ${name} progress was reset`
  return reason === 'nickname' ? `Ник изменился — прогресс режима ${name} сброшен` : `Престиж + — прогресс режима ${name} сброшен`
}

/** The confirm text of «Престиж +», RU and EN. */
export function prestigeResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Prestige +', title: 'Prestige +', question: `Reset all ${name} progress? Quests, chapters, loyalty and everything else of this mode will be deleted. Other modes will not change.`, confirm: 'Reset', cancel: 'Cancel', close: 'Close' }
    : { button: 'Престиж +', title: 'Престиж +', question: `Сбросить весь прогресс режима ${name}? Квесты, главы, лояльность и всё остальное этого режима будут удалены. Другие режимы не изменятся.`, confirm: 'Сбросить', cancel: 'Отмена', close: 'Закрыть' }
}
