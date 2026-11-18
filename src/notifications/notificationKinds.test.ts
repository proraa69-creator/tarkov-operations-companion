import { beforeEach, describe, expect, it } from 'vitest'
import { notificationOn, readNotificationKinds, setNotificationOn } from './notificationKinds'

describe('«Уведомления» → «Настроить» (owner, 18.11.2026)', () => {
  beforeEach(() => localStorage.clear())

  it('every kind is on until it is turned off; only what is off is kept', () => {
    expect(readNotificationKinds()).toEqual({ collector: true, support: true, 'app-updated': true, 'raid-start-sound': true, 'trading-bought': true })
    setNotificationOn('collector', false)
    setNotificationOn('raid-start-sound', false)
    expect(notificationOn('collector')).toBe(false)
    expect(notificationOn('support')).toBe(true)
    expect(JSON.parse(localStorage.getItem('raidos-notification-kinds-v1')!)).toEqual({ collector: false, 'raid-start-sound': false })
    setNotificationOn('collector', true)
    setNotificationOn('raid-start-sound', true)
    expect(localStorage.getItem('raidos-notification-kinds-v1')).toBeNull()
  })

  it('a damaged value reads as everything on', () => {
    localStorage.setItem('raidos-notification-kinds-v1', '{not json')
    expect(notificationOn('collector')).toBe(true)
  })
})
