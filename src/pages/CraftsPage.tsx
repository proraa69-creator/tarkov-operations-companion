import { useMemo, useState } from 'react'
import { ChevronDown, Database, Fuel, Lock, Search } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { useEconomySnapshot } from '../data/useEconomy'
import { craftRows, formatDuration, fuelCostPerHour, matchesSearch, sortByNumber, type CraftContext, type CraftRow } from '../domain/economy'
import { formatPrice, timeAgo } from '../shared/format'
import { EconomyStatus, EconomyTabs, ItemLines, ProfitCell } from '../components/EconomyParts'

type CraftSort = 'perHour' | 'profit' | 'percent' | 'duration'
const SORTS: Array<[CraftSort, string]> = [['perHour', 'Прибыль в час'], ['profit', 'Прибыль ₽'], ['percent', 'Прибыль %'], ['duration', 'Время']]

export function CraftsPage() {
  const state = useAppState()
  const { data: catalog } = useTarkovData()
  const { data, isLoading, error, supported, dataUpdatedAt } = useEconomySnapshot(state.raidMode)
  const [query, setQuery] = useState('')
  const [station, setStation] = useState('all')
  const [builtOnly, setBuiltOnly] = useState(false)
  const [withFuel, setWithFuel] = useState(false)
  const [profitableOnly, setProfitableOnly] = useState(false)
  const [sort, setSort] = useState<CraftSort>('perHour')
  const [levelsOpen, setLevelsOpen] = useState(false)
  // Hideout levels are per mode (PvP / PvE / Season progress is separate), set on the Hideout page or below.
  const stationLevels = state.activeProfile.modes[state.raidMode].hideoutLevels
  const knowsLevels = Object.keys(stationLevels).length > 0

  const baseContext = useMemo(() => ({
    fleaEnabled: data?.flea.enabled ?? true,
    feeOptions: { offerFeeRate: data?.flea.offerFeeRate, requirementFeeRate: data?.flea.requirementFeeRate },
  }), [data])
  const fuelPerHour = useMemo(() => data ? fuelCostPerHour(data.items, baseContext) : null, [baseContext, data])
  const context: CraftContext = useMemo(() => ({ ...baseContext, stationLevels, fuelPerHour: withFuel ? fuelPerHour : 0 }), [baseContext, fuelPerHour, stationLevels, withFuel])
  const allRows = useMemo(() => data ? craftRows(data, context) : [], [context, data])
  const stations = useMemo(() => {
    const byId = new Map<string, { id: string; name: string; maxLevel: number }>()
    for (const row of allRows) {
      const known = byId.get(row.stationId)
      const catalogMax = catalog.hideout.find((entry) => entry.id === row.stationId)?.maxLevel ?? 0
      byId.set(row.stationId, { id: row.stationId, name: row.stationName, maxLevel: Math.max(known?.maxLevel ?? 0, row.level, catalogMax) })
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [allRows, catalog.hideout])
  const rows = useMemo(() => {
    const filtered = allRows.filter((row) => (station === 'all' || row.stationId === station)
      && (!builtOnly || (!row.locked && stationLevels[row.stationId] !== undefined))
      && (!profitableOnly || (row.profit ?? 0) > 0)
      && matchesSearch(query, [...row.inputs, ...row.outputs], row.stationName))
    const key: Record<CraftSort, (row: CraftRow) => number | null> = { perHour: (row) => row.profitPerHour, profit: (row) => row.profit, percent: (row) => row.percent, duration: (row) => row.duration }
    return sortByNumber(filtered, key[sort], sort === 'duration' ? 'asc' : 'desc')
  }, [allRows, builtOnly, profitableOnly, query, sort, station, stationLevels])

  return <div className="page economy-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Экономика · ')}{uiText(state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase())}</div>
        <h1 className="page-title">{uiText('Прибыль крафтов')}</h1>
        <p className="page-subtitle">{uiText('Крафты убежища по станциям и уровням: стоимость ингредиентов, ценность результата после комиссии барахолки, время и прибыль в час.')}</p>
      </div>
      {data && <span className={`tag ${data.source === 'cache' ? 'brass' : 'green'}`}><Database size={12} /> {uiText(data.source === 'cache' ? 'сохранённые данные' : `обновлено ${timeAgo(dataUpdatedAt)}`)}</span>}
    </header>
    <EconomyTabs />
    <EconomyStatus supported={supported} isLoading={isLoading} error={error} />
    {data && <>
      <section className="panel economy-levels">
        <button type="button" className="economy-levels-toggle" aria-expanded={levelsOpen} onClick={() => setLevelsOpen((open) => !open)}>
          <span className="panel-title">{uiText('Мои станции')}</span>
          <span className="dim">{uiText(knowsLevels ? `указано: ${stations.filter((entry) => stationLevels[entry.id] !== undefined).length} из ${stations.length}` : 'уровни не указаны — показаны все крафты')}</span>
          <ChevronDown size={16} className={levelsOpen ? 'open' : ''} />
        </button>
        {levelsOpen && <div className="economy-levels-grid">
          {stations.map((entry) => <label key={entry.id}>
            <span>{uiText(entry.name)}</span>
            <select className="select" value={stationLevels[entry.id] ?? ''} onChange={(event) => state.setHideoutLevel(entry.id, Number(event.target.value))}>
              {stationLevels[entry.id] === undefined && <option value="">—</option>}
              {Array.from({ length: entry.maxLevel + 1 }, (_, level) => <option key={level} value={level}>{uiText(level ? `ур. ${level}` : 'не построено')}</option>)}
            </select>
          </label>)}
        </div>}
      </section>
      <section className="panel">
        <div className="panel-header economy-toolbar">
          <div className="panel-title">{uiText(`${rows.length} крафтов`)}</div>
          <div className="filter-row">
            <label className="economy-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Предмет или станция…')} aria-label={uiText('Поиск')} /></label>
            <select className="select" value={station} onChange={(event) => setStation(event.target.value)} aria-label={uiText('Станция')}>
              <option value="all">{uiText('Все станции')}</option>
              {stations.map((entry) => <option key={entry.id} value={entry.id}>{uiText(entry.name)}</option>)}
            </select>
            <select className="select" value={sort} onChange={(event) => setSort(event.target.value as CraftSort)} aria-label={uiText('Сортировка')}>
              {SORTS.map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}
            </select>
            <label className={`economy-check ${knowsLevels ? '' : 'disabled'}`} title={uiText(knowsLevels ? '' : 'Укажите уровни в «Мои станции»')}><input type="checkbox" disabled={!knowsLevels} checked={builtOnly && knowsLevels} onChange={(event) => setBuiltOnly(event.target.checked)} /><span>{uiText('Только построенные')}</span></label>
            <label className="economy-check"><input type="checkbox" checked={withFuel} onChange={(event) => setWithFuel(event.target.checked)} /><Fuel size={13} /><span>{uiText('Учитывать топливо')}{fuelPerHour ? <small className="dim mono"> {formatPrice(Math.round(fuelPerHour))}{uiText('/ч')}</small> : null}</span></label>
            <label className="economy-check"><input type="checkbox" checked={profitableOnly} onChange={(event) => setProfitableOnly(event.target.checked)} /><span>{uiText('Только выгодные')}</span></label>
          </div>
        </div>
        <div className="panel-body economy-table-wrap">
          <table className="price-table economy-table">
            <thead><tr><th>{uiText('Станция')}</th><th>{uiText('Ингредиенты')}</th><th>{uiText('Результат')}</th><th className="num">{uiText('Время')}</th><th className="num">{uiText('Затраты')}</th><th className="num">{uiText('Ценность')}</th><th className="num">{uiText('Прибыль')}</th></tr></thead>
            <tbody>
              {rows.map((row) => <tr key={row.id} className={row.locked ? 'economy-locked' : ''}>
                <td>
                  <strong>{uiText(row.stationName)}</strong>
                  <div className="economy-tags">
                    <span className={`tag ${row.locked ? 'danger' : ''}`}>{uiText(`ур. ${row.level}`)}</span>
                    {row.taskUnlock && <span className="tag brass" title={uiText(row.taskUnlock.name)}><Lock size={10} />{uiText(row.taskUnlock.name)}</span>}
                  </div>
                </td>
                <td><ItemLines lines={row.inputs} side="buy" /></td>
                <td><ItemLines lines={row.outputs} side="sell" /></td>
                <td className="num mono">{uiText(formatDuration(row.duration))}</td>
                <td className="num mono">{row.cost === null ? <span className="dim">—</span> : formatPrice(row.cost)}{row.fuelCost > 0 && <small className="dim economy-fuel">{uiText('топливо ')}{formatPrice(row.fuelCost)}</small>}</td>
                <td className="num mono">{row.value === null ? <span className="dim">—</span> : formatPrice(Math.round(row.value))}</td>
                <td className="num"><ProfitCell profit={row.profit} percent={row.percent} perHour={row.profitPerHour} /></td>
              </tr>)}
              {!rows.length && <tr><td colSpan={7} className="muted"><div className="empty-state" style={{ minHeight: 120 }}>{uiText('Крафты не найдены.')}</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>}
  </div>
}
