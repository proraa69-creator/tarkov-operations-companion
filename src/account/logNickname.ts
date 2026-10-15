/**
 * The Escape from Tarkov nickname and the character's level, without making the player wait or type (owner, 13.10.2026):
 * - Tarkov.dev is asked in any case, in the background, from the player's own computer and never through our server
 *   (Cloudflare refuses it there): the profile of each mode's game account from the logs, again after 2, 5, 10, 30
 *   minutes and then every hour until it has one, and a found one every 10 minutes;
 * - the game's «Выбор профиля и режима» screen, read when the game starts (src/import/modeSelectScreen.ts), corrects the
 *   nickname and every mode's level at once. The newer data wins, Tarkov.dev first on a tie (src/domain/progress.ts);
 * - typing the nickname («Указать вручную», «Сменить ник») stays as the last resort.
 * One nickname for PvP, PvE and «Сезон»; each mode is bound to its own game account from the logs.
 */
import { useSyncExternalStore } from 'react'
import type { ModeLogScanResult } from '../import/eftLogTimeline'
import type { ModeSelectCard, TraderScreenReading } from '../import/modeSelectScreen'
import { foldNickname, screenNickname } from '../import/modeSelectScreen'
import type { LocalProfile, PlayerProfileSnapshot, RaidMode } from '../domain/types'
import { canResolvePlayerProfiles, desktopPlayerProfileGateway } from '../profile/playerProfileGateway'
import { saveScreenTraderLevels } from '../gunsmith/traderLevels'
import { currentServerStatus } from '../sync/serverSync'
import { accountNickname, cleanNickname, NICKNAME_PATTERN, profileNickname, RAID_MODE_ORDER, renameBoundModes, saveNicknameOnServer } from './nicknameBinding'
import { noteConfirmedNickname, type NicknameSource } from './nicknameChange'

/** The app state (read when needed, so a fresh one). */
export interface LogNicknameTarget {
  activeProfile: LocalProfile
  registerModeProfile: (mode: RaidMode, registration: { accountId: number; enteredNickname: string; nickname: string; verifiedAt: string }) => void
  updatePlayerSnapshot: (mode: RaidMode, snapshot: PlayerProfileSnapshot) => void
  applyScreenLevel: (mode: RaidMode, level: number, observedAt: string, raiseOnly?: boolean) => void
  /** The mode the app shows (the mode a nickname change resets when the game's own is not known). */
  raidMode?: RaidMode
  /** A confirmed new nickname resets the mode it was seen in (src/account/nicknameChange.ts, src/state/modeReset.ts). */
  resetModeProgress?: (mode: RaidMode, at?: string, reason?: 'prestige' | 'nickname') => void
}

/**
 * A confirmed nickname: when it is a new one by the rules of src/account/nicknameChange.ts, the mode the game is in
 * (`gameMode`, from the logs; else the app's) starts again. Other modes keep their progress; the nickname itself goes to
 * every mode and the account as before. True when the mode was reset.
 */
function checkNicknameChange(nickname: string, source: NicknameSource, observedAt: number, gameMode: RaidMode | undefined, state: () => LogNicknameTarget) {
  const target = state()
  const mode = gameMode ?? target.raidMode ?? target.activeProfile.selectedMode
  const change = noteConfirmedNickname(nickname, source, observedAt, mode, target.activeProfile)
  if (!change || !target.resetModeProgress) return false
  target.resetModeProgress(change.mode, change.at, 'nickname')
  return true
}

/** Minutes between the background lookups of a profile Tarkov.dev does not have yet (the last one repeats). */
export const RETRY_MINUTES = [2, 5, 10, 30, 60]
/** A found profile is asked for again this often (the main process keeps it for as long: electron/ownProfileLookup.ts). */
export const REFRESH_MS = 10 * 60_000

/** Each mode's Tarkov.dev lookup, shown in Settings → «Журналы игры». */
export type CharacterLookup =
  | { state: 'searching' }
  | { state: 'found'; level: number }
  | { state: 'waiting'; next: number; tries: number }

/** The last mode selection screen read in this session. */
export interface ScreenReading { at: number; cards: ModeSelectCard[]; nickname: string | null }

/** The game account of each mode the logs of this PC showed last. */
let accounts: Partial<Record<RaidMode, number>> = {}
let lookups: Partial<Record<RaidMode, CharacterLookup>> = {}
let screen: ScreenReading | null = null
const timers = new Map<RaidMode, ReturnType<typeof setTimeout>>()
let typed: string | undefined
/** The newest nickname seen (Tarkov.dev's or the game screen's): the latest one wins, Tarkov.dev's on a tie. */
let best: { nickname: string; updatedAt: string } | undefined
const listeners = new Set<() => void>()
let version = 0
const notify = () => { version += 1; for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The nickname found or typed in this session (AccountController saves it on an account signed in later). */
export function logNickname() {
  return best?.nickname ?? typed
}

/** The same, for the pages (useAccountNickname). */
export function useLogNickname() {
  useSyncExternalStore(subscribe, () => version)
  return logNickname()
}

/** The game accounts of the logs, by mode (the nickname form). */
export function useLogAccounts() {
  return useSyncExternalStore(subscribe, () => accounts)
}

/** The background Tarkov.dev lookups, by mode. */
export function useCharacterLookups() {
  return useSyncExternalStore(subscribe, () => lookups)
}

/** The last mode selection screen read in this session (the first-launch notice). */
export function useScreenReading() {
  return useSyncExternalStore(subscribe, () => screen)
}

function setLookup(mode: RaidMode, lookup: CharacterLookup | undefined) {
  lookups = { ...lookups, [mode]: lookup }
  notify()
}

/** The nickname this app knows: the newest found, typed now, the signed-in account's, or a bound mode's. */
function knownNickname(profile: LocalProfile) {
  return best?.nickname ?? typed ?? accountNickname(currentServerStatus()?.nicknames) ?? profileNickname(profile)
}

/** Binds each mode the logs show to its game account under `nickname` (unless it is bound so already). */
function bindModes(state: () => LogNicknameTarget, nickname: string, verifiedAt: string) {
  for (const mode of RAID_MODE_ORDER) {
    const accountId = accounts[mode]
    if (!accountId) continue
    const registration = state().activeProfile.modes[mode].registration
    if (registration.status === 'registered' && registration.accountId === accountId && (registration.enteredNickname || registration.nickname) === nickname) continue
    state().registerModeProfile(mode, { accountId, enteredNickname: nickname, nickname, verifiedAt })
  }
}

/** Saves `nickname` on the signed-in account unless it has it already. */
function saveOnAccount(nickname: string) {
  const status = currentServerStatus()
  if (status?.signedIn && (accountNickname(status.nicknames) ?? '') !== nickname) return saveNicknameOnServer(nickname)
  return Promise.resolve(false)
}

/** `nickname` is the one now: every mode of the logs and every bound mode get it, and the signed-in account. */
function spreadNickname(state: () => LogNicknameTarget, nickname: string) {
  const verifiedAt = new Date().toISOString()
  bindModes(state, nickname, verifiedAt)
  renameBoundModes(state(), nickname, RAID_MODE_ORDER.filter((mode) => accounts[mode]), verifiedAt)
  void saveOnAccount(nickname)
}

/**
 * A profile Tarkov.dev captured before the player's last rename (owner, 13.10.2026: «я уже давно поменял ник, а справа
 * пишется мой старый… данные должны обновляться»): its name is not the one the app knows now, and it is not newer than
 * the reading that gave that name. Such a profile is not used at all — not its name, not its level — and is asked for
 * again later, until Tarkov.dev has the current one.
 */
export function outdatedProfile(snapshot: Pick<PlayerProfileSnapshot, 'nickname' | 'upstreamUpdatedAt' | 'fetchedAt'>, known: string | undefined, knownAt?: string) {
  if (!known || foldNickname(known) === foldNickname(snapshot.nickname)) return false
  // A newer Tarkov.dev profile with another name: the player renamed after the app's last reading.
  if (knownAt && (snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt) > knownAt) return false
  return true
}

/** A profile Tarkov.dev gave: the mode's snapshot (its level unless the game showed a newer one), and its name if newest. */
function adopt(mode: RaidMode, accountId: number, snapshot: PlayerProfileSnapshot, state: () => LogNicknameTarget) {
  const updatedAt = snapshot.upstreamUpdatedAt ?? snapshot.fetchedAt
  if (!best || updatedAt >= best.updatedAt) best = { nickname: snapshot.nickname, updatedAt }
  const nickname = best.nickname
  state().registerModeProfile(mode, { accountId, enteredNickname: nickname, nickname: snapshot.nickname, verifiedAt: new Date().toISOString() })
  state().updatePlayerSnapshot(mode, snapshot)
  spreadNickname(state, nickname)
  notify()
}

/**
 * One background lookup of a mode's profile. Tarkov.dev has none: the next one is scheduled (RETRY_MINUTES); it has one:
 * it is applied and asked for again in REFRESH_MS. `force` runs it before its time (a new nickname, a refresh).
 */
async function lookUp(mode: RaidMode, accountId: number, state: () => LogNicknameTarget, force = false) {
  const current = lookups[mode]
  if (current?.state === 'searching') return
  if (!force && current?.state === 'found') return
  if (!force && current?.state === 'waiting' && Date.now() < current.next) return
  clearTimeout(timers.get(mode))
  const tries = current?.state === 'waiting' ? current.tries : 0
  // A refresh of a found profile keeps «found» on the screen while it runs.
  if (current?.state !== 'found') setLookup(mode, { state: 'searching' })
  const snapshot = await desktopPlayerProfileGateway().fetchByAccountId(mode, accountId).catch(() => null)
  // The logs moved on to another game account meanwhile: that one has its own lookup.
  if (accounts[mode] !== accountId) return
  const again = (ms: number) => timers.set(mode, setTimeout(() => void lookUp(mode, accountId, state, true), ms))
  // A profile from before the last rename counts as none yet: asked for again on the same schedule.
  const outdated = snapshot?.nickname ? outdatedProfile(snapshot, knownNickname(state().activeProfile), best?.updatedAt) : false
  if (snapshot?.nickname && !outdated) {
    setLookup(mode, { state: 'found', level: snapshot.level })
    adopt(mode, accountId, snapshot, state)
    again(REFRESH_MS)
    return
  }
  if (current?.state === 'found' && !outdated) { again(REFRESH_MS); return }
  const minutes = RETRY_MINUTES[Math.min(tries, RETRY_MINUTES.length - 1)]!
  setLookup(mode, { state: 'waiting', next: Date.now() + minutes * 60_000, tries: tries + 1 })
  again(minutes * 60_000)
}

/** Starts the background lookups the logs' accounts need (the desktop app only: the phone would ask our server). */
function startLookups(state: () => LogNicknameTarget, force = false) {
  if (!canResolvePlayerProfiles()) return
  for (const mode of RAID_MODE_ORDER) {
    const accountId = accounts[mode]
    if (accountId) void lookUp(mode, accountId, state, force && lookups[mode]?.state !== 'found')
  }
}

/**
 * Called with every log scan (AppShell): remembers each mode's game account, binds the modes to their accounts under the
 * known nickname and starts (or keeps) the background Tarkov.dev lookups. Returns that nickname, or null while none is
 * known yet.
 */
export function bindNicknameFromLogs(result: Pick<ModeLogScanResult, 'latestAccountIdByMode'>, state: () => LogNicknameTarget) {
  const next = { ...accounts, ...Object.fromEntries(Object.entries(result.latestAccountIdByMode ?? {}).filter(([, id]) => typeof id === 'number' && id > 0)) }
  const changed = RAID_MODE_ORDER.filter((mode) => next[mode] !== accounts[mode])
  if (changed.length) {
    accounts = next
    for (const mode of changed) {
      clearTimeout(timers.get(mode))
      lookups = { ...lookups, [mode]: undefined }
    }
    notify()
  }
  const nickname = knownNickname(state().activeProfile)
  if (nickname) bindModes(state, nickname, new Date().toISOString())
  startLookups(state)
  return nickname ?? null
}

/**
 * The game's «Выбор профиля и режима» cards (an OCR reading and the digits' shapes agreed on each level,
 * electron/screenOcr.ts): every mode's level at once, and the nickname when all the cards that read one show the same.
 * The spelling the app knows stays when the screen shows the same name; another name replaces it (the player renamed
 * the character, or typed it wrong).
 */
export function applyModeSelectScreen(cards: ModeSelectCard[], observedAt: number, state: () => LogNicknameTarget, gameMode?: RaidMode) {
  if (!cards.length) return
  const at = new Date(observedAt).toISOString()
  const nickname = screenNickname(cards, knownNickname(state().activeProfile))
  // A new nickname (seen again on a later reading) resets the game's mode first: the levels of this reading then count.
  const reset = nickname ? checkNicknameChange(nickname, 'screen', observedAt, gameMode, state) : false
  const same = !reset && screen && observedAt - screen.at < 10 * 60_000 && screen.nickname === nickname
    && screen.cards.length === cards.length && cards.every((card) => screen!.cards.some((seen) => seen.mode === card.mode && seen.level === card.level))
  // The same screen read again a second later: nothing new.
  if (same) return
  // A card may give its nickname without a confirmed level (src/import/modeSelectScreen.ts confirmCards).
  for (const card of cards) if (card.level !== undefined) state().applyScreenLevel(card.mode, card.level, at)
  if (nickname) {
    if (!best || at > best.updatedAt) best = { nickname, updatedAt: at }
    spreadNickname(state, best.nickname)
  }
  screen = { at: observedAt, cards, nickname }
  notify()
  // A name Tarkov.dev did not know a moment ago may be there now: ask again (the main process keeps found ones).
  startLookups(state, true)
}

/**
 * Readings of the game's screens taken while the app was locked — the sign-in and subscription screens (audit P4a; #202
 * «персонаж должен находиться сразу при первом запуске»): a game started before the sign-in shows «Выбор профиля и
 * режима» only then. Kept here, the newest of each screen, and applied when the app unlocks (applyKeptIdentity).
 */
let kept: { modeSelect?: { cards: ModeSelectCard[]; observedAt: number }; trader?: { reading: TraderScreenReading; mode?: RaidMode; observedAt: number } } = {}

/** The mode selection screen read while the app is locked: kept until it unlocks. */
export function keepModeSelectScreen(cards: ModeSelectCard[], observedAt: number) {
  if (cards.length && (!kept.modeSelect || observedAt >= kept.modeSelect.observedAt)) kept = { ...kept, modeSelect: { cards, observedAt } }
}

/** The traders' screen read while the app is locked, with the game's mode the logs named then (if any): kept until it unlocks. */
export function keepTraderScreen(reading: TraderScreenReading, mode: RaidMode | undefined, observedAt: number) {
  if (!kept.trader || observedAt >= kept.trader.observedAt) kept = { ...kept, trader: { reading, mode, observedAt } }
}

/**
 * The app is unlocked: what was read before is applied now, as if just read — at its own time, so newer data still wins
 * (src/domain/progress.ts). A traders' reading whose mode was not known then gives its nickname only.
 */
export function applyKeptIdentity(state: () => LogNicknameTarget, gameMode?: RaidMode) {
  const { modeSelect, trader } = kept
  kept = {}
  if (modeSelect) applyModeSelectScreen(modeSelect.cards, modeSelect.observedAt, state, gameMode)
  if (trader) applyTraderScreen(trader.reading, trader.mode, trader.observedAt, state)
}

/** The last traders' screen applied: the same reading a second later is nothing new. */
let lastTrader: { at: number; key: string } | null = null

/**
 * The traders' screen (two readings agreed, electron/screenOcr.ts): the level of the mode the game is in now (`mode`, from
 * the logs; nothing without it) — raised only, it does not name its mode, and only as far as play since the last reading
 * allows (src/domain/progress.ts) — the player's nickname marked «(вы)» and the traders' loyalty levels.
 */
export function applyTraderScreen(reading: TraderScreenReading, mode: RaidMode | undefined, observedAt: number, state: () => LogNicknameTarget) {
  // The traders' loyalty levels of the mode the game is in (the badges on the portraits): the game's own, kept for this
  // mode's character (the logs' profile id) with their time (audit P18) — proof of at least those levels, not a permanent
  // override, and never handed to another character after a wipe (src/gunsmith/traderLevels.ts).
  if (mode && reading.loyalty) {
    saveScreenTraderLevels(mode, state().activeProfile.modes[mode]?.logCharacterId, reading.loyalty, new Date(observedAt).toISOString())
  }
  const key = `${mode ?? ''}:${reading.level ?? ''}:${reading.nickname ?? ''}`
  if (lastTrader && lastTrader.key === key && observedAt - lastTrader.at < 10 * 60_000) return
  lastTrader = { at: observedAt, key }
  const at = new Date(observedAt).toISOString()
  if (reading.level && mode) state().applyScreenLevel(mode, reading.level, at, true)
  const nickname = reading.nickname ? screenNickname([{ nickname: reading.nickname }], knownNickname(state().activeProfile)) : null
  if (nickname) {
    if (!best || at > best.updatedAt) best = { nickname, updatedAt: at }
    spreadNickname(state, best.nickname)
    notify()
  }
}

/**
 * «Указать вручную» / «Сменить ник»: checked like the game's (3–15 Latin letters, digits, «_» or «-»), saved at once —
 * bound to the logs' game accounts, given to every other bound mode, saved on the signed-in account — and the background
 * lookups are asked to try once more now. Tarkov.dev's or the game screen's nickname, found later, replaces it.
 */
export async function setTypedNickname(raw: string, state: () => LogNicknameTarget) {
  const nickname = cleanNickname(raw)
  if (!NICKNAME_PATTERN.test(nickname)) throw new Error('Ник в игре: 3–15 символов, латиница, цифры, «_» или «-».')
  const now = Date.now()
  const verifiedAt = new Date(now).toISOString()
  // Another nickname than the confirmed one: the mode the app shows starts again (src/account/nicknameChange.ts).
  checkNicknameChange(nickname, 'typed', now, undefined, state)
  typed = nickname
  best = undefined
  bindModes(state, nickname, verifiedAt)
  renameBoundModes(state(), nickname, RAID_MODE_ORDER.filter((mode) => accounts[mode]), verifiedAt)
  notify()
  startLookups(state, true)
  await saveOnAccount(nickname)
  return nickname
}
