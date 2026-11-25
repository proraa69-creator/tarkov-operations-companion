import { useSyncExternalStore } from 'react'
import { canonicalMapId } from '../data/mapIds'
import { uiText } from '../i18n/renderText'

/**
 * «Таймер бронепоезда» (player report 231, owner 25.11.2026: «На картах, где есть бронепоезд (Резерв и Маяк), укажи время прибытия
 * бронепоезда. В настройках карты сделай настройку „Таймер бронепоезда“»).
 *
 * The timings are the game's own, read from the offline SPT copy's location files (SPT_Data/database/locations/<map>/base.json,
 * exit `EXFIL_Train`, the same numbers for PvP and PvE):
 *  - Reserve (rezervbase): MinTime 1450, MaxTime 1700, Count 400, ExfiltrationTime 5;
 *  - Lighthouse (lighthouse): MinTime 1300, MaxTime 1420, Count 300, ExfiltrationTime 5.
 * MinTime…MaxTime is when the exit activates (a random second in that window, counted from the raid's start); the train can be
 * boarded about 90 s later (SPT configs/location.json `trainArrivalDelayObservedSeconds`, measured by the SPT team: 88 s + 2);
 * it leaves Count + ExfiltrationTime after that (SPT RaidTimeAdjustmentService: earliest departure = MinTime + Count +
 * ExfiltrationTime + the delay). A Scav who joins a raid late gets these times moved earlier by the server: not known here.
 */
export interface TrainSchedule {
  /** Seconds after the raid's start: the earliest and the latest the train stands at the platform. */
  arriveMin: number
  arriveMax: number
  /** Seconds it stands there. */
  stay: number
}

const ARRIVAL_DELAY = 90
const schedule = (minTime: number, maxTime: number, count: number, exfiltrationTime = 5): TrainSchedule =>
  ({ arriveMin: minTime + ARRIVAL_DELAY, arriveMax: maxTime + ARRIVAL_DELAY, stay: count + exfiltrationTime })

export const ARMORED_TRAINS: Readonly<Record<string, TrainSchedule>> = {
  reserve: schedule(1450, 1700, 400),
  lighthouse: schedule(1300, 1420, 300),
}

/** The train of a map (any of the game's or the app's names for it), or undefined where there is none. */
export function trainSchedule(mapId: string | undefined): TrainSchedule | undefined {
  return mapId ? ARMORED_TRAINS[canonicalMapId(mapId)] : undefined
}

/**
 * Where the train is `elapsed` seconds into the raid. The arrival is random within its window, so before it is sure the state
 * says the range: `from`…`to` are seconds from now.
 *  - coming: not before `from`, not after `to`;
 *  - arriving: it may be there already, at the latest in `to`;
 *  - standing: it is there, leaves in `from`…`to`;
 *  - leaving: it may have left already, at the latest in `to`;
 *  - gone.
 */
export type TrainState =
  | { phase: 'coming'; from: number; to: number }
  | { phase: 'arriving'; to: number }
  | { phase: 'standing'; from: number; to: number }
  | { phase: 'leaving'; to: number }
  | { phase: 'gone' }

export function trainState(train: TrainSchedule, elapsed: number): TrainState {
  const leaveMin = train.arriveMin + train.stay
  const leaveMax = train.arriveMax + train.stay
  if (elapsed < train.arriveMin) return { phase: 'coming', from: train.arriveMin - elapsed, to: train.arriveMax - elapsed }
  if (elapsed < train.arriveMax) return { phase: 'arriving', to: train.arriveMax - elapsed }
  if (elapsed < leaveMin) return { phase: 'standing', from: leaveMin - elapsed, to: leaveMax - elapsed }
  if (elapsed < leaveMax) return { phase: 'leaving', to: leaveMax - elapsed }
  return { phase: 'gone' }
}

/** `m:ss`, whole seconds rounded up (a countdown never shows 0:00 while time is left). */
export function trainClock(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Whole minutes, for the line out of a raid. */
export const trainMinutes = (seconds: number) => Math.round(seconds / 60)

/** The line for a raid `elapsed` seconds old; without one, the train's times from the raid's start. */
export function trainLine(train: TrainSchedule, elapsed: number | undefined): string {
  if (elapsed === undefined) {
    return `${uiText('Бронепоезд прибывает через')} ${trainMinutes(train.arriveMin)}–${trainMinutes(train.arriveMax)}\u00a0${uiText('мин после начала рейда, стоит')} ${trainMinutes(train.stay)}\u00a0${uiText('мин')}`
  }
  const state = trainState(train, elapsed)
  switch (state.phase) {
    case 'coming': return `${uiText('Бронепоезд прибудет через')} ${trainClock(state.from)}–${trainClock(state.to)}`
    case 'arriving': return `${uiText('Бронепоезд прибудет в ближайшие')} ${trainClock(state.to)}`
    case 'standing': return `${uiText('Бронепоезд стоит ещё')} ${trainClock(state.from)}–${trainClock(state.to)}`
    case 'leaving': return `${uiText('Бронепоезд уезжает в ближайшие')} ${trainClock(state.to)}`
    case 'gone': return uiText('Бронепоезд уехал')
  }
}

/** The switch in «Настройки карты»: off until turned on, kept on this device. */
const KEY = 'raidos-map-armored-train-v1'
const EVENT = 'raidos-map-armored-train-changed'

const read = () => { try { return localStorage.getItem(KEY) === 'on' } catch { return false } }
export function setArmoredTrainOn(on: boolean) {
  try { if (on) localStorage.setItem(KEY, 'on'); else localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event(EVENT))
}
function subscribe(listener: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === null || event.key === KEY) listener() }
  window.addEventListener(EVENT, listener)
  window.addEventListener('storage', onStorage)
  return () => { window.removeEventListener(EVENT, listener); window.removeEventListener('storage', onStorage) }
}
export const useArmoredTrainOn = () => useSyncExternalStore(subscribe, read, () => false)
