import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HalloweenEventButton } from './HalloweenEventButton'
import { HalloweenEventWindow } from './HalloweenEventWindow'
import { HALLOWEEN_EVENT_END, halloweenEventActive, openHalloweenEvent } from './halloweenEvent'
import { HALLOWEEN_QUEST_IDS } from '../data/curatedQuests'

const DURING = Date.UTC(2026, 10, 2, 12)

function MapProbe() {
  const location = useLocation()
  return <div data-testid="map">{location.pathname}{location.search}</div>
}

const open = () => render(<MemoryRouter initialEntries={['/']}>
  <HalloweenEventWindow />
  <Routes><Route path="/" element={<HalloweenEventButton />} /><Route path="/maps/:id" element={<MapProbe />} /></Routes>
</MemoryRouter>)

beforeEach(() => {
  // only the clock: the photo list loads and the test waits for it with real timers
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(DURING)
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('«Хеллоуин» (owner, 02.11.2026: «сделай кнопку Хеллоуин при открытии там вся информация о ивенте, квесты»)', () => {
  it('lasts until the end the app shows (the game has not announced one)', () => {
    expect(new Date(HALLOWEEN_EVENT_END).toISOString()).toBe('2026-11-12T07:00:00.000Z')
    expect(halloweenEventActive(HALLOWEEN_EVENT_END - 1)).toBe(true)
    expect(halloweenEventActive(HALLOWEEN_EVENT_END)).toBe(false)
  })

  it('the Overview button opens the event: the facts, the stages, every task with objectives, rewards and its maps', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Хеллоуин' }))
    const dialog = screen.getByRole('dialog', { name: 'Хеллоуин 2026' })
    expect(dialog).toHaveTextContent('«Заражённый завод» и «Заражённая лаборатория» — отдельные ивентовые локации')
    expect(dialog).toHaveTextContent('только «Парковка» (нужен ключ от машины) и «Накопительный коллектор»')
    for (const stage of ['Начало', 'Развилка: Лыжник или Терапевт', 'Линия Терапевта', 'Линия Лыжника']) expect(within(dialog).getByRole('heading', { name: stage })).toBeInTheDocument()
    expect(dialog.querySelectorAll('details.halloween-quest')).toHaveLength(19)
    // «Ослепить противника»: the last of Skier's line, number 19
    const blind = within(dialog).getByText('Ослепить противника').closest('details')!
    expect(blind).toHaveTextContent('19')
    fireEvent.click(within(blind).getByText('Ослепить противника'))
    expect(blind).toHaveTextContent('Уничтожить камеры в санатории на локации Берег')
    expect(blind).toHaveTextContent('60 000 опыта')
    expect(blind).toHaveTextContent('4 000 €')
    expect(blind).toHaveTextContent('Достижение «Поднять щиты!»')
    expect(within(blind).getAllByRole('link').map((link) => link.textContent)).toEqual(['Лес', 'Таможня', 'Маяк', 'Резерв', 'Берег'])
    // the photos of the places, without a source line
    expect(await within(blind).findByText('Камера на стреле крана')).toBeInTheDocument()
    expect(blind).not.toHaveTextContent(/tarkov|EFT Wiki/i)
    // a map shows the task's points; the window closes
    fireEvent.click(within(blind).getByRole('link', { name: 'Таможня' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('map')).toHaveTextContent(`/maps/customs?quest=${HALLOWEEN_QUEST_IDS.blindEnemy}`)
  })

  it('Escape closes it; after the event there is no button and nothing opens', () => {
    const view = open()
    act(() => openHalloweenEvent())
    expect(screen.getByRole('dialog', { name: 'Хеллоуин 2026' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    view.unmount()
    vi.setSystemTime(HALLOWEEN_EVENT_END)
    open()
    expect(screen.queryByRole('button', { name: 'Хеллоуин' })).toBeNull()
    act(() => openHalloweenEvent())
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
