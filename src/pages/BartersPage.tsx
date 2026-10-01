import { useMemo, useState } from 'react'
import { Database, Lock, Search } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { useEconomySnapshot } from '../data/useEconomy'
import { barterRows, matchesSearch, sortByNumber, type BarterRow, type PriceContext } from '../domain/economy'
import { formatPrice, timeAgo } from '../shared/format'
import { EconomyStatus, EconomyTabs, ItemLines, ProfitCell } from '../components/EconomyParts'

type BarterSort = 'profit' | 'percent' | 'cost' | 'level'
const SORTS: Array<[BarterSort, string]> = [['profit', 'Прибыль ₽'], ['percent', 'Прибыль %'], ['cost', 'Стоимость'], ['level', 'Уровень торговца']]
const LIMIT = 300

export function BartersPage() {
  const state = useAppState()
  const { data, isLoading, error, supported, dataUpdatedAt } = useEconomySnapshot(state.raidMode)
  const [query, setQuery] = useState('')
  const [trader, setTrader] = useState('all')
  // The app has no reliable source of the player's trader loyalty levels yet, so every level is shown by default;
  // the player can cap it here (offers and barters above the cap are treated as unavailable).
  const [levelCap, setLevelCap] = useState(4)
  const [profitableOnly, setProfitableOnly] = useState(false)
  const [sort, setSort] = useState<BarterSort>('profit')

  const context: PriceContext = useMemo(() => ({
    fleaEnabled: data?.flea.enabled ?? true,
    feeOptions: { offerFeeRate: data?.flea.offerFeeRate, requirementFeeRate: data?.flea.requirementFeeRate },
    defaultTraderLevel: levelCap,
  }), [data, levelCap])
  const allRows = useMemo(() => data ? barterRows(data, context) : [], [context, data])
  const traders = useMemo(() => [...new Map(allRows.map((row) => [row.traderId, row.traderName])).entries()].sort((a, b) => a[1].localeCompare(b[1])), [allRows])
  const rows = useMemo(() => {
    const filtered = allRows.filter((row) => (trader === 'all' || row.traderId === trader)
      && !row.locked
      && (!profitableOnly || (row.profit ?? 0) > 0)
      && matchesSearch(query, [...row.inputs, ...row.outputs], row.traderName, row.taskUnlock?.name ?? ''))
    const key: Record<BarterSort, (row: BarterRow) => number | null> = { profit: (row) => row.profit, percent: (row) => row.percent, cost: (row) => row.cost, level: (row) => row.level }
    return sortByNumber(filtered, key[sort], sort === 'cost' || sort === 'level' ? 'asc' : 'desc')
  }, [allRows, profitableOnly, query, sort, trader])
  const profitable = rows.filter((row) => (row.profit ?? 0) > 0).length

  return <div className="page economy-page">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Экономика · ')}{uiText(state.raidMode === 'seasonal' ? 'Сезон' : state.raidMode.toUpperCase())}</div>
        <h1 className="page-title">{uiText('Калькулятор бартеров')}</h1>
        <p className="page-subtitle">{uiText('Сколько стоит отдать предметы торговцу и сколько стоит то, что вы получите. Вход — дешевле из барахолки и торговцев, выход — цена барахолки за вычетом комиссии или лучший выкуп торговца.')}</p>
      </div>
      {data && <span className={`tag ${data.source === 'cache' ? 'brass' : 'green'}`}><Database size={12} /> {uiText(data.source === 'cache' ? 'сохранённые данные' : `обновлено ${timeAgo(dataUpdatedAt)}`)}</span>}
    </header>
    <EconomyTabs />
    <EconomyStatus supported={supported} isLoading={isLoading} error={error} />
    {data && <section className="panel">
      <div className="panel-header economy-toolbar">
        <div className="panel-title">{uiText(`${rows.length} бартеров`)}{profitable ? <span className="tag green">{uiText(`${profitable} выгодных`)}</span> : null}</div>
        <div className="filter-row">
          <label className="economy-search"><Search size={14} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Предмет, торговец или задание…')} aria-label={uiText('Поиск')} /></label>
          <select className="select" value={trader} onChange={(event) => setTrader(event.target.value)} aria-label={uiText('Торговец')}>
            <option value="all">{uiText('Все торговцы')}</option>
            {traders.map(([id, name]) => <option key={id} value={id}>{uiText(name)}</option>)}
          </select>
          <select className="select" value={levelCap} onChange={(event) => setLevelCap(Number(event.target.value))} aria-label={uiText('Уровень лояльности')}>
            <option value={4}>{uiText('Все уровни лояльности')}</option>
            {[1, 2, 3].map((level) => <option key={level} value={level}>{uiText(`Лояльность до ${level}`)}</option>)}
          </select>
          <select className="select" value={sort} onChange={(event) => setSort(event.target.value as BarterSort)} aria-label={uiText('Сортировка')}>
            {SORTS.map(([value, label]) => <option key={value} value={value}>{uiText(label)}</option>)}
          </select>
          <label className="economy-check"><input type="checkbox" checked={profitableOnly} onChange={(event) => setProfitableOnly(event.target.checked)} /><span>{uiText('Только выгодные')}</span></label>
        </div>
      </div>
      <div className="panel-body economy-table-wrap">
        <table className="price-table economy-table">
          <thead><tr><th>{uiText('Торговец')}</th><th>{uiText('Отдаёте')}</th><th>{uiText('Получаете')}</th><th className="num">{uiText('Стоимость')}</th><th className="num">{uiText('Ценность')}</th><th className="num">{uiText('Прибыль')}</th></tr></thead>
          <tbody>
            {rows.slice(0, LIMIT).map((row) => <tr key={row.id}>
              <td>
                <strong>{uiText(row.traderName)}</strong>
                <div className="economy-tags">
                  <span className="tag">{uiText(`ур. ${row.level}`)}</span>
                  {row.taskUnlock && <span className="tag brass" title={uiText(row.taskUnlock.name)}><Lock size={10} />{uiText(row.taskUnlock.name)}</span>}
                  {row.buyLimit && <span className="tag">{uiText(`лимит ${row.buyLimit}`)}</span>}
                </div>
              </td>
              <td><ItemLines lines={row.inputs} side="buy" /></td>
              <td><ItemLines lines={row.outputs} side="sell" /></td>
              <td className="num mono">{row.cost === null ? <span className="dim">—</span> : formatPrice(row.cost)}</td>
              <td className="num mono">{row.value === null ? <span className="dim">—</span> : formatPrice(Math.round(row.value))}</td>
              <td className="num"><ProfitCell profit={row.profit} percent={row.percent} /></td>
            </tr>)}
            {!rows.length && <tr><td colSpan={6} className="muted"><div className="empty-state" style={{ minHeight: 120 }}>{uiText('Бартеры не найдены.')}</div></td></tr>}
          </tbody>
        </table>
        {rows.length > LIMIT && <p className="dim economy-more">{uiText(`Показаны первые ${LIMIT} — уточните поиск.`)}</p>}
      </div>
    </section>}
  </div>
}
