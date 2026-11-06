import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Hourglass, KeyRound, Search, Undo2 } from 'lucide-react'
import { QuestDeferDialog, type DeferRequest } from '../components/QuestDeferDialog'
import { useTarkovData } from '../data/DataProvider'
import type { TaskProgressStatus } from '../domain/types'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { deferralTermText, restoreDeferredQuests, useDeferredQuests } from '../progression/deferredQuests'
import { questAvailabilityOf } from '../quests/questReadModel'
import { questKeyRows, type QuestKeyRow, type QuestKeyState, type QuestKeyUse } from '../quests/questKeys'
import { useAppState } from '../state/AppState'
import '../quests/questKeys.css'

const TABS: Array<{ id: QuestKeyState; label: string; empty: string }> = [
  { id: 'needed', label: 'Нужны', empty: 'Квестовые ключи больше не нужны.' },
  { id: 'deferred', label: 'Отложены', empty: 'Нет ключей только отложенных квестов.' },
  { id: 'done', label: 'Больше не нужны', empty: 'Пока нет ключей, все квесты которых выполнены.' },
]

const STATUS: Partial<Record<TaskProgressStatus, { label: string; tone: string }>> = {
  active: { label: 'Текущий', tone: 'brass' },
  available: { label: 'Доступен', tone: 'green' },
  locked: { label: 'Ещё не открыт', tone: '' },
}

/** «Ключи для квестов» (a player's proposal №52, owner 05.11.2026; quests/questKeys.ts). */
export function QuestKeysPage() {
  const { data } = useTarkovData()
  const state = useAppState()
  const { locale } = useLocale()
  const mode = state.raidMode
  const profileId = state.activeProfile.id
  const progress = state.activeProfile.modes[mode]
  const loyalty = useTraderLoyalty()
  const deferred = useDeferredQuests(profileId, mode, progress.playerLevel, loyalty)
  const [tab, setTab] = useState<QuestKeyState>('needed')
  const [query, setQuery] = useState('')
  const [mapId, setMapId] = useState('')
  const [request, setRequest] = useState<DeferRequest | null>(null)
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const availability = useMemo(() => questAvailabilityOf(data.quests, progress), [data.quests, progress])
  const rows = useMemo(() => questKeyRows(data.quests, items, progress, availability, deferred), [data.quests, items, progress, availability, deferred])
  const mapName = (id: string) => uiText(data.maps.find((map) => map.id === id)?.name ?? id)
  const needle = query.trim().toLowerCase()
  const matches = (row: QuestKeyRow) => (!mapId || row.mapIds.includes(mapId))
    && (!needle || [row.item.name, row.item.shortName, ...[...row.needed, ...row.deferred, ...row.done].map((use) => use.quest.name)].some((text) => uiText(text ?? '').toLowerCase().includes(needle)))
  const filtered = rows.filter(matches)
  const shown = filtered.filter((row) => row.state === tab)
  const maps = [...new Set(rows.flatMap((row) => row.mapIds))]
  const empty = TABS.find(({ id }) => id === tab)!.empty

  const deferOf = (row: QuestKeyRow, use: QuestKeyUse) => setRequest({
    item: { id: row.item.id, name: row.item.name, ...(row.item.iconUrl ? { iconUrl: row.item.iconUrl } : {}) },
    quests: row.needed.map(({ quest }) => ({ id: quest.id, name: quest.name })),
    chosen: [use.quest.id],
  })
  const questLink = (use: QuestKeyUse) => <Link to={`/quests?filter=${use.quest.kind === 'story' ? 'story' : 'all'}&selected=${encodeURIComponent(use.quest.id)}`}>{uiText(use.quest.name)}</Link>
  const questFacts = (use: QuestKeyUse) => `${uiText(use.quest.trader)}${use.quest.kind === 'story' ? '' : ` · ${locale === 'en' ? `level ${use.quest.level}` : `${use.quest.level} ур.`}`}`
  const altNames = (use: QuestKeyUse) => use.alternatives.map((id) => uiText(items.get(id)?.shortName ?? items.get(id)?.name ?? id)).join(', ')

  return <div className="page quest-keys-page">
    <header className="page-header"><div>
      <div className="eyebrow">{uiText('Квесты · ')}{uiText(mode.toUpperCase())}</div>
      <h1 className="page-title">{uiText('Ключи для квестов')}</h1>
      <p className="page-subtitle">{uiText('Ключ нужен, пока не выполнены цели, которые он открывает.')}</p>
    </div></header>
    <div className="filter-row quest-keys-filters">
      <div className="mode-switch" role="group" aria-label={uiText('Какие ключи показать')}>
        {TABS.map(({ id, label }) => <button type="button" key={id} className={tab === id ? 'active' : ''} aria-pressed={tab === id} onClick={() => setTab(id)}>{uiText(label)} · {filtered.filter((row) => row.state === id).length}</button>)}
      </div>
      <label className="quest-keys-search"><Search size={15} aria-hidden="true" /><input className="input" value={query} placeholder={uiText('Поиск ключа или квеста…')} aria-label={uiText('Поиск ключа или квеста…')} onChange={(event) => setQuery(event.target.value)} /></label>
      <select className="input quest-keys-map" value={mapId} aria-label={uiText('Карта')} onChange={(event) => setMapId(event.target.value)}>
        <option value="">{uiText('Все карты')}</option>
        {maps.map((id) => <option key={id} value={id}>{mapName(id)}</option>)}
      </select>
    </div>
    {tab === 'done' && shown.length > 0 && <p className="quest-keys-note">{uiText('Эти ключи больше не нужны: можно убрать их из избранного в игре.')}</p>}
    {shown.length === 0
      ? <p className="panel quest-keys-empty">{uiText(needle || mapId ? 'Ничего не найдено.' : empty)}</p>
      : <ul className="quest-keys-list">
        {shown.map((row) => <li key={row.item.id} className="panel quest-key">
          <div className="quest-key-head">
            <span className="quest-key-picture">{row.item.iconUrl ? <img src={row.item.iconUrl} alt="" loading="lazy" /> : <KeyRound size={22} aria-hidden="true" />}</span>
            <div className="quest-key-title">
              <strong>{uiText(row.item.name)}</strong>
              {row.mapIds.length > 0 && <small>{row.mapIds.map(mapName).join(' · ')}</small>}
            </div>
          </div>
          {row.needed.length > 0 && <ul className="quest-key-quests">{row.needed.map((use) => <li key={use.quest.id}>
            <span className="quest-key-quest">{questLink(use)}<small>{questFacts(use)}</small>{use.alternatives.length > 0 && <small>{uiText('или')}: {altNames(use)}</small>}</span>
            {use.status && STATUS[use.status] && <span className={`tag ${STATUS[use.status]!.tone}`}>{uiText(STATUS[use.status]!.label)}</span>}
            <button type="button" className="button small ghost" onClick={() => deferOf(row, use)}><Hourglass size={13} aria-hidden="true" />{uiText('Отложить')}</button>
          </li>)}</ul>}
          {row.deferred.length > 0 && <ul className="quest-key-quests is-deferred">{row.deferred.map((use) => <li key={use.quest.id}>
            <span className="quest-key-quest">{questLink(use)}<small>{deferralTermText(use.entry, locale) || uiText('бессрочно')}</small></span>
            <button type="button" className="button small ghost" onClick={() => restoreDeferredQuests(profileId, mode, [use.quest.id])}><Undo2 size={13} aria-hidden="true" />{uiText('Вернуть')}</button>
          </li>)}</ul>}
          {row.done.length > 0 && (row.state === 'done'
            ? <ul className="quest-key-quests is-done">{row.done.map((use) => <li key={use.quest.id}><span className="quest-key-quest"><Check size={13} aria-hidden="true" />{questLink(use)}</span></li>)}</ul>
            : <small className="quest-key-progress">{uiText('Выполнено')}: {row.done.length} {uiText('из')} {row.done.length + row.needed.length + row.deferred.length}</small>)}
        </li>)}
      </ul>}
    {request && <QuestDeferDialog request={request} onClose={() => setRequest(null)} />}
  </div>
}
