import { uiText } from '../i18n/renderText'
import { useMemo, useState } from 'react'
import { Heart, PackageSearch, Search, ShoppingCart, Star } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'

export function ItemsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('Все категории')
  const selectedId = params.get('selected') ?? state.favoriteItemIds[0] ?? data.items[0]?.id
  const selected = data.items.find((item) => item.id === selectedId) ?? data.items[0]
  const categories = ['Все категории', ...new Set(data.items.map((item) => item.category))]
  const filtered = useMemo(() => data.items.filter((item) => {
    const text = `${item.name} ${item.shortName}`.toLowerCase()
    return text.includes(query.toLowerCase()) && (category === 'Все категории' || item.category === category)
  }).slice(0, 120), [data.items, query, category])

  if (!selected) return null
  const quotes = selected.prices.filter((quote) => quote.mode === state.raidMode)
  const best = quotes.slice().sort((a, b) => b.price - a.price)[0]

  return <div className="page">
    <header className="page-header"><div><div className="eyebrow">{uiText("База снабжения")}</div><h1 className="page-title">{uiText("Предметы")}</h1><p className="page-subtitle">{uiText("Характеристики, назначение, лучшие цены и связи с заданиями.")}</p></div><span className="tag green">{uiText(data.items.length)}{uiText(" записей")}</span></header>
    <div className="filter-row"><div style={{ position: 'relative' }}><Search size={14} style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-dim)' }} /><input className="input" style={{ paddingLeft: 34 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText("Название или сокращение…")} /></div><select className="select" value={category} onChange={(event) => setCategory(event.target.value)}>{uiText(categories.map((entry) => <option key={entry}>{uiText(entry)}</option>))}</select><span className="dim">{uiText("Показано: ")}{uiText(filtered.length)}</span></div>
    <div className="split-page">
      <section className="panel"><div className="panel-header"><div className="panel-title">{uiText("Каталог")}</div><span className="tag">{uiText(state.raidMode.toUpperCase())}</span></div><div className="panel-body catalog-list" style={{ maxHeight: 'calc(100vh - 235px)', overflow: 'auto' }}>
        {uiText(filtered.map((item) => { const itemQuotes = item.prices.filter((quote) => quote.mode === state.raidMode); const price = itemQuotes.slice().sort((a, b) => b.price - a.price)[0]?.price ?? 0; return <button key={item.id} className={`catalog-card ${item.id === selected.id ? 'selected' : ''}`} onClick={() => setParams({ selected: item.id })}><img className="item-thumb" src={item.iconUrl} alt={uiText("")} /><span><h3>{uiText(item.name)}</h3><p>{uiText(item.category)} · {uiText(item.shortName)}</p></span><span className="mono" style={{ color: price ? 'var(--green)' : 'var(--text-dim)' }}>{uiText(price ? formatPrice(price) : '—')}</span></button> }))}
        {uiText(!filtered.length && <div className="empty-state"><div><PackageSearch size={26} /><p>{uiText("Предметы не найдены.")}</p></div></div>)}
      </div></section>
      <aside className="panel detail-panel">
        <div className="item-detail-visual"><img src={selected.iconUrl} alt={uiText(selected.name)} /></div>
        <div className="detail-hero"><div className="eyebrow">{uiText(selected.category)} · {uiText(selected.shortName)}</div><h2 style={{ margin: '10px 0 7px', fontSize: 27 }}>{uiText(selected.name)}</h2><div className="filter-row" style={{ margin: 0 }}>{uiText(selected.slots && <span className="tag">{uiText(selected.slots)}</span>)}{uiText(selected.weight && <span className="tag">{uiText(selected.weight)}{uiText(" кг")}</span>)}{uiText(selected.caliber && <span className="tag brass">{uiText(selected.caliber)}</span>)}{uiText(selected.armorClass && <span className="tag green">{uiText("Класс ")}{uiText(selected.armorClass)}</span>)}</div></div>
        <div className="detail-section"><h4>{uiText("Описание")}</h4><p>{uiText(selected.description)}</p></div>
        {uiText((selected.damage || selected.penetration) && <div className="detail-section grid-2"><div><div className="stat-label">{uiText("Урон")}</div><div className="stat-value">{uiText(selected.damage)}</div></div><div><div className="stat-label">{uiText("Пробитие")}</div><div className="stat-value">{uiText(selected.penetration)}</div></div></div>)}
        <div className="detail-section"><h4>{uiText("Цены · ")}{uiText(state.raidMode.toUpperCase())}</h4><table className="price-table"><thead><tr><th>{uiText("Источник")}</th><th>{uiText("Цена")}</th></tr></thead><tbody>{uiText(quotes.map((quote) => <tr key={`${quote.source}-${quote.price}`}><td>{uiText(quote.source)}{uiText(quote === best && <span className="tag green" style={{ marginLeft: 7 }}>{uiText("лучшее")}</span>)}</td><td className="mono">{uiText(formatPrice(quote.price))}</td></tr>))}{uiText(!quotes.length && <tr><td colSpan={2} className="muted">{uiText("Нет данных для выбранного режима.")}</td></tr>)}</tbody></table></div>
        <div className="detail-section stack"><button className={`button ${state.favoriteItemIds.includes(selected.id) ? 'primary' : ''}`} onClick={() => state.toggleFavoriteItem(selected.id)}>{uiText(state.favoriteItemIds.includes(selected.id) ? <Heart size={15} fill="currentColor" /> : <Star size={15} />)} {uiText(state.favoriteItemIds.includes(selected.id) ? 'В избранном' : 'Добавить в избранное')}</button><button className={`button ${state.raidItemIds.includes(selected.id) ? 'primary' : 'ghost'}`} onClick={() => state.toggleRaidItem(selected.id)}><ShoppingCart size={15} /> {uiText(state.raidItemIds.includes(selected.id) ? 'В списке рейда' : 'В список рейда')}</button></div>
      </aside>
    </div>
  </div>
}
