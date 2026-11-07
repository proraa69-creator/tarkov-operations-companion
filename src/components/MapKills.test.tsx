import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react'
import { createRef, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Quest } from '../domain/types'
import type { KillRow } from '../maps/killObjectives'
import { setKillZonesShown, useKillZonesShown } from '../maps/killZones'
import { KillZoneCard, KillZonesLayerButton, MapDetailTabs, MapKillsButton, MapKillsPanel, MapKillsWindow, type MapDetailTab } from './MapKills'

const quest = (id: string, name: string): Quest => ({ id, name, trader: 'Прапор', level: 10, kappa: false, description: '', objectives: [], rewards: [] })
const row = (key: string, name: string, extra: Partial<KillRow> = {}): KillRow => ({
  key, quest: quest(key, name), objective: { id: key, type: 'shoot', description: `${name}: устранить`, count: 10 }, kind: 'scav', target: 'Дикие',
  total: 10, current: 0, left: 10, settled: false, tags: [], zones: [], ...extra,
})
const rows = [
  row('punisher', 'Каратель. Часть 2', { total: 15, current: 6, left: 9, tags: [{ kind: 'weapon', text: 'калибр 7.62x39', names: ['АКМ', 'АКМН'] }] }),
  row('outposts', 'Захват аванпоста', { kind: 'pmc', target: 'ЧВК', left: 12, total: 12, tags: [{ kind: 'zone', text: 'на базах Диких' }, { kind: 'maps', text: 'Таможня, Берег, Лес' }] }),
  row('done', 'Мокрое дело. Часть 1', { current: 10, left: 0, settled: true }),
]
const summary = { scav: 9, pmc: 12, other: 0 }

afterEach(() => { cleanup(); localStorage.clear() })

describe('«Устранения» on the PC: the right panel\'s tabs', () => {
  it('«Актуальные квесты · N» and «Устранения · N», the chosen one marked', () => {
    function Tabs() {
      const [tab, setTab] = useState<MapDetailTab>('quests')
      return <><MapDetailTabs tab={tab} onTab={setTab} quests={2} kills={9} /><output>{tab}</output></>
    }
    render(<Tabs />)
    const list = screen.getByRole('tablist', { name: 'Квесты на карте' })
    expect(within(list).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Актуальные квесты2', 'Устранения9'])
    expect(screen.getByRole('tab', { name: 'Актуальные квесты 2' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.click(screen.getByRole('tab', { name: 'Устранения 9' }))
    expect(screen.getByRole('tab', { name: 'Устранения 9' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('kills')
  })

  it('the tab: the short count of Scavs and PMCs, the tick «Места устранения», one row per kill that opens its quest', () => {
    const onOpen = vi.fn()
    const onZones = vi.fn()
    const onMenu = vi.fn()
    render(<MapKillsPanel rows={rows} summary={summary} zoneCount={2} zonesShown onZones={onZones} onOpen={onOpen} onMenu={() => onMenu} />)
    const panel = screen.getByRole('tabpanel', { name: 'Устранения' })
    expect(within(panel).getByLabelText('Осталось устранить')).toHaveTextContent('ВсегоДикие9ЧВК12')
    const tick = within(panel).getByRole('checkbox', { name: 'Места устранения' })
    expect(tick).toBeChecked()
    fireEvent.click(tick)
    expect(onZones).toHaveBeenCalledWith(false)
    const buttons = within(panel).getAllByRole('button')
    expect(buttons.map((button) => button.querySelector('.map-kills-quest')?.textContent)).toEqual(['Каратель. Часть 2', 'Захват аванпоста', 'Мокрое дело. Часть 1'])
    // what is left, of how many when the log counted some; a done one ticked
    expect(buttons[0]).toHaveTextContent('9из 15Каратель. Часть 2Дикиекалибр 7.62x39')
    expect(buttons[0].querySelector('.map-kills-tag')).toHaveAttribute('title', 'Оружие: АКМ, АКМН')
    expect(buttons[1]).toHaveTextContent('12Захват аванпостаЧВКна базах ДикихТаможня, Берег, Лес')
    expect(buttons[2]).toHaveClass('is-settled')
    expect(within(buttons[2]).getByLabelText('Выполнено')).toBeInTheDocument()
    fireEvent.click(buttons[1])
    expect(onOpen).toHaveBeenCalledWith(rows[1])
    fireEvent.contextMenu(buttons[0])
    expect(onMenu).toHaveBeenCalled()
  })

  it('a row that fits does not unfold on its press', () => {
    const view = render(<MapKillsPanel rows={rows} summary={summary} zoneCount={0} zonesShown onZones={vi.fn()} onOpen={vi.fn()} />)
    const first = screen.getAllByRole('button')[0]
    fireEvent.click(first)
    view.rerender(<MapKillsPanel rows={rows} summary={summary} zoneCount={0} zonesShown onZones={vi.fn()} onOpen={vi.fn()} selectedQuestId="punisher" />)
    // jsdom lays nothing out: nothing is cut, so nothing unfolds and no arrow shows
    expect(first).toHaveClass('is-selected')
    expect(first).not.toHaveClass('is-expanded')
    expect(first).not.toHaveAttribute('aria-expanded')
    expect(screen.getByText('Зон на этой карте нет')).toBeInTheDocument()
  })

  it('says so when this map has no kills', () => {
    render(<MapKillsPanel rows={[]} summary={{ scav: 0, pmc: 0, other: 0 }} zoneCount={0} zonesShown={false} onZones={vi.fn()} onOpen={vi.fn()} />)
    expect(screen.getByText('На этой карте нет квестов на устранение.')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: 'Места устранения' })).not.toBeChecked()
  })
})

describe('«Устранения» on the phone: the HUD button and its window', () => {
  it('the button says how many kills are open', () => {
    const onToggle = vi.fn()
    render(<MapKillsButton count={9} open={false} onToggle={onToggle} />)
    const button = screen.getByRole('button', { name: 'Устранения: 9' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalled()
  })

  it('the window closes on Escape, on its ✕ and on a press outside, not on a press inside or on its button', () => {
    const onClose = vi.fn()
    const anchor = createRef<HTMLButtonElement>()
    render(<div className="map-stage">
      <button ref={anchor} type="button">Устранения</button>
      <MapKillsWindow rows={rows} summary={summary} zoneCount={1} zonesShown onZones={vi.fn()} onOpen={vi.fn()} anchorRef={anchor} onClose={onClose} />
      <p>карта</p>
    </div>)
    const dialog = screen.getByRole('dialog', { name: 'Устранения' })
    fireEvent.pointerDown(within(dialog).getAllByRole('button')[1])
    fireEvent.pointerDown(anchor.current!)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByText('карта'))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Закрыть' }))
    expect(onClose).toHaveBeenCalledTimes(3)
    expect(within(dialog).getByText('Дикие и др.')).toBeInTheDocument()
  })
})

describe('«Места устранения»: the zone\'s window and the switch', () => {
  it('the zone\'s window: «Убить в этой зоне», the quest, how many are left of how many, the conditions', () => {
    const { container } = render(<KillZoneCard rows={[row('smugglers', 'Чужое добро', { kind: 'other', target: 'любые цели', current: 3, left: 7, tags: [{ kind: 'zone', text: 'в окрестностях баз контрабандистов' }] })]} kind="scav" />)
    expect(container.firstChild).toHaveTextContent('Убить в этой зоне3 из 10Чужое добро7любые целив окрестностях баз контрабандистов')
    expect(container.querySelector('.mmt')).toHaveStyle({ '--marker-color': '#e8913a' })
  })

  it('a place with a PMC and a Scav kill: blue, both quests in its window', () => {
    const { container } = render(<KillZoneCard rows={[row('a', 'Инициация', { kind: 'scav', target: 'Дикие', left: 10 }), row('b', 'Захват аванпоста', { kind: 'pmc', target: 'ЧВК', left: 12 })]} kind="both" />)
    expect(container.firstChild).toHaveTextContent('ЧВК и дикие в этой зонеИнициация10ДикиеЗахват аванпоста12ЧВК')
    expect(container.querySelector('.mmt')).toHaveStyle({ '--marker-color': '#4f9dff' })
  })

  it('the row in «Точки на карте» and the tick are one switch, kept on this device', () => {
    const { result } = renderHook(() => useKillZonesShown())
    expect(result.current).toBe(true)
    function Row() {
      const shown = useKillZonesShown()
      return <KillZonesLayerButton count={3} shown={shown} onToggle={() => setKillZonesShown(!shown)} />
    }
    render(<Row />)
    const button = screen.getByRole('button', { name: /^Места устранения\s*3$/ })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    act(() => { fireEvent.click(button) })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    expect(result.current).toBe(false)
    expect(localStorage.getItem('raidos-map-kill-zones-v1')).toBe('off')
    act(() => { setKillZonesShown(true) })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(localStorage.getItem('raidos-map-kill-zones-v1')).toBeNull()
  })
})
