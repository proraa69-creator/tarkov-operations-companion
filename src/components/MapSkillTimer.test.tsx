import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { setRenderLanguage } from '../i18n/renderText'
import { LocaleProvider } from '../i18n/LocaleProvider'
import { MapSkillTimer, MapSkillTimerSettings } from './MapSkillTimer'
import {
  SKILL_TIMER_DEFAULT, clampTimerSeconds, formatTimerClock, isSkillTimerEnabled, loadTimerEndsAt, loadTimerSeconds,
  saveTimerEndsAt, saveTimerSeconds, timerSecondsLeft,
} from './skillTimer'

describe('skill timer maths', () => {
  it('reads m:ss with 0:00 when idle', () => {
    expect(formatTimerClock(0)).toBe('0:00')
    expect(formatTimerClock(200)).toBe('3:20')
    expect(formatTimerClock(59.2)).toBe('1:00')
    expect(formatTimerClock(-4)).toBe('0:00')
  })

  it('counts whole seconds down to zero', () => {
    expect(timerSecondsLeft(null, 1000)).toBe(0)
    expect(timerSecondsLeft(201_000, 1000)).toBe(200)
    expect(timerSecondsLeft(201_000, 1001)).toBe(200)
    expect(timerSecondsLeft(201_000, 200_001)).toBe(1)
    expect(timerSecondsLeft(201_000, 999_999)).toBe(0)
  })

  it('keeps a picked length in range and falls back to 200', () => {
    expect(clampTimerSeconds('90')).toBe(90)
    expect(clampTimerSeconds(1)).toBe(5)
    expect(clampTimerSeconds(99_999)).toBe(3600)
    expect(clampTimerSeconds('abc')).toBe(SKILL_TIMER_DEFAULT)
    expect(clampTimerSeconds(0)).toBe(SKILL_TIMER_DEFAULT)
    expect(clampTimerSeconds(null)).toBe(SKILL_TIMER_DEFAULT)
  })

  it('remembers the length and a running end on this device; off until turned on', () => {
    localStorage.clear()
    expect(isSkillTimerEnabled()).toBe(false)
    expect(loadTimerSeconds()).toBe(200)
    saveTimerSeconds(150)
    expect(loadTimerSeconds()).toBe(150)
    saveTimerEndsAt(5000)
    expect(loadTimerEndsAt(1000)).toBe(5000)
    expect(loadTimerEndsAt(6000)).toBeNull()
    saveTimerEndsAt(null)
    expect(loadTimerEndsAt(1000)).toBeNull()
  })
})

describe('MapSkillTimer', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-15T10:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
    setRenderLanguage('ru')
  })

  const idle = () => screen.getByRole('button', { pressed: false })
  const running = () => screen.getByRole('button', { pressed: true })

  it('shows zeros, counts 200 s from a press and resets on the next press', () => {
    render(<MapSkillTimer />)
    expect(idle()).toHaveTextContent('0:00')
    expect(idle()).toHaveAccessibleName('Отсчёт 3:20')
    fireEvent.click(idle())
    expect(running()).toHaveTextContent('3:20')
    act(() => { vi.advanceTimersByTime(5000) })
    expect(running()).toHaveTextContent('3:15')
    fireEvent.click(running())
    expect(idle()).toHaveTextContent('0:00')
    expect(loadTimerEndsAt(Date.now())).toBeNull()
  })

  it('returns to 0:00 by itself when the time is up', () => {
    render(<MapSkillTimer />)
    fireEvent.click(idle())
    act(() => { vi.advanceTimersByTime(200_500) })
    expect(idle()).toHaveTextContent('0:00')
    expect(idle()).toHaveClass('is-done')
  })

  it('keeps counting after the map page is left and opened again', () => {
    const { unmount } = render(<MapSkillTimer />)
    fireEvent.click(idle())
    unmount()
    act(() => { vi.advanceTimersByTime(60_000) })
    render(<MapSkillTimer />)
    expect(running()).toHaveTextContent('2:20')
  })

  it('speaks English', () => {
    setRenderLanguage('en')
    render(<MapSkillTimer />)
    expect(idle()).toHaveAccessibleName('Countdown 3:20')
    fireEvent.click(idle())
    expect(running()).toHaveAccessibleName('Press to reset')
  })
})

describe('MapSkillTimerSettings', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { setRenderLanguage('ru') })

  it('turns the timer on and sets its length, which the map button starts from', () => {
    render(<LocaleProvider><MapSkillTimerSettings /><MapSkillTimer /></LocaleProvider>)
    const toggle = screen.getByRole('switch', { name: 'Таймер усталости' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(isSkillTimerEnabled()).toBe(true)

    const input = screen.getByRole('spinbutton', { name: 'Время, сек' })
    expect(input).toHaveValue(200)
    fireEvent.change(input, { target: { value: '45' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(loadTimerSeconds()).toBe(45)
    expect(screen.getByRole('button', { name: 'Отсчёт 0:45' })).toHaveTextContent('0:00')

    fireEvent.change(input, { target: { value: '1' } })
    fireEvent.blur(input)
    expect(input).toHaveValue(5)
  })

  it('has the question mark that explains the timer', () => {
    render(<LocaleProvider><MapSkillTimerSettings /></LocaleProvider>)
    expect(screen.getByRole('button', { name: 'Что это?' })).toBeInTheDocument()
  })
})
