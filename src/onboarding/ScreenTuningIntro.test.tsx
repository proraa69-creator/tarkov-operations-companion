import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, NavLink, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ScreenTuningIntro, SCREEN_INTRO_KEY } from './ScreenTuningIntro'
import { GUIDE_TIMING } from './guideProgress'

/** The menu entry and the parts of «Настройка экрана» the tour points at. */
const ScreenPage = () => <div>
  <div className="segmented-filter screen-tabs" role="tablist"><button type="button" role="tab">Экран</button><button type="button" role="tab">Оптимизировать компьютер</button></div>
  <div className="preset-triggers"><label><input type="checkbox" />Включать пресет при входе в рейд</label><div className="preset-key">клавиша</div></div>
</div>
const open = () => render(<MemoryRouter initialEntries={['/']}>
  <ScreenTuningIntro />
  <nav className="sidebar"><NavLink className="nav-link" to="/screen">Настройка экрана</NavLink></nav>
  <Routes><Route path="/" element={<div>Обзор</div>} /><Route path="/screen" element={<ScreenPage />} /></Routes>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })
const accept = async () => { fireEvent.click(screen.getByRole('button', { name: 'Принял' })); await settle() }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  ;(window as unknown as { tarkovDesktop: unknown }).tarkovDesktop = { screen: {} }
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  localStorage.clear()
  delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop
})

describe('the tour of «Настройка экрана» (owner, 28.10.2026)', () => {
  it('points at the menu, opens the page with the before / after picture, then the raid switch, the key and the optimizer — once', async () => {
    const view = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Новое: настройка экрана' })).toHaveTextContent('рабочий стол не меняется')
    expect(localStorage.getItem(SCREEN_INTRO_KEY)).not.toBeNull()
    await accept()
    const presets = screen.getByRole('dialog', { name: 'Готовые пресеты и свои' })
    expect(presets.querySelector('img.screen-intro-shot')).not.toBeNull()
    await accept()
    expect(screen.getByRole('dialog', { name: 'Сам включится в рейде' })).toBeInTheDocument()
    await accept()
    expect(screen.getByRole('dialog', { name: 'Включение по клавише' })).toBeInTheDocument()
    await accept()
    expect(screen.getByRole('dialog', { name: 'Оптимизация компьютера' })).toHaveTextContent('важные файлы не затрагиваются')
    await accept()
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('never shows on the phone or the site (no screen settings there)', async () => {
    delete (window as unknown as { tarkovDesktop?: unknown }).tarkovDesktop
    open()
    await settle()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
