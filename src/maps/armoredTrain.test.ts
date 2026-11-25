import { describe, expect, it } from 'vitest'
import { ARMORED_TRAINS, trainClock, trainLine, trainMinutes, trainSchedule, trainState } from './armoredTrain'
import { setRenderLanguage } from '../i18n/renderText'

describe('the armored train timings (SPT location files, EXFIL_Train)', () => {
  it('stands at the platform 90 s after the exit activates and stays Count + ExfiltrationTime', () => {
    expect(ARMORED_TRAINS.reserve).toEqual({ arriveMin: 1540, arriveMax: 1790, stay: 405 })
    expect(ARMORED_TRAINS.lighthouse).toEqual({ arriveMin: 1390, arriveMax: 1510, stay: 305 })
  })

  it('is known by the game\'s and the app\'s map names, and only on Reserve and Lighthouse', () => {
    expect(trainSchedule('RezervBase')).toBe(ARMORED_TRAINS.reserve)
    expect(trainSchedule('reserve')).toBe(ARMORED_TRAINS.reserve)
    expect(trainSchedule('Lighthouse')).toBe(ARMORED_TRAINS.lighthouse)
    expect(trainSchedule('customs')).toBeUndefined()
    expect(trainSchedule(undefined)).toBeUndefined()
  })
})

describe('trainState', () => {
  const train = ARMORED_TRAINS.reserve
  it('follows the train through the raid', () => {
    expect(trainState(train, 0)).toEqual({ phase: 'coming', from: 1540, to: 1790 })
    expect(trainState(train, 1600)).toEqual({ phase: 'arriving', to: 190 })
    expect(trainState(train, 1800)).toEqual({ phase: 'standing', from: 145, to: 395 })
    expect(trainState(train, 2000)).toEqual({ phase: 'leaving', to: 195 })
    expect(trainState(train, 2195)).toEqual({ phase: 'gone' })
  })
})

describe('the texts', () => {
  it('counts down m:ss and rounds whole minutes', () => {
    expect(trainClock(1540)).toBe('25:40')
    expect(trainClock(0.2)).toBe('0:01')
    expect(trainClock(-3)).toBe('0:00')
    expect(trainMinutes(1540)).toBe(26)
    expect(trainMinutes(305)).toBe(5)
  })

  it('says the times from the raid start out of a raid, and a countdown in one', () => {
    expect(trainLine(ARMORED_TRAINS.reserve, undefined)).toBe('Бронепоезд прибывает через 26–30\u00a0мин после начала рейда, стоит 7\u00a0мин')
    expect(trainLine(ARMORED_TRAINS.lighthouse, undefined)).toBe('Бронепоезд прибывает через 23–25\u00a0мин после начала рейда, стоит 5\u00a0мин')
    expect(trainLine(ARMORED_TRAINS.reserve, 600)).toBe('Бронепоезд прибудет через 15:40–19:50')
    expect(trainLine(ARMORED_TRAINS.reserve, 1800)).toBe('Бронепоезд стоит ещё 2:25–6:35')
    expect(trainLine(ARMORED_TRAINS.reserve, 3000)).toBe('Бронепоезд уехал')
  })

  it('reads in English', () => {
    setRenderLanguage('en')
    try {
      expect(trainLine(ARMORED_TRAINS.reserve, undefined)).toBe('The armored train comes 26–30\u00a0min after the raid starts, stays 7\u00a0min')
      expect(trainLine(ARMORED_TRAINS.reserve, 600)).toBe('Armored train in 15:40–19:50')
      expect(trainLine(ARMORED_TRAINS.reserve, 1600)).toBe('Armored train within 3:10')
      expect(trainLine(ARMORED_TRAINS.reserve, 1800)).toBe('Armored train leaves in 2:25–6:35')
      expect(trainLine(ARMORED_TRAINS.reserve, 2000)).toBe('Armored train leaves within 3:15')
      expect(trainLine(ARMORED_TRAINS.reserve, 3000)).toBe('The armored train has left')
    } finally {
      setRenderLanguage('ru')
    }
  })
})
