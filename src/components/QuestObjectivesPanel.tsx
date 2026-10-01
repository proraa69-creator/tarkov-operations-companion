import { useMemo, useState } from 'react'
import { AlertTriangle, Check, History, Minus, PencilLine, Plus, RotateCcw } from 'lucide-react'
import type { ObjectiveSource, ProgressEvent, Quest } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { canUndo, objectiveViews, questHistory, type ObjectiveView } from '../progression/objectiveProgress'
import { catalogStamp, isOverrideStale, objectiveNote, upsertObjectiveNote, useQuestOverrides } from '../progression/questOverrides'
import { useAppState } from '../state/AppState'
import './questObjectives.css'

const SOURCE_LABELS: Record<ObjectiveSource, string> = {
  log: 'журнал игры',
  ocr: 'с экрана',
  manual: 'вручную',
  sync: 'с сервера',
}

const STATUS_LABELS: Record<string, string> = { active: 'принято', completed: 'выполнено', failed: 'провалено' }

/**
 * Objectives of one trader quest in the current mode with checkboxes / counters the user can correct, the
 * «Журнал подтверждает выполнение» question and «История изменений» with «Отменить» for automatic changes.
 */
export function QuestObjectivesPanel({ quest }: { quest: Quest }) {
  const state = useAppState()
  const progress = state.activeProfile.modes[state.raidMode]
  const views = useMemo(() => objectiveViews(quest, progress), [quest, progress])
  const history = useMemo(() => questHistory(progress, quest.id, 30), [progress, quest.id])
  const descriptions = useMemo(() => new Map(views.map((view) => [view.def.id, view.def.description])), [views])

  if (!views.length) {
    return <div className="detail-section"><h4>{uiText('Цели')}</h4><p className="dim">{uiText('Подробные цели временно недоступны.')}</p></div>
  }
  const done = views.filter((view) => view.done).length

  return <>
    <div className="detail-section quest-objectives">
      <h4>{uiText('Цели')} <span className="quest-objectives-count">{done}/{views.length}</span> <span className="tag">{state.raidMode === 'seasonal' ? uiText('Сезон') : state.raidMode.toUpperCase()}</span></h4>
      <ol className="quest-objective-list">
        {views.map((view) => <ObjectiveRow key={view.def.id} quest={quest} view={view} />)}
      </ol>
      <p className="dim quest-objectives-hint">{uiText('Счётчики целей игра в журналы не пишет: поправьте их здесь. Задание, выполненное по журналу, отмечает все цели.')}</p>
    </div>
    <div className="detail-section quest-history">
      <h4><History size={14} /> {uiText('История изменений')}</h4>
      {history.length
        ? <ul className="quest-history-list">{history.map((event) => <HistoryRow key={event.id} event={event} description={event.objectiveId ? descriptions.get(event.objectiveId) : undefined} />)}</ul>
        : <p className="dim">{uiText('Изменений пока нет.')}</p>}
    </div>
  </>
}

function ObjectiveRow({ quest, view }: { quest: Quest; view: ObjectiveView }) {
  const state = useAppState()
  const { data } = useTarkovData()
  const { overrides, update } = useQuestOverrides()
  const [editing, setEditing] = useState(false)
  const note = objectiveNote(overrides, quest.id, view.def.id, state.raidMode)
  const [draft, setDraft] = useState('')
  const { def } = view
  const set = (value: number) => state.setObjectiveValue(def, Math.min(def.target, Math.max(0, value)))
  const text = def.description || quest.name

  return <li className={`quest-objective-row ${view.done ? 'is-done' : ''}`}>
    <div className="quest-objective-main">
      <label className="quest-objective-check">
        <input type="checkbox" checked={view.done} onChange={() => set(view.done ? 0 : def.target)} />
        <span className="quest-objective-box">{view.done && <Check size={12} />}</span>
        <span className="quest-objective-text">{uiText(text)}{def.optional && <small className="dim"> · {uiText('необязательно')}</small>}</span>
      </label>
      {def.target > 1 && <span className="quest-objective-counter">
        <button type="button" className="icon-button" onClick={() => set(view.current - 1)} disabled={view.current <= 0} aria-label={uiText('Меньше')}><Minus size={13} /></button>
        <strong>{view.current}/{def.target}</strong>
        <button type="button" className="icon-button" onClick={() => set(view.current + 1)} disabled={view.current >= def.target} aria-label={uiText('Больше')}><Plus size={13} /></button>
      </span>}
      <button type="button" className="icon-button quest-objective-note-button" onClick={() => { setDraft(note?.note ?? ''); setEditing((value) => !value) }} title={uiText('Заметка к цели')} aria-label={uiText('Заметка к цели')}><PencilLine size={13} /></button>
    </div>
    {view.source && <small className="quest-objective-source">{uiText(SOURCE_LABELS[view.source])}{view.derived ? ` · ${uiText('по статусу задания')}` : ''}</small>}
    {view.conflict && <div className="quest-objective-conflict" role="alert">
      <AlertTriangle size={14} />
      <span>{uiText('Журнал игры подтверждает выполнение задания, а цель отмечена вручную как невыполненная. Отметить её выполненной?')}</span>
      <button type="button" className="button" onClick={() => state.resolveObjectiveConflict(def.id, true)}>{uiText('Отметить')}</button>
      <button type="button" className="button ghost" onClick={() => state.resolveObjectiveConflict(def.id, false)}>{uiText('Оставить как есть')}</button>
    </div>}
    {note && !editing && <p className="quest-objective-note">
      {note.note}
      {isOverrideStale(note, data.metadata) && <small className="dim"> · {uiText('записано для прошлой версии данных — проверьте')}</small>}
    </p>}
    {editing && <form className="quest-objective-note-form" onSubmit={(event) => {
      event.preventDefault()
      update((list) => upsertObjectiveNote(list, { taskId: quest.id, objectiveId: def.id, mode: 'all', note: draft, catalog: catalogStamp(data.metadata) }))
      setEditing(false)
    }}>
      <textarea className="input" value={draft} maxLength={500} rows={2} onChange={(event) => setDraft(event.target.value)} placeholder={uiText('Своя заметка: ключ, путь, где лежит предмет…')} />
      <div className="quest-objective-note-actions">
        <button type="submit" className="button">{uiText('Сохранить')}</button>
        <button type="button" className="button ghost" onClick={() => setEditing(false)}>{uiText('Отмена')}</button>
      </div>
    </form>}
  </li>
}

function HistoryRow({ event, description }: { event: ProgressEvent; description?: string }) {
  const state = useAppState()
  const { locale } = useLocale()
  const when = new Date(event.observedAt).toLocaleString(locale === 'en' ? 'en-GB' : 'ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  const value = (raw: number | string | null) => raw === null ? '—' : typeof raw === 'string' ? uiText(STATUS_LABELS[raw] ?? raw) : String(raw)
  const what = event.eventType === 'task-status'
    ? uiText('Статус задания')
    : event.eventType === 'undo'
      ? uiText('Отмена изменения')
      : event.eventType === 'conflict-resolved'
        ? uiText('Ответ на вопрос журнала')
        : uiText('Цель')
  return <li className={`quest-history-row ${event.undoneAt ? 'is-undone' : ''}`}>
    <time dateTime={event.observedAt}>{when}</time>
    <span className="quest-history-what">
      <strong>{what}</strong>{description ? <> «{uiText(description)}»</> : null}: {value(event.oldValue)} → {value(event.newValue)}
      <small className="dim"> · {uiText(SOURCE_LABELS[event.source])}{event.undoneAt ? ` · ${uiText('отменено')}` : ''}</small>
    </span>
    {canUndo(event) && <button type="button" className="button ghost quest-history-undo" onClick={() => state.undoProgressEvent(event.id)}><RotateCcw size={13} /> {uiText('Отменить')}</button>}
  </li>
}
