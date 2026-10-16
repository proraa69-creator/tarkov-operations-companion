import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, MapPinned, PencilRuler, Search } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import { EventQuestsEditor } from '../components/EventQuestsEditor'
import { useQuestPointOverrides } from '../data/questPointOverrides'
import { useQuestTextOverrides } from '../data/questTextOverrides'
import { useQuestRequirementOverrides } from '../data/questRequirementOverrides'
import type { MapMarker, Quest } from '../domain/types'

const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Quests whose name (RU or the EN slug) or id contains the text, the ones starting with it first. */
export function findQuests(quests: readonly Quest[], text: string, limit = 12): Quest[] {
  const query = normalize(text)
  if (query.length < 2) return []
  return quests
    .filter((quest) => normalize(quest.name).includes(query) || normalize(quest.normalizedName ?? '').includes(query) || quest.id.toLowerCase() === query)
    .sort((a, b) => Number(normalize(b.name).startsWith(query)) - Number(normalize(a.name).startsWith(query)) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
}

/** The map a quest opens on in the constructor: its own, else the one with most of its points. */
export function constructorMapOf(quest: Pick<Quest, 'id' | 'mapId' | 'mapIds'> | undefined, markers: readonly MapMarker[], questId = quest?.id) {
  if (quest?.mapId) return quest.mapId
  if (quest?.mapIds?.length) return quest.mapIds[0]
  const counts = new Map<string, number>()
  for (const marker of markers) if (marker.questId === questId) counts.set(marker.mapId, (counts.get(marker.mapId) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0]
}

/** The constructor on the map, on one quest (as «Заявки» → «Открыть в конструкторе») or on none. */
export const constructorUrl = (questId?: string, mapId?: string) => (questId
  ? `${mapId ? `/maps/${mapId}` : '/maps'}?quest=${encodeURIComponent(questId)}&edit=1`
  : '/maps?edit=1')

interface EditedQuest { questId: string; points: number; texts: number; requirements: number; updatedAt: string }

/** The owner's corrections per quest (points, texts, requirements), the latest first. */
export function editedQuests(points: ReadonlyArray<{ questId: string; updatedAt?: string }>, texts: ReadonlyArray<{ questId: string; updatedAt?: string }>, requirements: ReadonlyArray<{ questId: string; updatedAt?: string }>): EditedQuest[] {
  const byQuest = new Map<string, EditedQuest>()
  const add = (entries: ReadonlyArray<{ questId: string; updatedAt?: string }>, field: 'points' | 'texts' | 'requirements') => {
    for (const entry of entries) {
      const row = byQuest.get(entry.questId) ?? { questId: entry.questId, points: 0, texts: 0, requirements: 0, updatedAt: '' }
      row[field] += 1
      if ((entry.updatedAt ?? '') > row.updatedAt) row.updatedAt = entry.updatedAt ?? ''
      byQuest.set(entry.questId, row)
    }
  }
  add(points, 'points')
  add(texts, 'texts')
  add(requirements, 'requirements')
  return [...byQuest.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.questId.localeCompare(b.questId))
}

/**
 * «Квесты»: the event quests editor (a quest added here reaches every player at once, src/data/eventQuests.ts), the way
 * into the quest constructor on the map («Редактировать квесты»: points, texts, requirements; owned by the map page) and
 * the quests the owner already corrected there.
 */
export function AdminQuestsSection() {
  const { data } = useTarkovData()
  const navigate = useNavigate()
  const [events, setEvents] = useState(true)
  const [query, setQuery] = useState('')
  const points = useQuestPointOverrides()
  const texts = useQuestTextOverrides()
  const requirements = useQuestRequirementOverrides()
  const edited = useMemo(() => editedQuests(points, texts, requirements), [points, texts, requirements])
  const found = useMemo(() => findQuests(data.quests, query), [data.quests, query])
  const questById = useMemo(() => new Map(data.quests.map((quest) => [quest.id, quest])), [data.quests])
  const open = (questId?: string) => navigate(constructorUrl(questId, questId ? constructorMapOf(questById.get(questId), data.markers, questId) : undefined))

  return (
    <div className="admin-quests">
      <section className="panel admin-section" aria-labelledby="admin-constructor-title">
        <div className="panel-header">
          <div><div className="eyebrow">{uiLabel('Точки, тексты и требования квестов')}</div><div className="panel-title" id="admin-constructor-title">{uiLabel('Конструктор квестов')}</div></div>
          <PencilRuler size={18} className="brass" aria-hidden="true" />
        </div>
        <div className="panel-body admin-constructor">
          <p className="dim">{uiLabel('Изменения в конструкторе сохраняются сразу и видны всем игрокам — обновлять приложение или сервер не нужно.')}</p>
          <div className="admin-row">
            <button type="button" className="button small primary" onClick={() => open()}><MapPinned size={13} aria-hidden="true" />{uiLabel('Открыть конструктор на карте')}</button>
          </div>
          <label className="admin-search">
            <Search size={13} aria-hidden="true" />
            <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiLabel('Найти квест по названию (RU / EN)…')} aria-label={uiLabel('Найти квест')} />
          </label>
          {query.trim().length >= 2 && !found.length && <small className="dim">{uiLabel('Квест не найден')}</small>}
          {found.length > 0 && (
            <ul className="admin-list" aria-label={uiLabel('Найденные квесты')}>
              {found.map((quest) => (
                <li key={quest.id}>
                  <span><strong>{uiText(quest.name)}</strong><small className="dim">{uiText(quest.trader)} · {uiLabel('ур.')} {quest.level}</small></span>
                  <button type="button" className="button small ghost" onClick={() => open(quest.id)}><PencilRuler size={13} aria-hidden="true" />{uiLabel('Открыть в конструкторе')}</button>
                </li>
              ))}
            </ul>
          )}
          <div className="admin-subhead">{uiLabel('Квесты с вашими правками')} <span className="tag">{edited.length}</span></div>
          {!edited.length && <small className="dim">{uiLabel('Правок пока нет.')}</small>}
          {edited.length > 0 && (
            <ul className="admin-list admin-edited" aria-label={uiLabel('Квесты с вашими правками')}>
              {edited.slice(0, 50).map((row) => {
                const quest = questById.get(row.questId)
                const parts = [row.points && `${uiLabel('точек')}: ${row.points}`, row.texts && `${uiLabel('текстов')}: ${row.texts}`, row.requirements && `${uiLabel('требований')}: ${row.requirements}`].filter(Boolean).join(' · ')
                return (
                  <li key={row.questId}>
                    <span><strong>{quest ? uiText(quest.name) : row.questId}</strong><small className="dim">{parts}{row.updatedAt ? ` · ${new Date(row.updatedAt).toLocaleDateString()}` : ''}</small></span>
                    <button type="button" className="button small ghost" onClick={() => open(row.questId)}><PencilRuler size={13} aria-hidden="true" />{uiLabel('Открыть в конструкторе')}</button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </section>
      <section className="panel admin-section" aria-labelledby="admin-events-title">
        <div className="panel-header">
          <div><div className="eyebrow">{uiLabel('Появляются у всех игроков сразу')}</div><div className="panel-title" id="admin-events-title">{uiLabel('Ивент-квесты')}</div></div>
          <CalendarClock size={18} className="brass" aria-hidden="true" />
        </div>
        <div className="panel-body">
          {events
            ? <div className="quest-point-panel quest-editor-panel admin-event-quests"><EventQuestsEditor quests={data.quests} items={data.items} traders={data.traders} maps={data.maps} onClose={() => setEvents(false)} /></div>
            : <button type="button" className="button small primary" onClick={() => setEvents(true)}><CalendarClock size={13} aria-hidden="true" />{uiLabel('Открыть ивент-квесты')}</button>}
        </div>
      </section>
    </div>
  )
}
