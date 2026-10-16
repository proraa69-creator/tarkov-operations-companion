import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, MapPinned, PencilRuler, Search } from 'lucide-react'
import { uiLabel, uiText } from '../i18n/renderText'
import { useTarkovData } from '../data/DataProvider'
import { EventQuestsEditor } from '../components/EventQuestsEditor'
import { useQuestPointOverrides } from '../data/questPointOverrides'
import { useQuestTextOverrides } from '../data/questTextOverrides'
import { useQuestRequirementOverrides } from '../data/questRequirementOverrides'
import { constructorMapOf, constructorUrl, editedQuests, findQuests } from './adminQuests'

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
