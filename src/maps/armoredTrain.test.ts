import { afterEach, describe, expect, it } from 'vitest'
import {
  ARMORED_TRAINS, pmcRaidBegun, setArmoredTrainNoticeOn, takeTrainArrival, trainClock, trainMinutes, trainView,
  trainSchedule, trainStay, trainState,
} from './armoredTrain'
import { setRenderLanguage } from '../i18n/renderText'
import type { RaidState } from '../import/raidState'

afterEach(() => {
  setArmoredTrainNoticeOn(false)
  try { localStorage.clear() } catch { /* storage unavailable */ }
  setRenderLanguage('ru')
})

describe('the armored train timings (SPT location files, EXFIL_Train)', () => {
  it('comes 90 s after the exit activates and stands the owner\'s time (Reserve 6:30, Lighthouse 5:00)', () => {
    expect(ARMORED_TRAINS.reserve).toEqual({ arriveMin: 1540, arriveMax: 1790, stay: 390 })
    expect(ARMORED_TRAINS.lighthouse).toEqual({ arriveMin: 1390, arriveMax: 1510, stay: 300 })
  })

  it('is known by the game\'s and the app\'s map names, and only on Reserve and Lighthouse', () => {
    expect(trainSchedule('RezervBase')).toBe(ARMORED_TRAINS.reserve)
    expect(trainSchedule('reserve')).toBe(ARMORED_TRAINS.reserve)
    expect(trainSchedule('Lighthouse')).toBe(ARMORED_TRAINS.lighthouse)
    expect(trainSchedule('customs')).toBeUndefined()
    expect(trainSchedule(undefined)).toBeUndefined()
  })
})

// Owner, 25.11.2026: in a raid only the countdown to the arrival, then nothing — no «standing», «leaving» or «gone».
describe('trainState', () => {
  const train = ARMORED_TRAINS.reserve
  it('is coming, then arriving, then past', () => {
    expect(trainState(train, 0)).toEqual({ phase: 'coming', from: 1540, to: 1790 })
    expect(trainState(train, 600)).toEqual({ phase: 'coming', from: 940, to: 1190 })
    expect(trainState(train, 1600)).toEqual({ phase: 'arriving', to: 190 })
    expect(trainState(train, 1790)).toEqual({ phase: 'past' })
    expect(trainState(train, 3000)).toEqual({ phase: 'past' })
  })
})

describe('the texts', () => {
  it('counts down m:ss and rounds whole minutes', () => {
    expect(trainClock(1540)).toBe('25:40')
    expect(trainClock(0.2)).toBe('0:01')
    expect(trainClock(-3)).toBe('0:00')
    expect(trainMinutes(1540)).toBe(26)
    expect(trainMinutes(300)).toBe(5)
  })

  it('says how long the train stands: «6 мин 30 с», «5 мин» (RU and EN)', () => {
    expect(trainStay(390)).toBe('6 мин 30 с')
    expect(trainStay(300)).toBe('5 мин')
    setRenderLanguage('en')
    expect(trainStay(390)).toBe('6 min 30 s')
    expect(trainStay(300)).toBe('5 min')
  })

  it('out of a raid: the icon shows no text, the hint says when it comes and how long it stands', () => {
    expect(trainView(ARMORED_TRAINS.reserve, undefined)).toEqual({
      value: '', hint: 'Прибывает через 26–30 мин после начала рейда, стоит 6 мин 30 с', live: false, arriving: false,
    })
    expect(trainView(ARMORED_TRAINS.lighthouse, undefined)).toEqual({
      value: '', hint: 'Прибывает через 23–25 мин после начала рейда, стоит 5 мин', live: false, arriving: false,
    })
  })

  it('in a PMC raid: the live countdown, then «возможно, приехал», then the icon goes', () => {
    expect(trainView(ARMORED_TRAINS.reserve, 600)).toEqual({ value: '15:40', hint: 'Бронепоезд прибудет через 15:40–19:50', live: true, arriving: false })
    expect(trainView(ARMORED_TRAINS.reserve, 1600)).toEqual({ value: 'возможно, приехал', hint: 'Бронепоезд прибудет в ближайшие 3:10', live: true, arriving: true })
    expect(trainView(ARMORED_TRAINS.reserve, 1790)).toBeUndefined()
    expect(trainView(ARMORED_TRAINS.reserve, 3000)).toBeUndefined()
  })

  it('reads in English', () => {
    setRenderLanguage('en')
    expect(trainView(ARMORED_TRAINS.reserve, undefined)).toEqual({ value: '', hint: 'Arrives 26–30 min after the raid starts, stays 6 min 30 s', live: false, arriving: false })
    expect(trainView(ARMORED_TRAINS.lighthouse, undefined)).toEqual({ value: '', hint: 'Arrives 23–25 min after the raid starts, stays 5 min', live: false, arriving: false })
    expect(trainView(ARMORED_TRAINS.reserve, 600)).toEqual({ value: '15:40', hint: 'Armored train in 15:40–19:50', live: true, arriving: false })
    expect(trainView(ARMORED_TRAINS.reserve, 1600)).toEqual({ value: 'may have arrived', hint: 'Armored train within 3:10', live: true, arriving: true })
    expect(trainView(ARMORED_TRAINS.reserve, 1790)).toBeUndefined()
  })
})

// Owner, 25.11.2026: a Scav joins a raid already running, so the live countdown from the raid's start is for a PMC only.
describe('pmcRaidBegun', () => {
  const begun = Date.parse('2026-11-25T12:00:00')
  const now = begun + 10 * 60 * 1000
  const pmc: RaidState = { inRaid: true, since: begun - 60_000, begun, location: 'RezervBase', side: 'pmc' }

  it('gives the raid\'s start for a PMC\'s raid on a train map', () => {
    expect(pmcRaidBegun(pmc, 'reserve', now)).toBe(begun)
    expect(pmcRaidBegun(pmc, undefined, now)).toBe(begun)
  })

  it('gives nothing for a Scav\'s raid or one whose side the logs do not tell', () => {
    expect(pmcRaidBegun({ ...pmc, side: 'savage' }, 'reserve', now)).toBeUndefined()
    expect(pmcRaidBegun({ ...pmc, side: undefined }, 'reserve', now)).toBeUndefined()
    expect(pmcRaidBegun({ ...pmc, side: undefined }, undefined, now)).toBeUndefined()
  })

  it('gives nothing off this map, with no start line, or for a stale raid', () => {
    expect(pmcRaidBegun({ ...pmc, location: 'Lighthouse' }, 'reserve', now)).toBeUndefined()
    expect(pmcRaidBegun({ ...pmc, location: 'customs' }, undefined, now)).toBeUndefined()
    expect(pmcRaidBegun({ ...pmc, begun: undefined }, 'reserve', now)).toBeUndefined()
    expect(pmcRaidBegun(pmc, 'reserve', begun + 3 * 60 * 60 * 1000)).toBeUndefined()
    expect(pmcRaidBegun(null, 'reserve', now)).toBeUndefined()
  })
})

// Owner, 25.11.2026: with «Уведомления о прибытии» on, a PMC gets the card when the arrival window opens — once per raid.
describe('takeTrainArrival', () => {
  const train = ARMORED_TRAINS.reserve
  const begun = Date.parse('2026-11-25T12:00:00')
  const inWindow = begun + (train.arriveMin + 10) * 1000

  it('says nothing while «Уведомления о прибытии» is off', () => {
    expect(takeTrainArrival(begun, train, inWindow)).toBe(false)
  })

  it('fires once inside the arrival window, not again for the same raid', () => {
    setArmoredTrainNoticeOn(true)
    expect(takeTrainArrival(begun, train, inWindow)).toBe(true)
    expect(takeTrainArrival(begun, train, inWindow)).toBe(false)
  })

  it('does not fire before the window opens or after it closes', () => {
    setArmoredTrainNoticeOn(true)
    expect(takeTrainArrival(begun, train, begun + (train.arriveMin - 10) * 1000)).toBe(false)
    expect(takeTrainArrival(begun, train, begun + (train.arriveMax + 10) * 1000)).toBe(false)
  })
})
