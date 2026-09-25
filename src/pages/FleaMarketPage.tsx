import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertTriangle, Crosshair, Database, KeyRound, Search, Star } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice, timeAgo } from '../shared/format'

type FleaTab = 'all' | 'keys' | 'ammo' | 'favorites'

export function FleaMarketPage() {
  const { data, source, updatedAt } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const initial = params.get('tab') as FleaTab | null
  const [tab, setTabState] = useState<FleaTab>(['keys', 'ammo', 'favorites'].includes(initial ?? '') ? initial! : 'all')
  const [query, setQuery] = useState('')
  const [caliber, setCaliber] = useState('Все калибры')
  const ammo = data.items.filter((item) => item.category === 'Боеприпас')
  const calibers = ['Все калибры', ...new Set(ammo.map((item) => item.caliber).filter(Boolean) as string[])]
  const setTab = (next: FleaTab) => { setTabState(next); setParams(next === 'all' ? {} : { tab: next }) }
  const rows = useMemo(() => data.items.filter((item) => {
    if (tab === 'keys' && item.category !== 'Ключ') return false
    if (tab === 'ammo' && item.category !== 'Боеприпас') return false
    if (tab === 'favorites' && !state.favoriteItemIds.includes(item.id)) return false
    if (tab === 'ammo' && caliber !== 'Все калибры' && item.caliber !== caliber) return false
    return `${item.name} ${item.shortName}`.toLowerCase().includes(query.toLowerCase())
  }).map((item) => {
    const quotes = item.prices.filter((quote) => quote.mode === state.raidMode)
    const best = quotes.slice().sort((a, b) => b.price - a.price)[0]
    return { item, best }
  }).sort((a, b) => tab === 'ammo' ? (b.item.penetration ?? 0) - (a.item.penetration ?? 0) : (b.best?.price ?? 0) - (a.best?.price ?? 0)), [caliber, data.items, query, state.favoriteItemIds, state.raidMode, tab])

  return <div className="page"><header className="page-header"><div><div className="eyebrow">Рынок · {state.raidMode.toUpperCase()}</div><h1 className="page-title">Барахолка</h1><p className="page-subtitle">Предметы, ключи и боеприпасы в одном разделе с ценами выбранного режима.</p></div><span className={`tag ${source === 'demo' ? 'danger' : 'green'}`}><Database size={12} /> {source === 'demo' ? 'демо-данные' : `обновлено ${timeAgo(updatedAt)}`}</span></header>
    {source === 'demo' && <div className="panel import-warning"><AlertTriangle size={17} />Tarkov.dev временно недоступен — цены показаны только для демонстрации.</div>}
    <div className="filter-row"><div className="mode-switch wide"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>Все предметы</button><button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}><KeyRound size={13} /> Ключи</button><button className={tab === 'ammo' ? 'active' : ''} onClick={() => setTab('ammo')}><Crosshair size={13} /> Боеприпасы</button><button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><Star size={13} /> Избранное</button></div></div>
    <section className="panel"><div className="panel-header"><div className="panel-title">{rows.length} позиций</div><div className="filter-row" style={{ margin: 0 }}><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 11, top: 11 }} /><input className="input" style={{ height: 35, paddingLeft: 32 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти предмет…" /></div>{tab === 'ammo' && <select className="select" value={caliber} onChange={(event) => setCaliber(event.target.value)}>{calibers.map((entry) => <option key={entry}>{entry}</option>)}</select>}</div></div><div className="panel-body" style={{ overflowX: 'auto' }}><table className="price-table"><thead><tr><th>Предмет</th><th>Категория</th>{tab === 'ammo' && <><th>Урон</th><th>Пробитие</th></>}<th>Источник</th><th>Цена</th><th /></tr></thead><tbody>{rows.slice(0, 500).map(({ item, best }) => <tr key={item.id}><td><Link to={`/items?selected=${item.id}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}><img className="item-thumb" src={item.iconUrl} alt="" /><span><strong>{item.name}</strong><small className="dim" style={{ display: 'block' }}>{item.shortName}</small></span></Link></td><td><span className="tag">{item.category}</span></td>{tab === 'ammo' && <><td className="mono">{item.damage ?? '—'}</td><td className="mono">{item.penetration ?? '—'}</td></>}<td>{best?.source ?? '—'}</td><td className="mono"><strong>{best ? formatPrice(best.price) : '—'}</strong></td><td><button className={`icon-button ${state.favoriteItemIds.includes(item.id) ? 'active' : ''}`} onClick={() => state.toggleFavoriteItem(item.id)} aria-label="Избранное"><Star size={14} fill={state.favoriteItemIds.includes(item.id) ? 'currentColor' : 'none'} /></button></td></tr>)}</tbody></table></div></section>
  </div>
}
