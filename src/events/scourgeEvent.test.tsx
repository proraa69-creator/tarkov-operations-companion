import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GUIDE_TIMING } from '../onboarding/guideProgress'
import { ScourgeEventIntro } from './ScourgeEventIntro'
import { ScourgeEventButton } from './ScourgeEventButton'
import { SCOURGE_EVENT_END, SCOURGE_INTRO_KEY, scourgeEventActive } from './scourgeEvent'
import { bossFiguresFor } from '../data/bossFigures'

const DURING = Date.UTC(2026, 9, 17, 12, 0, 0)

function GalleryProbe() {
  const state = useLocation().state as { boss?: string } | null
  return <div data-testid="gallery">{state?.boss}</div>
}

const open = () => render(<MemoryRouter initialEntries={['/']}>
  <ScourgeEventIntro />
  <a className="nav-link" href="/gallery">Боссы</a>
  <Routes><Route path="/" element={<ScourgeEventButton />} /><Route path="/gallery" element={<GalleryProbe />} /></Routes>
</MemoryRouter>)
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(600) })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'Date'] })
  vi.setSystemTime(DURING)
  Object.assign(GUIDE_TIMING, { startupGraceMs: 0, settleMs: 0, targetWaitMs: 0 })
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

describe('«Вторжение Scourge» (owner, 16.10.2026)', () => {
  it('the event ends on 20 October 2026, 08:00 BST', () => {
    expect(new Date(SCOURGE_EVENT_END).toISOString()).toBe('2026-10-20T07:00:00.000Z')
    expect(scourgeEventActive(SCOURGE_EVENT_END - 1)).toBe(true)
    expect(scourgeEventActive(SCOURGE_EVENT_END)).toBe(false)
  })

  it('at startup: the clip with «Пропустить», then the story, then «Добавлен новый босс» pointing at «Боссы»; once per device', async () => {
    const view = open()
    await settle()
    expect(screen.getByRole('dialog', { name: 'Вторжение Scourge' }).querySelector('video')).toHaveAttribute('src', 'https://raidos.app/media/scourge-invasion.mp4')
    expect(localStorage.getItem(SCOURGE_INTRO_KEY)).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }))
    const story = screen.getByRole('dialog', { name: 'Вторжение Scourge' })
    expect(story).toHaveTextContent('В игру добавили новую цепочку заданий, связанную с операцией Рефа в Лаборатории.')
    expect(story).toHaveTextContent('На котах')
    expect(story).toHaveTextContent('Под офисом управляющего')
    expect(story).toHaveTextContent('Скрытый маршрут')
    fireEvent.click(screen.getByRole('button', { name: 'Далее' }))
    await settle()
    expect(screen.getByRole('dialog', { name: 'Добавлен новый босс' })).toBeInTheDocument()
    expect(document.querySelector('.frg-layer[data-step="scourge-boss"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Открыть «Боссы»' }))
    expect(screen.getByTestId('gallery')).toHaveTextContent('scourge')
    view.unmount()
    open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the Overview button opens every event quest (taken or not); the clip plays at half volume with a slider and goes on to the story', async () => {
    localStorage.setItem(SCOURGE_INTRO_KEY, 'seen')
    open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ивент: Вторжение Scourge' }))
    const story = screen.getByRole('dialog', { name: 'Вторжение Scourge' })
    const cards = [...story.querySelectorAll('.scourge-quest summary')].map((summary) => summary.textContent)
    expect(cards).toHaveLength(6)
    for (const name of ['Скрытый маршрут', 'Простая задача', 'Продление операции', 'Информационный след', 'Подработка для души', 'Деанон']) {
      expect(cards.some((card) => card?.includes(name))).toBe(true)
    }
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }))
    const video = document.querySelector('video')!
    expect(video.volume).toBe(0.5)
    const slider = screen.getByRole('slider', { name: 'Громкость' })
    expect(slider).toHaveValue('50')
    fireEvent.change(slider, { target: { value: '20' } })
    expect(video.volume).toBeCloseTo(0.2)
    fireEvent.ended(video)
    expect(screen.getByRole('button', { name: 'Закрыть' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Закрыть' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('after the event: no button, no intro, no Scourge on the Lab card; he stays a boss of the Lab', async () => {
    vi.setSystemTime(SCOURGE_EVENT_END + 1)
    open()
    await settle()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Ивент: Вторжение Scourge' })).not.toBeInTheDocument()
    expect(bossFiguresFor('the-lab', 'pvp').map((figure) => figure.key)).not.toContain('scourge')
    vi.setSystemTime(DURING)
    expect(bossFiguresFor('the-lab', 'pvp').map((figure) => figure.key)).toContain('scourge')
    expect(bossFiguresFor('the-lab', 'seasonal').map((figure) => figure.key)).toContain('scourge')
    expect(bossFiguresFor('the-lab', 'pve').map((figure) => figure.key)).toContain('scourge')
  })

  it('the button disappears by itself when the event ends while the app is open', async () => {
    vi.setSystemTime(SCOURGE_EVENT_END - 1000)
    localStorage.setItem(SCOURGE_INTRO_KEY, 'seen')
    open()
    expect(screen.getByRole('button', { name: 'Ивент: Вторжение Scourge' })).toBeInTheDocument()
    await act(async () => { vi.setSystemTime(SCOURGE_EVENT_END + 10); await vi.advanceTimersByTimeAsync(1500) })
    expect(screen.queryByRole('button', { name: 'Ивент: Вторжение Scourge' })).not.toBeInTheDocument()
  })
})
