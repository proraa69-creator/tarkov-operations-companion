import { useSyncExternalStore } from 'react'
import { canonicalMapId } from '../data/mapIds'
import { uiText } from '../i18n/renderText'
import type { RaidState } from '../import/raidState'
import { raidRunning } from '../app/useRaidState'

/**
 * «Таймер бронепоезда» (player report 231, owner 25.11.2026: «На картах, где есть бронепоезд (Резерв и Маяк), укажи время прибытия
 * бронепоезда. В настройках карты сделай настройку „Таймер бронепоезда“»).
 *
 * The arrival is the game's own, read from the offline SPT copy's location files (SPT_Data/database/locations/<map>/base.json,
 * exit `EXFIL_Train`, the same numbers for PvP and PvE):
 *  - Reserve (rezervbase): MinTime 1450, MaxTime 1700;
 *  - Lighthouse (lighthouse): MinTime 1300, MaxTime 1420.
 * MinTime…MaxTime is when the exit activates (a random second in that window, counted from the raid's start); the train can be
 * boarded about 90 s later (SPT configs/location.json `trainArrivalDelayObservedSeconds`, measured by the SPT team: 88 s + 2).
 * How long it stands is the owner's (25.11.2026): Reserve 6 min 30 s, Lighthouse 5 min.
 * A Scav who joins a raid late gets these times moved earlier by the server: no countdown for a Scav (owner, 25.11.2026).
 */
export interface TrainSchedule {
  /** Seconds after the raid's start: the earliest and the latest the train comes to the platform. */
  arriveMin: number
  arriveMax: number
  /** Seconds it stands there. */
  stay: number
}

const ARRIVAL_DELAY = 90
const schedule = (minTime: number, maxTime: number, stay: number): TrainSchedule =>
  ({ arriveMin: minTime + ARRIVAL_DELAY, arriveMax: maxTime + ARRIVAL_DELAY, stay })

export const ARMORED_TRAINS: Readonly<Record<string, TrainSchedule>> = {
  reserve: schedule(1450, 1700, 6 * 60 + 30),
  lighthouse: schedule(1300, 1420, 5 * 60),
}

/** The train of a map (any of the game's or the app's names for it), or undefined where there is none. */
export function trainSchedule(mapId: string | undefined): TrainSchedule | undefined {
  return mapId ? ARMORED_TRAINS[canonicalMapId(mapId)] : undefined
}

/**
 * Where the train is `elapsed` seconds into the raid. The arrival is random within its window, so `from`…`to` are seconds from now:
 *  - coming: not before `from`, not after `to`;
 *  - arriving: it may be there already, at the latest in `to`;
 *  - past: its arrival window is over (owner, 25.11.2026: in a raid only the countdown to the arrival, then nothing).
 */
export type TrainState =
  | { phase: 'coming'; from: number; to: number }
  | { phase: 'arriving'; to: number }
  | { phase: 'past' }

export function trainState(train: TrainSchedule, elapsed: number): TrainState {
  if (elapsed < train.arriveMin) return { phase: 'coming', from: train.arriveMin - elapsed, to: train.arriveMax - elapsed }
  if (elapsed < train.arriveMax) return { phase: 'arriving', to: train.arriveMax - elapsed }
  return { phase: 'past' }
}

/** `m:ss`, whole seconds rounded up (a countdown never shows 0:00 while time is left). */
export function trainClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Whole minutes, for the line out of a raid. */
export const trainMinutes = (seconds: number) => Math.round(seconds / 60)

/** How long it stands: «6 мин 30 с», «5 мин» (the English by the rule in src/i18n/uiEnglishMap.ts). */
export function trainStay(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return rest ? uiText(`${minutes} мин ${rest} с`) : `${minutes} ${uiText('мин')}`
}

/**
 * What the small train icon shows (ArmoredTrainTimer.tsx, owner 25.11.2026: «просто картинка поезда», no wide plate):
 *  - `hint` — the tooltip on hover;
 *  - `value` — the text beside the icon, empty out of a raid (then only the hint on hover);
 *  - `live` — a PMC's raid is on, the countdown runs;
 *  - `arriving` — the arrival window is open, the icon lights up («возможно, приехал», the first marker the train may be there).
 * Undefined once the arrival window of the raid is over: the icon goes.
 */
export interface TrainView {
  value: string
  hint: string
  live: boolean
  arriving: boolean
}

export function trainView(train: TrainSchedule, elapsed: number | undefined): TrainView | undefined {
  if (elapsed === undefined) {
    const hint = `${uiText('Прибывает через')} ${trainMinutes(train.arriveMin)}–${trainMinutes(train.arriveMax)} ${uiText('мин после начала рейда, стоит')} ${trainStay(train.stay)}`
    return { value: '', hint, live: false, arriving: false }
  }
  const state = trainState(train, elapsed)
  switch (state.phase) {
    case 'coming':
      return { value: trainClock(state.from), hint: `${uiText('Бронепоезд прибудет через')} ${trainClock(state.from)}–${trainClock(state.to)}`, live: true, arriving: false }
    case 'arriving':
      return { value: uiText('возможно, приехал'), hint: `${uiText('Бронепоезд прибудет в ближайшие')} ${trainClock(state.to)}`, live: true, arriving: true }
    case 'past':
      return undefined
  }
}

/**
 * When the PMC raid running now began, for the train's countdown: a raid on `mapId` (any map with a train when none is given)
 * that the logs say is a PMC's (src/import/raidState.ts `side`). A Scav's raid, or one whose side the logs do not tell, has
 * none: a Scav comes into a raid already running (owner, 25.11.2026).
 */
export function pmcRaidBegun(raid: RaidState | null | undefined, mapId: string | undefined, now: number): number | undefined {
  if (!raid?.begun || raid.side !== 'pmc' || !raid.location || !raidRunning(raid, now)) return undefined
  if (mapId ? canonicalMapId(raid.location) !== canonicalMapId(mapId) : !trainSchedule(raid.location)) return undefined
  return raid.begun
}

/** A switch kept on this device, off until turned on. */
function deviceSwitch(key: string) {
  const event = `${key}-changed`
  const read = () => { try { return localStorage.getItem(key) === 'on' } catch { return false } }
  const set = (on: boolean) => {
    try { if (on) localStorage.setItem(key, 'on'); else localStorage.removeItem(key) } catch { /* storage unavailable */ }
    window.dispatchEvent(new Event(event))
  }
  const subscribe = (listener: () => void) => {
    const onStorage = (change: StorageEvent) => { if (change.key === null || change.key === key) listener() }
    window.addEventListener(event, listener)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(event, listener); window.removeEventListener('storage', onStorage) }
  }
  return { read, set, use: () => useSyncExternalStore(subscribe, read, () => false) }
}

/** «Таймер бронепоезда» in «Настройки карты»: the line over the map. */
const timer = deviceSwitch('raidos-map-armored-train-v1')
export const setArmoredTrainOn = timer.set
export const useArmoredTrainOn = timer.use

/** «Уведомления о прибытии» beside it (owner, 25.11.2026): the card and the chime when the arrival window opens. */
const notice = deviceSwitch('raidos-map-armored-train-notice-v1')
export const armoredTrainNoticeOn = notice.read
export const setArmoredTrainNoticeOn = notice.set
export const useArmoredTrainNoticeOn = notice.use

const ANNOUNCED_KEY = 'raidos-armored-train-announced'

/**
 * Whether the arrival of the raid that began at `begun` is to be announced now: inside its arrival window, once per raid (kept on
 * the device, so a restart of the app does not say it again), with the switch on. Marks it announced when it says yes.
 */
export function takeTrainArrival(begun: number, train: TrainSchedule, now = Date.now()): boolean {
  if (!armoredTrainNoticeOn()) return false
  const elapsed = (now - begun) / 1000
  if (elapsed < train.arriveMin || elapsed >= train.arriveMax) return false
  try {
    if (localStorage.getItem(ANNOUNCED_KEY) === String(begun)) return false
    localStorage.setItem(ANNOUNCED_KEY, String(begun))
  } catch { /* storage unavailable: once per mount */ }
  return true
}
