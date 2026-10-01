import { uiText } from '../i18n/renderText'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Boxes, Minus, PackageX, Plus, Search } from 'lucide-react'
import { useTarkovData } from '../data/DataProvider'
import { useAppState } from '../state/AppState'
import { calculateAvailability } from '../progression/requirementEngine'
import { COLLECTOR_CHANGED_EVENT, loadCollected } from '../kappa/collector'
import { computeKeepList, filterKeepRows, type KeepReason, type KeepRow, type KeepSource } from '../raidprep/keepList'
import '../styles/raidPrep.css'

type SourceFilter = 'all' | KeepSource

const sourceLabels: Record<SourceFilter, string> = { all: 'Все', quest: 'Задания', hideout: 'Убежище', kappa: 'Капа' }
const ROW_LIMIT = 400

/** «Что не продавать»: items still needed for quests, unbuilt hideout levels and the Collector, in the selected mode. */
export function KeepItemsPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const { raidMode } = state
  const progress = state.activeProfile.modes[raidMode]
  const [query, setQuery] = useState('')
  const [source, setSource] = useState<SourceFilter>('all')
  const [firOnly, setFirOnly] = useState(false)
  const [hideDone, setHideDone] = useState(false)
  const [collected, setCollected] = useState(() => loadCollected(raidMode))

  useEffect(() => {
    const reload = () => setCollected(loadCollected(raidMode))
    reload()
    window.addEventListener(COLLECTOR_CHANGED_EVENT, reload)
    return () => window.removeEventListener(COLLECTOR_CHANGED_EVENT, reload)
  }, [raidMode])

  const availability = useMemo(() => calculateAvailability(data.quests, progress), [data.quests, progress])
  const rows = useMemo(
    () => computeKeepList({ quests: data.quests, hideout: data.hideout, items: data.items, progress, availability, collectorCollected: collected }),
    [data.quests, data.hideout, data.items, progress, availability, collected],
  )
  const shown = useMemo(
    () => filterKeepRows(rows, { kinds: source === 'all' ? undefined : [source], foundInRaidOnly: firOnly, search: query, hideDone }),
    [rows, source, firOnly, query, hideDone],
  )
  const remainingTotal = shown.reduce((sum, row) => sum + row.remaining, 0)
  const firTotal = shown.filter((row) => row.needFoundInRaid > 0 && row.remaining > 0).length

  return (
    <div className="page keep-page">
      <header className="page-header">
        <div>
          <div className="eyebrow">{uiText('Рейд · ')}{uiText(raidMode === 'seasonal' ? 'Сезон' : raidMode.toUpperCase())}</div>
          <h1 className="page-title">{uiText('Что не продавать')}</h1>
          <p className="page-subtitle">{uiText('Предметы для текущих и будущих заданий, непостроенных уровней убежища и «Коллекционера». Выполненные задания из журналов игры пропадают из списка сами. Счётчик «Есть» ведётся отдельно для каждого режима.')}</p>
        </div>
        <div className="keep-summary">
          <span className="tag brass"><PackageX size={12} /> {uiText(shown.length)}{uiText(' предметов')}</span>
          <span className="tag">{uiText('осталось найти: ')}{uiText(remainingTotal)}</span>
          <span className="tag danger">{uiText('FIR: ')}{uiText(firTotal)}</span>
        </div>
      </header>

      <section className="panel">
        <div className="panel-header keep-toolbar">
          <div className="keep-search">
            <Search size={14} />
            <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти предмет…')} aria-label={uiText('Найти предмет…')} />
          </div>
          <div className="segmented-filter" role="group" aria-label={uiText('Источник')}>
            {(Object.keys(sourceLabels) as SourceFilter[]).map((value) => (
              <button key={value} type="button" className={source === value ? 'active' : ''} aria-pressed={source === value} onClick={() => setSource(value)}>{uiText(sourceLabels[value])}</button>
            ))}
          </div>
          <label className="keep-check"><input type="checkbox" checked={firOnly} onChange={(event) => setFirOnly(event.target.checked)} />{uiText('Только «найти в рейде»')}</label>
          <label className="keep-check"><input type="checkbox" checked={hideDone} onChange={(event) => setHideDone(event.target.checked)} />{uiText('Скрыть собранные')}</label>
        </div>
        <div className="panel-body keep-table-wrap">
          <table className="price-table keep-table">
            <thead>
              <tr>
                <th>{uiText('Предмет')}</th>
                <th className="num">{uiText('Нужно')}</th>
                <th className="num">{uiText('Есть')}</th>
                <th className="num">{uiText('Осталось')}</th>
                <th>{uiText('Зачем')}</th>
              </tr>
            </thead>
            <tbody>
              {shown.slice(0, ROW_LIMIT).map((row) => (
                <KeepTableRow key={row.item.id} row={row} onCount={(count) => state.setItemCount(row.item.id, count)} />
              ))}
              {!shown.length && (
                <tr><td colSpan={5}><div className="empty-state" style={{ minHeight: 140 }}><div><PackageX size={24} /><p>{uiText(rows.length ? 'Под фильтр ничего не попало.' : 'Список пуст: нет данных о заданиях и убежище. Обновите данные.')}</p></div></div></td></tr>
              )}
            </tbody>
          </table>
          {shown.length > ROW_LIMIT && <p className="muted keep-more">{uiText('Показаны первые 400 — уточните поиск.')}</p>}
        </div>
      </section>

      <HideoutLevels />
    </div>
  )
}

function KeepTableRow({ row, onCount }: { row: KeepRow; onCount: (count: number) => void }) {
  const { item } = row
  return (
    <tr className={row.remaining === 0 ? 'is-done' : ''}>
      <td>
        <span className="keep-item">
          {item.iconUrl ? <img className="item-thumb" src={item.iconUrl} alt="" loading="lazy" /> : <span className="item-thumb" />}
          <span>
            <Link to={`/flea?selected=${item.id}`}><strong>{uiText(item.name)}</strong></Link>
            {row.needFoundInRaid > 0 && <span className="keep-fir" title={uiText('Нужно найти в рейде')}>{uiText('FIR')}{row.needFoundInRaid < row.need ? ` ${row.needFoundInRaid}` : ''}</span>}
          </span>
        </span>
      </td>
      <td className="num mono">{row.need}</td>
      <td className="num">
        <span className="keep-counter">
          <button type="button" className="icon-button" onClick={() => onCount(row.have - 1)} disabled={row.have <= 0} aria-label={uiText('Меньше')}><Minus size={13} /></button>
          <input
            className="input mono"
            inputMode="numeric"
            value={row.have}
            aria-label={uiText(`Есть: ${item.name}`)}
            onChange={(event) => onCount(Number(event.target.value.replace(/\D/g, '')) || 0)}
          />
          <button type="button" className="icon-button" onClick={() => onCount(row.have + 1)} aria-label={uiText('Больше')}><Plus size={13} /></button>
        </span>
      </td>
      <td className="num mono"><strong className={row.remaining ? 'keep-remaining' : 'keep-complete'}>{row.remaining}</strong></td>
      <td><span className="keep-reasons">{row.reasons.map((reason) => <ReasonChip key={`${reason.kind}:${reason.id}:${reason.level ?? ''}`} reason={reason} />)}</span></td>
    </tr>
  )
}

function ReasonChip({ reason }: { reason: KeepReason }) {
  const { data } = useTarkovData()
  const count = reason.count > 1 ? ` ×${reason.count}` : ''
  const fir = reason.foundInRaid ? ' (FIR)' : ''
  const durability = reason.minDurability ? ` · ≥${reason.minDurability}%` : ''
  const substitutes = reason.substitutes?.map((id) => data.items.find((item) => item.id === id)?.shortName ?? id) ?? []
  if (reason.kind === 'hideout') {
    return <span className="keep-reason is-hideout" title={uiText('Уровни убежища указываются вручную внизу страницы')}><Boxes size={11} />{uiText(`${reason.name} ур. ${reason.level}`)}{count}{fir}</span>
  }
  if (reason.kind === 'kappa') {
    return <Link className="keep-reason is-kappa" to="/kappa-items">{uiText('Капа · ')}{uiText(reason.name)}{count}{fir}</Link>
  }
  const status = reason.status === 'active' ? 'is-active' : reason.status === 'locked' ? 'is-locked' : ''
  return (
    <Link className={`keep-reason ${status}`} to={`/quests?filter=all&selected=${encodeURIComponent(reason.id)}`} title={uiText(`${reason.trader ?? ''}${reason.status === 'active' ? ' · текущее' : reason.status === 'locked' ? ' · ещё не открыто' : ''}${substitutes.length ? ` · подойдёт и: ${substitutes.join(', ')}` : ''}`)}>
      {uiText(reason.name)}{count}{fir}{durability}{substitutes.length ? <em className="keep-subs">{uiText(` или ${substitutes.length === 1 ? substitutes[0] : `замена (${substitutes.length})`}`)}</em> : null}
    </Link>
  )
}

/** Built hideout levels are entered by hand (the game logs do not report them); built levels drop out of the list. */
function HideoutLevels() {
  const { data } = useTarkovData()
  const state = useAppState()
  const levels = state.activeProfile.modes[state.raidMode].hideoutLevels
  if (!data.hideout.length) return null
  return (
    <details className="panel keep-hideout">
      <summary className="panel-header"><span className="panel-title">{uiText('Уровни убежища')}</span><small className="dim">{uiText('Указываются вручную — игра не пишет их в журналы')}</small></summary>
      <div className="panel-body keep-hideout-grid">
        {data.hideout.map((station) => {
          const level = levels[station.id] ?? 0
          const max = station.maxLevel ?? station.levels?.length ?? 0
          return (
            <div className="keep-station" key={station.id}>
              <span>{uiText(station.name)}</span>
              <span className="keep-counter">
                <button type="button" className="icon-button" disabled={level <= 0} onClick={() => state.setHideoutLevel(station.id, level - 1)} aria-label={uiText('Меньше')}><Minus size={13} /></button>
                <strong className="mono">{level}/{max}</strong>
                <button type="button" className="icon-button" disabled={level >= max} onClick={() => state.setHideoutLevel(station.id, level + 1)} aria-label={uiText('Больше')}><Plus size={13} /></button>
              </span>
            </div>
          )
        })}
      </div>
    </details>
  )
}
