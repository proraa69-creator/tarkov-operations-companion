/**
 * The reset of one game mode (owner, 15.10.2026: «при смене ника … прогресс сбрасывается полностью в данном режиме,
 * квесты, и все все обнуляется, но только в выбраном режиме» and «кнопку Престиж +, по этой кнопке просто обнуляется
 * прогресс в выбраном режиме»), «Вайп» and «Сброс». All go through AppState's `resetModeProgress(mode, at, reason)`:
 *   - the mode's records in the profile go (src/domain/progress.ts wipeModeProgress) and the mode is read again from the
 *     logs. «Престиж +», «Вайп»: the player starts over, nothing older than the press counts (owner, 04.11.2026: «квестов у
 *     человека не будет, и он все проходит заново. То есть ему не нужны старые логи»). «Сброс»: every log counts, the
 *     quests are found again («логи опять находиться, которые были»), also what a press by mistake hid (floorAfterReset).
 *     A nickname leaves a pending marker that the game's own reset in the logs resolves;
 *   - here, the per-mode stores outside the profile (afterModeReset), the server of the account signed in now (queued
 *     while offline, sent only to that account; a reset made signed out stays local) and the notice.
 * Other modes, settings, the account and the nickname are not touched, but for «Избранное»: one list for every mode, it
 * goes with a press (owner, 04.11.2026: «должно сбрасываться все, что в избранном все квесты актуальные итд»; src/domain/
 * progress.ts clearPlayerLists).
 */
import { useSyncExternalStore } from 'react'
import type { RaidMode } from '../domain/types'
import { clearHideoutDirty, writeHideoutFound } from '../hideout/hideoutFound'
import { clearTraderLevels } from '../gunsmith/traderLevels'
import { saveCollected } from '../kappa/collector'
import { kappaCongratsKey } from '../kappa/kappaCongratsKey'
import { clearDeferredQuests } from '../progression/deferredQuests'
import { clearQuestChecks } from '../progression/questChecks'
import { questFoundStore } from '../quests/questFound'
import { clearQuestKeyFavorites } from '../quests/questKeyFavorites'
import { stashSeenStore } from '../stashScan/stashSeen'
import { queueModeReset } from '../sync/serverSync'

/** What reset the mode: «Престиж +», «Вайп», «Сброс» (`rebuild`) or a confirmed new nickname (src/account/nicknameChange.ts). */
export type ModeResetReason = 'prestige' | 'wipe' | 'rebuild' | 'nickname'

export interface ModeResetNotice { id: number; mode: RaidMode; reason: ModeResetReason; at: string }

/**
 * The stores outside the profile that hold progress of the mode: the traders' loyalty (screen readings and the player's
 * own levels and the flea market choice), the Collector checklist, the items found for the hideout and the quests and what
 * the last scan saw in the stash, «Отложенные квесты» (the server's copies of all these go with the reset route), «Сделал в
 * этом рейде» checks, «Избранные ключи» and the Kappa congratulation of this profile and mode. The quest sync tip («Полная синхронизация квестов») stays
 * seen: it shows once per computer, for the first acquaintance only (owner, 15.10.2026: «его достаточно показать один раз
 * при первом запуске для ознакомления, больше его показывать не нужно»).
 */
export function wipeModeStores(profileId: string, mode: RaidMode, at?: string) {
  clearTraderLevels(mode)
  // Local only: the server's list goes with the reset route of the account it was made under (never an empty list pushed
  // to whichever account signs in next).
  saveCollected(mode, [], { fromServer: true })
  writeHideoutFound(profileId, mode, new Map(), { fromServer: true })
  clearHideoutDirty(profileId, mode)
  for (const store of [questFoundStore, stashSeenStore]) {
    store.write(profileId, mode, new Map(), { fromServer: true })
    store.clearDirty(profileId, mode)
  }
  const time = at ? Date.parse(at) : NaN
  clearDeferredQuests(profileId, mode, Number.isNaN(time) ? undefined : time)
  clearQuestChecks(profileId, mode)
  clearQuestKeyFavorites(profileId, mode)
  try {
    localStorage.removeItem(kappaCongratsKey(profileId, mode))
  } catch { /* storage unavailable */ }
}

/** Called by AppState right after the profile's records of the mode went. */
export function afterModeReset({ profileId, mode, at, reason, floor }: { profileId: string; mode: RaidMode; at: string; reason: ModeResetReason; floor?: string }) {
  wipeModeStores(profileId, mode, at)
  queueModeReset(mode, at, floor)
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
 * журналам» after «Сброс», and after «Престиж +» / «Вайп» that the quests start over.
 */
export function modeResetMessage(reason: ModeResetReason, mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  if (locale === 'en') {
    if (reason === 'nickname') return `Nickname changed — ${name} progress was reset`
    if (reason === 'rebuild') return `${name} progress found again from the logs`
    return `${reason === 'wipe' ? 'Wipe' : 'Prestige'} — ${name} progress was reset, quests start over`
  }
  if (reason === 'nickname') return `Ник изменился — прогресс режима ${name} сброшен`
  if (reason === 'rebuild') return `Прогресс режима ${name} найден заново по журналам`
  return `${reason === 'wipe' ? 'Вайп' : 'Престиж'} — прогресс режима ${name} сброшен, квесты начнутся заново`
}

/** What a press clears besides the progress (owner, 04.11.2026), said before it is pressed. */
const CLEARED_RU = 'Также очистятся избранное (оно общее для всех режимов), отслеживаемые квесты, список на рейд и отложенные квесты. Прогресс других режимов не изменится.'
const CLEARED_EN = 'Favourites (shared by all modes), tracked quests, the raid list and deferred quests are cleared too. Progress of other modes will not change.'

/**
 * The texts of the one button «Вайп / Престиж», RU and EN (owner, 04.11.2026: «Сделай Вайп Престиж не отдельными кнопками, а
 * одной, просто через дробь»): the player starts over, the old logs no longer count. A game wipe keeps the prestige (BSG,
 * patch 0.16.0.0: «Prestige levels and rewards do not reset with wipes»), so the window asks which of the two it was.
 */
export function wipePrestigeText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Wipe / Prestige', title: 'Wipe / Prestige', question: `${name}: all progress of this mode will be deleted and you start over. Old game logs no longer count: quests appear as you take them in the game. ${CLEARED_EN}`, choose: 'A wipe, or your new prestige?', chooseMode: 'Which mode?', wipe: 'Wipe', wipeNote: 'prestige stays', back: 'Back', confirm: 'Reset', cancel: 'Cancel', close: 'Close' }
    : { button: 'Вайп / Престиж', title: 'Вайп / Престиж', question: `Режим ${name}: весь прогресс этого режима будет удалён, и вы начнёте заново. Старые журналы игры больше не учитываются: квесты появятся, когда вы возьмёте их в игре. ${CLEARED_RU}`, choose: 'Вайп или ваш новый престиж?', chooseMode: 'В каком режиме?', wipe: 'Вайп', wipeNote: 'престиж останется', back: 'Назад', confirm: 'Сбросить', cancel: 'Отмена', close: 'Закрыть' }
}

/** The confirm text of «Сброс» (owner, 15.10.2026: «сделай эту в отдельную кнопку сброс»): rebuild from every log at once. */
export function rebuildResetText(mode: RaidMode, locale: 'ru' | 'en') {
  const name = modeResetName(mode, locale)
  return locale === 'en'
    ? { button: 'Reset', title: 'Reset', question: `Reset of ${name}: this mode's progress will be deleted and found again at once from all game logs. Use it if quests are shown wrong. ${CLEARED_EN}`, confirm: 'Reset and find again', cancel: 'Cancel', close: 'Close' }
    : { button: 'Сброс', title: 'Сброс', question: `Сброс режима ${name}: прогресс этого режима будет удалён и сразу найден заново по всем журналам игры. Используйте, если квесты отображаются неправильно. ${CLEARED_RU}`, confirm: 'Сбросить и найти заново', cancel: 'Отмена', close: 'Закрыть' }
}

/** «Ожидаем престиж в журналах игры…» under the buttons while a marker is pending (src/domain/types.ts resetMarker). */
export function pendingMarkerText(kind: 'prestige' | 'wipe' | 'nickname', locale: 'ru' | 'en') {
  if (locale === 'en') return `Waiting for the ${kind === 'prestige' ? 'prestige' : kind === 'wipe' ? 'wipe' : 'new profile'} in the game logs: the quests before it still count.`
  return `Ожидаем ${kind === 'prestige' ? 'престиж' : kind === 'wipe' ? 'вайп' : 'новый профиль'} в журналах игры: квесты до него пока учитываются.`
}
