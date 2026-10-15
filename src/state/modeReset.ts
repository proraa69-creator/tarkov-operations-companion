/**
 * The reset of one game mode (owner, 15.10.2026: «при смене ника … прогресс сбрасывается полностью в данном режиме,
 * квесты, и все все обнуляется, но только в выбраном режиме» and «кнопку Престиж +, по этой кнопке просто обнуляется
 * прогресс в выбраном режиме»), «Вайп» and «Сброс». All go through AppState's `resetModeProgress(mode, at, reason)`:
 *   - the mode's records in the profile go (src/domain/progress.ts wipeModeProgress) and the mode is found again from every
 *     log at once: no press is a floor («нужно что бы приложение находило все актуальные на данный момент квесты, даже
 *     если просто сделали сброс приложения, а в игре нет»); «Престиж +», «Вайп» and a nickname leave a pending marker
 *     that the game's own reset in the logs resolves;
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

/** What reset the mode: «Престиж +», «Вайп», «Сброс» (`rebuild`) or a confirmed new nickname (src/account/nicknameChange.ts). */
export type ModeResetReason = 'prestige' | 'wipe' | 'rebuild' | 'nickname'

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

/**
 * The notice after a reset: «Ник изменился — прогресс режима PvE сброшен», «Прогресс режима PvE найден заново по
 * журналам» after «Сброс», and the same after «Престиж +» / «Вайп» (each rebuilds the mode from the logs at once).
 */
export function modeResetMessage(reason: ModeResetReason, mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  if (locale === 'en') {
    if (reason === 'nickname') return `Nickname changed — ${name} progress was reset`
    if (reason === 'rebuild') return `${name} progress found again from the logs`
    return `${reason === 'wipe' ? 'Wipe' : 'Prestige +'} — ${name} progress found again from the logs`
  }
  if (reason === 'nickname') return `Ник изменился — прогресс режима ${name} сброшен`
  if (reason === 'rebuild') return `Прогресс режима ${name} найден заново по журналам`
  return `${reason === 'wipe' ? 'Вайп' : 'Престиж +'} — прогресс режима ${name} найден заново по журналам`
}

/**
 * The confirm text of «Престиж +», RU and EN (owner, 15.10.2026): the mode is found again from the game's logs at once;
 * the quests before the prestige drop out by themselves once the logs show the game's new profile. The prestige level is
 * chosen in the same window.
 */
export function prestigeResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Prestige +', title: 'Prestige +', question: `Prestige of ${name}: this mode's progress will be deleted and found again from the game logs. Once the game shows the new profile after the prestige, the old quests drop out by themselves. Other modes will not change.`, choose: 'Choose your prestige', confirm: 'Reset', cancel: 'Cancel', close: 'Close' }
    : { button: 'Престиж +', title: 'Престиж +', question: `Престиж режима ${name}: прогресс этого режима будет удалён и найден заново по журналам игры. Когда игра покажет новый профиль после престижа, старые квесты отпадут сами. Другие режимы не изменятся.`, choose: 'Выберите свой престиж', confirm: 'Сбросить', cancel: 'Отмена', close: 'Закрыть' }
}

/**
 * The confirm text of «Вайп» (owner, 15.10.2026). A game wipe keeps the prestige (BSG, patch 0.16.0.0: «Prestige levels
 * and rewards do not reset with wipes»), so the mode's prestige stays.
 */
export function wipeResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Wipe', title: 'Wipe', question: `Wipe of ${name}: this mode's progress will be deleted and found again from the game logs. Once the game shows the new profile after the wipe, the old quests drop out by themselves. Other modes will not change.`, confirm: 'Wipe', cancel: 'Cancel', close: 'Close' }
    : { button: 'Вайп', title: 'Вайп', question: `Вайп режима ${name}: прогресс этого режима будет удалён и найден заново по журналам игры. Когда игра покажет новый профиль после вайпа, старые квесты отпадут сами. Другие режимы не изменятся.`, confirm: 'Сделать вайп', cancel: 'Отмена', close: 'Закрыть' }
}

/** The confirm text of «Сброс» (owner, 15.10.2026: «сделай эту в отдельную кнопку сброс»): rebuild from every log at once. */
export function rebuildResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Reset', title: 'Reset', question: `Reset of ${name}: this mode's progress will be deleted and found again at once from all game logs. Use it if quests are shown wrong. Other modes will not change.`, confirm: 'Reset and find again', cancel: 'Cancel', close: 'Close' }
    : { button: 'Сброс', title: 'Сброс', question: `Сброс режима ${name}: прогресс этого режима будет удалён и сразу найден заново по всем журналам игры. Используйте, если квесты отображаются неправильно. Другие режимы не изменятся.`, confirm: 'Сбросить и найти заново', cancel: 'Отмена', close: 'Закрыть' }
}

/** «Ожидаем престиж в журналах игры…» under the buttons while a marker is pending (src/domain/types.ts resetMarker). */
export function pendingMarkerText(kind: 'prestige' | 'wipe' | 'nickname', locale: 'ru' | 'en') {
  if (locale === 'en') return `Waiting for the ${kind === 'prestige' ? 'prestige' : kind === 'wipe' ? 'wipe' : 'new profile'} in the game logs: the quests before it still count.`
  return `Ожидаем ${kind === 'prestige' ? 'престиж' : kind === 'wipe' ? 'вайп' : 'новый профиль'} в журналах игры: квесты до него пока учитываются.`
}
