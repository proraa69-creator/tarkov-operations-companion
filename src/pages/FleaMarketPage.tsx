import { uiText } from '../i18n/renderText'
import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Crosshair, Database, Heart, KeyRound, PackageSearch, Search, ShoppingCart, Star, X } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice, timeAgo } from '../shared/format'

type FleaTab = 'all' | 'keys' | 'ammo' | 'favorites'

export function FleaMarketPage() {
  const { data, source, updatedAt } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const initial = params.get('tab') as FleaTab | null
  const selectedId = params.get('selected')
  const [tab, setTabState] = useState<FleaTab>(['keys', 'ammo', 'favorites'].includes(initial ?? '') ? initial! : 'all')
  const [query, setQuery] = useState('')
  const [caliber, setCaliber] = useState('Все калибры')
  const ammo = data.items.filter((item) => item.category === 'Боеприпас')
  const calibers = ['Все калибры', ...new Set(ammo.map((item) => item.caliber).filter(Boolean) as string[])]
  const selected = selectedId ? data.items.find((item) => item.id === selectedId) : undefined
  const setTab = (next: FleaTab) => {
    setTabState(next)
    setParams((current) => {
      const nextParams = new URLSearchParams(current)
      if (next === 'all') nextParams.delete('tab')
      else nextParams.set('tab', next)
      return nextParams
    })
  }
  const selectItem = (id: string) => setParams((current) => {
    const nextParams = new URLSearchParams(current)
    nextParams.set('selected', id)
    return nextParams
  })
  const clearSelected = () => setParams((current) => {
    const nextParams = new URLSearchParams(current)
    nextParams.delete('selected')
    return nextParams
  })
  const rows = useMemo(() => data.items.filter((item) => {
    if (tab === 'keys' && item.category !== 'Ключ') return false
    if (tab === 'ammo' && item.category !== 'Боеприпас') return false
    if (tab === 'favorites' && !state.favoriteItemIds.includes(item.id)) return false
    if (tab === 'ammo' && caliber !== 'Все калибры' && item.caliber !== caliber) return false
    return `${item.name} ${item.shortName} ${uiText(item.name)} ${uiText(item.shortName)}`.toLowerCase().includes(query.toLowerCase())
  }).map((item) => {
    const quotes = item.prices.filter((quote) => quote.mode === state.raidMode)
    const best = quotes.slice().sort((a, b) => b.price - a.price)[0]
    return { item, best }
  }).sort((a, b) => tab === 'ammo' ? (b.item.penetration ?? 0) - (a.item.penetration ?? 0) : (b.best?.price ?? 0) - (a.best?.price ?? 0)), [caliber, data.items, query, state.favoriteItemIds, state.raidMode, tab])

  const selectedQuotes = selected?.prices.filter((quote) => quote.mode === state.raidMode) ?? []
  const selectedBest = selectedQuotes.slice().sort((a, b) => b.price - a.price)[0]

  return <div className="page"><header className="page-header"><div><div className="eyebrow">{uiText("Рынок · ")}{uiText(state.raidMode.toUpperCase())}</div><h1 className="page-title">{uiText("Барахолка")}</h1><p className="page-subtitle">{uiText("Предметы, ключи и боеприпасы в одном разделе. Карточка предмета открывается здесь же.")}</p></div><span className={`tag ${source === 'demo' ? 'danger' : 'green'}`}><Database size={12} /> {uiText(source === 'demo' ? 'демо-данные' : `обновлено ${timeAgo(updatedAt)}`)}</span></header>
    {uiText(source === 'demo' && <div className="panel import-warning"><AlertTriangle size={17} />{uiText("Tarkov.dev временно недоступен — цены показаны только для демонстрации.")}</div>)}
    <div className="filter-row"><div className="mode-switch wide"><button className={tab === 'all' ? 'active' : ''} onClick={() => setTab('all')}>{uiText("Все предметы")}</button><button className={tab === 'keys' ? 'active' : ''} onClick={() => setTab('keys')}><KeyRound size={13} />{uiText(" Ключи")}</button><button className={tab === 'ammo' ? 'active' : ''} onClick={() => setTab('ammo')}><Crosshair size={13} />{uiText(" Боеприпасы")}</button><button className={tab === 'favorites' ? 'active' : ''} onClick={() => setTab('favorites')}><Star size={13} />{uiText(" Избранное")}</button></div></div>
    <div className={`flea-layout ${selected ? 'with-detail' : ''}`}>
      <section className="panel"><div className="panel-header"><div className="panel-title">{uiText(rows.length)}{uiText(" позиций")}</div><div className="filter-row" style={{ margin: 0 }}><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 11, top: 11 }} /><input className="input" style={{ height: 35, paddingLeft: 32 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Найти предмет…")} /></div>{uiText(tab === 'ammo' && <select className="select" value={caliber} onChange={(event) => setCaliber(event.target.value)}>{uiText(calibers.map((entry) => <option key={entry}>{uiText(entry)}</option>))}</select>)}</div></div><div className="panel-body" style={{ overflowX: 'auto' }}><table className="price-table"><thead><tr><th>{uiText("Предмет")}</th><th className="col-category">{uiText("Категория")}</th>{uiText(tab === 'ammo' && <><th>{uiText("Урон")}</th><th>{uiText("Пробитие")}</th></>)}<th className="col-source">{uiText("Источник")}</th><th>{uiText("Цена")}</th><th /></tr></thead><tbody>{uiText(rows.slice(0, 500).map(({ item, best }) => <tr key={item.id} className={item.id === selectedId ? 'selected-row' : ''}><td><button className="flea-item-link" onClick={() => selectItem(item.id)}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><strong>{uiText(item.name)}</strong><small className="dim" style={{ display: 'block' }}>{uiText(item.shortName)}</small></span></button></td><td className="col-category"><span className="tag">{uiText(item.category)}</span></td>{uiText(tab === 'ammo' && <><td className="mono">{uiText(item.damage ?? '—')}</td><td className="mono">{uiText(item.penetration ?? '—')}</td></>)}<td className="col-source">{uiText(best?.source ?? '—')}</td><td className="mono"><strong>{uiText(best ? formatPrice(best.price) : '—')}</strong></td><td><button className={`icon-button ${state.favoriteItemIds.includes(item.id) ? 'active' : ''}`} onClick={() => state.toggleFavoriteItem(item.id)} aria-label={uiText("Избранное")}><Star size={14} fill={state.favoriteItemIds.includes(item.id) ? 'currentColor' : 'none'} /></button></td></tr>))}{uiText(!rows.length && <tr><td colSpan={tab === 'ammo' ? 7 : 5} className="muted"><div className="empty-state" style={{ minHeight: 120 }}><div><PackageSearch size={24} /><p>{uiText("Предметы не найдены.")}</p></div></div></td></tr>)}</tbody></table></div></section>
      {uiText(selected && <aside className="panel detail-panel flea-detail">
        <button className="registration-close" onClick={clearSelected} aria-label={uiText("Закрыть карточку")}><X size={16} /></button>
        <div className="item-detail-visual"><img src={selected.iconUrl} alt={uiText(selected.name)} /></div>
        <div className="detail-hero"><div className="eyebrow">{uiText(selected.category)} · {uiText(selected.shortName)}</div><h2 style={{ margin: '10px 0 7px', fontSize: 24 }}>{uiText(selected.name)}</h2><div className="filter-row" style={{ margin: 0 }}>{uiText(selected.slots && <span className="tag">{uiText(selected.slots)}</span>)}{uiText(selected.weight && <span className="tag">{uiText(selected.weight)}{uiText(" кг")}</span>)}{uiText(selected.caliber && <span className="tag brass">{uiText(selected.caliber)}</span>)}</div></div>
        <div className="detail-section"><h4>{uiText("Описание")}</h4><p>{uiText(selected.description)}</p></div>
        {uiText((selected.damage || selected.penetration) && <div className="detail-section grid-2"><div><div className="stat-label">{uiText("Урон")}</div><div className="stat-value">{uiText(selected.damage)}</div></div><div><div className="stat-label">{uiText("Пробитие")}</div><div className="stat-value">{uiText(selected.penetration)}</div></div></div>)}
        <div className="detail-section"><h4>{uiText("Цены · ")}{uiText(state.raidMode.toUpperCase())}</h4><table className="price-table"><thead><tr><th>{uiText("Источник")}</th><th>{uiText("Цена")}</th></tr></thead><tbody>{uiText(selectedQuotes.map((quote) => <tr key={`${quote.source}-${quote.price}`}><td>{uiText(quote.source)}{uiText(quote === selectedBest && <span className="tag green" style={{ marginLeft: 7 }}>{uiText("лучшее")}</span>)}</td><td className="mono">{uiText(formatPrice(quote.price))}</td></tr>))}{uiText(!selectedQuotes.length && <tr><td colSpan={2} className="muted">{uiText("Нет данных для выбранного режима.")}</td></tr>)}</tbody></table></div>
        <div className="detail-section stack"><button className={`button ${state.favoriteItemIds.includes(selected.id) ? 'primary' : ''}`} onClick={() => state.toggleFavoriteItem(selected.id)}>{uiText(state.favoriteItemIds.includes(selected.id) ? <Heart size={15} fill="currentColor" /> : <Star size={15} />)} {uiText(state.favoriteItemIds.includes(selected.id) ? 'В избранном' : 'Добавить в избранное')}</button><button className={`button ${state.raidItemIds.includes(selected.id) ? 'primary' : 'ghost'}`} onClick={() => state.toggleRaidItem(selected.id)}><ShoppingCart size={15} /> {uiText(state.raidItemIds.includes(selected.id) ? 'В списке рейда' : 'В список рейда')}</button></div>
      </aside>)}
    </div>
  </div>
}
