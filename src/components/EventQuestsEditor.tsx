/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, Check, EyeOff, LoaderCircle, Package, Pencil, Plus, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { cleanIpcError } from '../sync/serverSync'
import type { GameMap, Item, Quest, RaidMode, Trader } from '../domain/types'
import type { CuratedText } from '../data/curatedQuests'
import {
  builtInEventQuests, definitionOfBuiltIn, EVENT_OBJECTIVE_TYPES, EVENT_QUEST_LIMITS as L, EVENT_QUEST_MODES, ITEM_OBJECTIVES, QUEST_ITEM_OBJECTIVES, SHOOT_TARGETS,
  type EventObjective, type EventObjectiveType, type EventQuestDefinition,
} from '../data/eventQuestDefinitions'
import { useEventQuests, useEventQuestWriter } from '../data/eventQuests'
import { ItemPicker } from './QuestRequirementsEditor'
import './questEditor.css'

/**
 * «Ивент-квесты» (owner app, owner, 16.10.2026: «добавь возможность обновить мне из админ приложения название потом и
 * вообще добавь в админ панели возможность добавлять ивент квесты и редактировать их»): the built-in event quests
 * (src/data/curatedQuests.ts) and the owner's own ones, each to edit in full — title, series, trader, modes, the event's
 * end, objectives with maps and catalog items, rewards, skills, the description. «Сохранить» writes the definition on the
 * server (server/src/routes/eventQuests.ts); every app shows it at once (src/data/eventQuests.ts).
 */
export const OBJECTIVE_LABEL: Record<EventObjectiveType, string> = {
  visit: 'Посетить место',
  extract: 'Выжить и выйти',
  shoot: 'Устранить цели',
  findItem: 'Найти предмет',
  giveItem: 'Передать предмет',
  plantItem: 'Установить предмет',
  findQuestItem: 'Найти квестовый предмет',
  giveQuestItem: 'Передать квестовый предмет',
  plantQuestItem: 'Установить квестовый предмет',
  useItem: 'Использовать предмет',
  transit: 'Совершить переход',
  hideout: 'Действие в убежище',
}
export const TARGET_LABEL: Record<(typeof SHOOT_TARGETS)[number], string> = {
  Any: 'Любые цели', AnyPmc: 'ЧВК', Usec: 'USEC', Bear: 'BEAR', Savage: 'Дикие', pmcBot: 'Рейдеры',
}
const MODE_LABEL: Record<RaidMode, string> = { pvp: 'PvP', pve: 'PvE', seasonal: 'Сезон' }

/** A new quest's id: never a game id, never a built-in one (the server checks the shape). */
export function newEventQuestId(random: () => number = Math.random) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return `raidos-event-${Array.from({ length: 10 }, () => alphabet[Math.floor(random() * alphabet.length)]).join('')}`
}

/** One row of the owner's list: a built-in quest (with the owner's version, if any) or the owner's own quest. */
export interface EventQuestRow {
  definition: EventQuestDefinition
  builtIn: boolean
  /** The owner saved a version of it (a built-in one is then «изменён»). */
  stored: boolean
}

/** The owner's list: the built-in event quests in their series' order, then the owner's own ones in the order made. */
export function eventQuestRows(stored: readonly EventQuestDefinition[]): EventQuestRow[] {
  const byId = new Map(stored.map((definition) => [definition.id, definition]))
  const builtIn = builtInEventQuests().map(({ series, quest }): EventQuestRow => {
    const mine = byId.get(quest.id)
    return { definition: mine ?? definitionOfBuiltIn(series, quest), builtIn: true, stored: Boolean(mine) }
  })
  const builtInIds = new Set(builtIn.map((row) => row.definition.id))
  return [...builtIn, ...stored.filter((definition) => !builtInIds.has(definition.id)).map((definition) => ({ definition, builtIn: false, stored: true }))]
}

/** A new quest: the series and trader of the last quest of the list, so the next quest of a running event is quick. */
export function newEventQuest(rows: readonly EventQuestRow[], id = newEventQuestId()): EventQuestDefinition {
  const last = rows[rows.length - 1]?.definition
  return {
    id,
    trader: last?.trader ?? '',
    name: { ru: '', en: '' },
    after: last ? [last.id] : [],
    experience: 0,
    objectives: [{ type: 'visit', text: { ru: '', en: '' } }],
    rewards: [],
    startRewards: [],
    skills: [],
    note: { ru: '', en: '' },
    modes: last ? [...last.modes] : [...EVENT_QUEST_MODES],
    series: last ? { name: { ...last.series.name }, route: { ...last.series.route } } : { name: { ru: '', en: '' }, route: { ru: '', en: '' } },
    ...(last?.endsAt ? { endsAt: last.endsAt } : {}),
  }
}

/** What «Сохранить» sends: trimmed, the item lists only where the objective uses them, no server bookkeeping. */
export function cleanDefinition(draft: EventQuestDefinition): EventQuestDefinition {
  const pair = (text: CuratedText) => ({ ru: text.ru.trim(), en: text.en.trim() })
  return {
    id: draft.id,
    trader: draft.trader,
    name: pair(draft.name),
    after: draft.after ?? [],
    experience: Math.max(0, Math.round(draft.experience) || 0),
    objectives: draft.objectives.map((objective) => {
      const items = ITEM_OBJECTIVES.has(objective.type) ? (objective.items ?? []).slice(0, QUEST_ITEM_OBJECTIVES.has(objective.type) ? 1 : L.objectiveItems) : []
      return {
        type: objective.type,
        text: pair(objective.text),
        ...(objective.count && objective.count > 1 ? { count: Math.min(L.count, Math.round(objective.count)) } : {}),
        ...(objective.optional ? { optional: true } : {}),
        ...(objective.maps?.length ? { maps: objective.maps } : {}),
        ...(items.length ? { items } : {}),
        ...(objective.foundInRaid && (objective.type === 'findItem' || objective.type === 'giveItem') ? { foundInRaid: true } : {}),
        ...(objective.type === 'shoot' ? { targets: objective.targets?.length ? objective.targets : ['Any'] } : {}),
      }
    }),
    rewards: draft.rewards ?? [],
    startRewards: draft.startRewards ?? [],
    skills: (draft.skills ?? []).map(pair).filter((skill) => skill.ru),
    note: pair(draft.note),
    modes: draft.modes,
    series: { name: pair(draft.series.name), route: pair(draft.series.route) },
    ...(draft.endsAt ? { endsAt: draft.endsAt } : {}),
    ...(draft.hidden ? { hidden: true } : {}),
  }
}

/** What is missing before the server would take it (shown instead of sending). */
export function definitionProblem(definition: EventQuestDefinition): string | undefined {
  if (!definition.name.ru) return 'Укажите название квеста (RU).'
  if (!definition.trader) return 'Выберите торговца.'
  if (!definition.series.name.ru) return 'Укажите название серии (RU).'
  if (!definition.modes.length) return 'Отметьте хотя бы один режим.'
  if (!definition.objectives.length) return 'Добавьте хотя бы одну цель.'
  if (definition.objectives.some((objective) => !objective.text.ru)) return 'У каждой цели должен быть текст (RU).'
  return undefined
}

/** ISO time ↔ the value of a `datetime-local` field (the owner's local time). */
export function localDateTime(iso: string | undefined) {
  const time = Date.parse(iso ?? '')
  if (!Number.isFinite(time)) return ''
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
const fromLocalDateTime = (value: string) => {
  const time = Date.parse(value)
  return value && Number.isFinite(time) ? new Date(time).toISOString() : undefined
}

function ownerError(reason: unknown) {
  const message = cleanIpcError(reason)
  if (/Не найдено|Неизвестный запрос/.test(message)) return 'Править ивент-квесты может только аккаунт владельца.'
  if (/Требуется вход|Сессия истекла/.test(message)) return 'Войдите в аккаунт владельца на сервере.'
  return message || 'Сервер недоступен'
}

export function EventQuestsEditor({ quests, items, traders, maps, onClose }: { quests: Quest[]; items: Item[]; traders: Trader[]; maps: GameMap[]; onClose: () => void }) {
  const stored = useEventQuests(true)
  const writer = useEventQuestWriter()
  const { locale } = useLocale()
  const rows = useMemo(() => eventQuestRows(stored ?? []), [stored])
  const [draft, setDraft] = useState<EventQuestRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [now] = useState(() => Date.now())
  const traderName = (id: string) => traders.find((trader) => trader.id === id)?.name ?? id
  const title = (text: CuratedText) => (locale === 'en' ? text.en || text.ru : text.ru) || '—'

  const act = async (label: string, action: () => Promise<void>) => {
    setBusy(true); setError(''); setSaved('')
    try { await action(); setSaved(label); return true } catch (reason) { setError(ownerError(reason)); return false } finally { setBusy(false) }
  }
  const save = (definition: EventQuestDefinition) => act('Сохранено — видят все игроки', () => writer.save(definition)).then((ok) => { if (ok) setDraft(null) })
  const remove = (row: EventQuestRow) => {
    const question = row.builtIn
      ? `${uiText('Вернуть исходный квест')} «${title(row.definition.name)}»? ${uiText('Ваши правки этого квеста удалятся.')}`
      : `${uiText('Удалить квест')} «${title(row.definition.name)}»? ${uiText('Игроки перестанут его видеть.')}`
    if (!window.confirm(question)) return
    void act(row.builtIn ? 'Возвращён исходный квест' : 'Квест удалён', () => writer.remove(row.definition.id)).then((ok) => { if (ok) setDraft(null) })
  }

  if (draft) {
    return (
      <div className="event-quests">
        <EventQuestForm
          key={draft.definition.id}
          row={draft} quests={quests} items={items} traders={traders} maps={maps} busy={busy}
          onSave={(definition) => void save(definition)}
          onRemove={draft.stored ? () => remove(draft) : undefined}
          onCancel={() => { setDraft(null); setError('') }}
        />
        {error && <small className="account-error">{uiText(error)}</small>}
      </div>
    )
  }
  return (
    <div className="event-quests">
      <div className="quest-point-head">
        <strong><CalendarClock size={14} /> {uiText('Ивент-квесты')}</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
      </div>
      <small className="dim">{uiText('Квесты ивентов, которых нет в tarkov.dev. Изменения сразу видят все игроки; квест с тем же названием из tarkov.dev заменяет наш.')}</small>
      {stored === undefined && <small className="dim">{uiText('Загрузка с сервера…')}</small>}
      <ul className="quest-req-list" aria-label={uiText('Ивент-квесты')}>
        {rows.map((row) => {
          const { definition } = row
          const over = Number.isFinite(Date.parse(definition.endsAt ?? '')) && Date.parse(definition.endsAt!) <= now
          const tags = [
            row.builtIn ? (row.stored ? 'с правками' : 'исходный') : 'свой квест',
            ...(definition.hidden ? ['скрыт у игроков'] : []),
            ...(over ? ['ивент завершён'] : []),
          ]
          return (
            <li key={definition.id} className={`quest-req-row event-quest-row${row.stored ? ' is-curated' : ''}${definition.hidden || over ? ' is-off' : ''}`}>
              <span className="quest-req-icon">{definition.hidden ? <EyeOff size={15} /> : <CalendarClock size={15} />}</span>
              <span className="quest-req-copy">
                <strong>{title(definition.name)}</strong>
                <small>{uiText(title(definition.series.name))} · {uiText(traderName(definition.trader))} · {definition.modes.map((mode) => uiText(MODE_LABEL[mode])).join(', ')}</small>
                <small>{tags.map((tag) => uiText(tag)).join(' · ')}</small>
              </span>
              <span className="quest-req-actions">
                <button type="button" className="icon-button" disabled={busy} onClick={() => { setDraft(row); setSaved(''); setError('') }} title={uiText('Изменить')} aria-label={`${uiText('Изменить')}: ${title(definition.name)}`}><Pencil size={13} /></button>
                {row.stored && (
                  <button type="button" className="icon-button" disabled={busy} onClick={() => remove(row)} title={uiText(row.builtIn ? 'Вернуть исходный' : 'Удалить')} aria-label={`${uiText(row.builtIn ? 'Вернуть исходный' : 'Удалить')}: ${title(definition.name)}`}>
                    {row.builtIn ? <RotateCcw size={13} /> : <Trash2 size={13} />}
                  </button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      <button type="button" className="button small" disabled={busy || stored === undefined} onClick={() => { setDraft({ definition: newEventQuest(rows), builtIn: false, stored: false }); setSaved(''); setError('') }}>
        <Plus size={13} />{uiText('Добавить квест')}
      </button>
      <div className="quest-editor-status" role="status" aria-live="polite">
        {busy && <LoaderCircle size={13} className="spin" aria-label={uiText('Сохранение…')} />}
        {!busy && saved && !error && <span className="quest-text-saved"><Check size={13} />{uiText(saved)}</span>}
        {error && <span className="account-error">{uiText(error)}</span>}
      </div>
    </div>
  )
}

/** Russian and English fields of one text. */
function TextPair({ label, value, max, onChange, multiline = false, required = false }: { label: string; value: CuratedText; max: number; onChange: (value: CuratedText) => void; multiline?: boolean; required?: boolean }) {
  const field = (lang: 'ru' | 'en') => {
    const props = {
      className: 'input',
      maxLength: max,
      value: value[lang],
      'aria-label': `${uiText(label)} (${lang.toUpperCase()})`,
      placeholder: lang === 'ru' ? 'RU' : uiText('EN (пусто — как RU)'),
    }
    const change = (text: string) => onChange({ ...value, [lang]: text })
    return multiline
      ? <textarea {...props} rows={lang === 'ru' ? 3 : 2} onChange={(event) => change(event.target.value)} />
      : <input {...props} onChange={(event) => change(event.target.value)} />
  }
  return (
    <fieldset className="event-quest-pair">
      <legend>{uiText(label)}{required ? ' *' : ''}</legend>
      {field('ru')}
      {field('en')}
    </fieldset>
  )
}

/** Items with counts (rewards, start rewards, an objective's items) and «Добавить» with the catalog picker. */
function ItemList({ label, entries, items, onChange, single = false, withCount = true }: {
  label: string; entries: Array<[string, number]>; items: Item[]; onChange: (entries: Array<[string, number]>) => void; single?: boolean; withCount?: boolean
}) {
  const [picking, setPicking] = useState(false)
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const full = single ? entries.length >= 1 : entries.length >= L.rewards
  return (
    <div className="event-quest-items">
      <span className="event-quest-label">{uiText(label)}</span>
      {entries.map(([id, count], index) => {
        const item = byId.get(id)
        return (
          <div key={`${id}-${index}`} className="event-quest-item">
            {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-req-icon"><Package size={14} /></span>}
            <span>{uiText(item?.name ?? id)}</span>
            {withCount && <input className="input quest-req-count" type="number" min={1} max={L.rewardCount} value={count} aria-label={`${uiText('Количество')}: ${item?.name ?? id}`}
              onChange={(event) => onChange(entries.map((entry, at) => (at === index ? [id, Math.max(1, Math.min(L.rewardCount, Math.round(Number(event.target.value)) || 1))] : entry)))} />}
            <button type="button" className="icon-button" onClick={() => onChange(entries.filter((_, at) => at !== index))} title={uiText('Убрать')} aria-label={`${uiText('Убрать')}: ${item?.name ?? id}`}><X size={12} /></button>
          </div>
        )
      })}
      {picking
        ? <ItemPicker items={items} onPick={(item) => { onChange([...entries, [item.id, 1]]); setPicking(false) }} onClose={() => setPicking(false)} />
        : !full && <button type="button" className="button small ghost" onClick={() => setPicking(true)}><Plus size={12} />{uiText('Добавить предмет')}</button>}
    </div>
  )
}

/** Previous quests: chips and a search over the catalog's quests. */
function PreviousQuests({ value, quests, self, onChange }: { value: string[]; quests: Quest[]; self: string; onChange: (value: string[]) => void }) {
  const [query, setQuery] = useState('')
  const byId = useMemo(() => new Map(quests.map((quest) => [quest.id, quest])), [quests])
  const results = useMemo(() => {
    const text = query.trim().toLowerCase().replace(/ё/g, 'е')
    if (text.length < 2) return []
    return quests.filter((quest) => quest.id !== self && !value.includes(quest.id)
      && [quest.name, quest.nameRu, quest.nameEn, quest.id].some((name) => name?.toLowerCase().replace(/ё/g, 'е').includes(text))).slice(0, 8)
  }, [quests, query, self, value])
  return (
    <div className="event-quest-items">
      <span className="event-quest-label">{uiText('Предыдущие квесты (нужно выполнить)')}</span>
      {value.map((id) => (
        <div key={id} className="event-quest-item">
          <span>{uiText(byId.get(id)?.name ?? id)}{byId.get(id) ? ` · ${uiText(byId.get(id)!.trader)}` : ''}</span>
          <button type="button" className="icon-button" onClick={() => onChange(value.filter((entry) => entry !== id))} title={uiText('Убрать')} aria-label={`${uiText('Убрать')}: ${byId.get(id)?.name ?? id}`}><X size={12} /></button>
        </div>
      ))}
      {value.length < L.previous && (
        <label className="quest-point-search">
          <Search size={13} />
          <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти квест по названию…')} aria-label={uiText('Найти предыдущий квест')} />
        </label>
      )}
      {results.length > 0 && (
        <ul className="quest-point-results">
          {results.map((quest) => (
            <li key={quest.id}><button type="button" onClick={() => { onChange([...value, quest.id]); setQuery('') }}><strong>{uiText(quest.name)}</strong><small className="dim">{uiText(quest.trader)}</small></button></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ObjectiveForm({ objective, index, total, items, maps, onChange, onMove, onRemove }: {
  objective: EventObjective; index: number; total: number; items: Item[]; maps: GameMap[]
  onChange: (objective: EventObjective) => void; onMove: (step: -1 | 1) => void; onRemove: () => void
}) {
  const set = (patch: Partial<EventObjective>) => onChange({ ...objective, ...patch })
  const itemList = (objective.items ?? []).map((id): [string, number] => [id, 1])
  const toggle = <T,>(list: T[] | undefined, value: T) => (list?.includes(value) ? list.filter((entry) => entry !== value) : [...(list ?? []), value])
  return (
    <div className="quest-req-form event-quest-objective">
      <div className="quest-req-form-row">
        <strong>{uiText(`Цель ${index + 1}`)}</strong>
        <select className="input" value={objective.type} onChange={(event) => set({ type: event.target.value as EventObjectiveType })} aria-label={`${uiText('Тип цели')} ${index + 1}`}>
          {EVENT_OBJECTIVE_TYPES.map((type) => <option key={type} value={type}>{uiText(OBJECTIVE_LABEL[type])}</option>)}
        </select>
        <label>{uiText('Кол-во')}<input className="input quest-req-count" type="number" min={1} max={L.count} value={objective.count ?? 1} onChange={(event) => set({ count: Math.max(1, Math.round(Number(event.target.value)) || 1) })} aria-label={`${uiText('Количество')} ${index + 1}`} /></label>
        <label><input type="checkbox" checked={objective.optional === true} onChange={(event) => set({ optional: event.target.checked })} />{uiText('необязательная')}</label>
        <span className="quest-req-actions">
          <button type="button" className="icon-button" disabled={index === 0} onClick={() => onMove(-1)} title={uiText('Выше')} aria-label={uiText('Выше')}><ArrowUp size={12} /></button>
          <button type="button" className="icon-button" disabled={index === total - 1} onClick={() => onMove(1)} title={uiText('Ниже')} aria-label={uiText('Ниже')}><ArrowDown size={12} /></button>
          <button type="button" className="icon-button" disabled={total === 1} onClick={onRemove} title={uiText('Удалить цель')} aria-label={`${uiText('Удалить цель')} ${index + 1}`}><Trash2 size={12} /></button>
        </span>
      </div>
      <TextPair label={`Текст цели ${index + 1}`} value={objective.text} max={L.objectiveText} required onChange={(text) => set({ text })} />
      <div className="event-quest-chips" role="group" aria-label={uiText('Карты')}>
        <span className="event-quest-label">{uiText('Карты')}</span>
        {maps.map((map) => (
          <button key={map.id} type="button" className={`map-tool small${objective.maps?.includes(map.id) ? ' active' : ''}`} aria-pressed={objective.maps?.includes(map.id) === true}
            onClick={() => set({ maps: toggle(objective.maps, map.id).slice(0, L.objectiveMaps) })}>{uiText(map.name)}</button>
        ))}
      </div>
      {objective.type === 'shoot' && (
        <div className="event-quest-chips" role="group" aria-label={uiText('Цели устранения')}>
          <span className="event-quest-label">{uiText('Кого устранить')}</span>
          {SHOOT_TARGETS.map((target) => (
            <button key={target} type="button" className={`map-tool small${objective.targets?.includes(target) ? ' active' : ''}`} aria-pressed={objective.targets?.includes(target) === true}
              onClick={() => set({ targets: toggle(objective.targets, target) })}>{uiText(TARGET_LABEL[target])}</button>
          ))}
        </div>
      )}
      {ITEM_OBJECTIVES.has(objective.type) && (
        <>
          <ItemList label={QUEST_ITEM_OBJECTIVES.has(objective.type) ? 'Квестовый предмет' : 'Предметы (любой из них)'} entries={itemList} items={items} withCount={false}
            single={QUEST_ITEM_OBJECTIVES.has(objective.type)} onChange={(entries) => set({ items: entries.map(([id]) => id).slice(0, L.objectiveItems) })} />
          {(objective.type === 'findItem' || objective.type === 'giveItem') && (
            <label className="event-quest-check"><input type="checkbox" checked={objective.foundInRaid === true} onChange={(event) => set({ foundInRaid: event.target.checked })} />{uiText('найден в рейде')}</label>
          )}
        </>
      )}
    </div>
  )
}

function EventQuestForm({ row, quests, items, traders, maps, busy, onSave, onRemove, onCancel }: {
  row: EventQuestRow; quests: Quest[]; items: Item[]; traders: Trader[]; maps: GameMap[]; busy: boolean
  onSave: (definition: EventQuestDefinition) => void; onRemove?: () => void; onCancel: () => void
}) {
  const [draft, setDraft] = useState<EventQuestDefinition>(row.definition)
  const [problem, setProblem] = useState('')
  const set = (patch: Partial<EventQuestDefinition>) => { setDraft((current) => ({ ...current, ...patch })); setProblem('') }
  const objectives = draft.objectives
  const setObjective = (index: number, objective: EventObjective) => set({ objectives: objectives.map((entry, at) => (at === index ? objective : entry)) })
  const moveObjective = (index: number, step: -1 | 1) => {
    const next = [...objectives]
    const to = index + step
    if (to < 0 || to >= next.length) return
    [next[index], next[to]] = [next[to], next[index]]
    set({ objectives: next })
  }
  const submit = () => {
    const clean = cleanDefinition(draft)
    const missing = definitionProblem(clean)
    if (missing) { setProblem(missing); return }
    onSave(clean)
  }
  const sortedTraders = [...traders].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  return (
    <form className="event-quest-form" aria-label={uiText('Ивент-квест')} onSubmit={(event) => { event.preventDefault(); if (!busy) submit() }}>
      <div className="quest-point-head">
        <strong>{uiText(row.builtIn ? (row.stored ? 'Ивент-квест (изменён)' : 'Ивент-квест (исходный)') : row.stored ? 'Свой ивент-квест' : 'Новый ивент-квест')}</strong>
        <button type="button" className="icon-button" onClick={onCancel} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
      </div>
      <TextPair label="Название" value={draft.name} max={L.name} required onChange={(name) => set({ name })} />
      <TextPair label="Серия" value={draft.series.name} max={L.seriesName} required onChange={(name) => set({ series: { ...draft.series, name } })} />
      <TextPair label="Подпись серии (например, «ивент до 20 октября»)" value={draft.series.route} max={L.route} onChange={(route) => set({ series: { ...draft.series, route } })} />
      <div className="quest-req-form-row">
        <label className="event-quest-field"><span className="event-quest-label">{uiText('Торговец')} *</span>
          <select className="input" value={draft.trader} onChange={(event) => set({ trader: event.target.value })} aria-label={uiText('Торговец')}>
            <option value="">{uiText('Выберите торговца')}</option>
            {sortedTraders.map((trader) => <option key={trader.id} value={trader.id}>{uiText(trader.name)}</option>)}
            {draft.trader && !traders.some((trader) => trader.id === draft.trader) && <option value={draft.trader}>{draft.trader}</option>}
          </select>
        </label>
        <label className="event-quest-field"><span className="event-quest-label">{uiText('Опыт')}</span>
          <input className="input" type="number" min={0} max={L.experience} value={draft.experience} onChange={(event) => set({ experience: Math.max(0, Math.round(Number(event.target.value)) || 0) })} aria-label={uiText('Опыт')} />
        </label>
      </div>
      <div className="event-quest-chips" role="group" aria-label={uiText('Режимы')}>
        <span className="event-quest-label">{uiText('Режимы')} *</span>
        {EVENT_QUEST_MODES.map((mode) => (
          <label key={mode} className="event-quest-check"><input type="checkbox" checked={draft.modes.includes(mode)}
            onChange={(event) => set({ modes: EVENT_QUEST_MODES.filter((entry) => (entry === mode ? event.target.checked : draft.modes.includes(entry))) })} />{uiText(MODE_LABEL[mode])}</label>
        ))}
      </div>
      <div className="quest-req-form-row">
        <label className="event-quest-field"><span className="event-quest-label">{uiText('Ивент до (ваше время; пусто — без окончания)')}</span>
          <input className="input" type="datetime-local" value={localDateTime(draft.endsAt)} onChange={(event) => set({ endsAt: fromLocalDateTime(event.target.value) })} aria-label={uiText('Окончание ивента')} />
        </label>
        <label className="event-quest-check"><input type="checkbox" checked={draft.hidden === true} onChange={(event) => set({ hidden: event.target.checked })} />{uiText('Скрыть квест у игроков')}</label>
      </div>
      <PreviousQuests value={draft.after ?? []} quests={quests} self={draft.id} onChange={(after) => set({ after })} />
      <span className="event-quest-label">{uiText('Цели')}</span>
      {objectives.map((objective, index) => (
        <ObjectiveForm key={index} objective={objective} index={index} total={objectives.length} items={items} maps={maps}
          onChange={(next) => setObjective(index, next)} onMove={(step) => moveObjective(index, step)} onRemove={() => set({ objectives: objectives.filter((_, at) => at !== index) })} />
      ))}
      {objectives.length < L.objectives && (
        <button type="button" className="button small ghost" onClick={() => set({ objectives: [...objectives, { type: 'visit', text: { ru: '', en: '' } }] })}><Plus size={12} />{uiText('Добавить цель')}</button>
      )}
      <ItemList label="Награда" entries={draft.rewards ?? []} items={items} onChange={(rewards) => set({ rewards })} />
      <ItemList label="Выдаётся при взятии задания" entries={draft.startRewards ?? []} items={items} onChange={(startRewards) => set({ startRewards })} />
      <div className="event-quest-items">
        <span className="event-quest-label">{uiText('Навыки в награде (например, «Хирургия +1 уровень»)')}</span>
        {(draft.skills ?? []).map((skill, index) => (
          <div key={index} className="event-quest-skill">
            <input className="input" maxLength={L.skill} value={skill.ru} onChange={(event) => set({ skills: draft.skills!.map((entry, at) => (at === index ? { ...entry, ru: event.target.value } : entry)) })} aria-label={`${uiText('Навык')} ${index + 1} (RU)`} placeholder="RU" />
            <input className="input" maxLength={L.skill} value={skill.en} onChange={(event) => set({ skills: draft.skills!.map((entry, at) => (at === index ? { ...entry, en: event.target.value } : entry)) })} aria-label={`${uiText('Навык')} ${index + 1} (EN)`} placeholder="EN" />
            <button type="button" className="icon-button" onClick={() => set({ skills: draft.skills!.filter((_, at) => at !== index) })} title={uiText('Убрать')} aria-label={`${uiText('Убрать')}: ${uiText('Навык')} ${index + 1}`}><X size={12} /></button>
          </div>
        ))}
        {(draft.skills?.length ?? 0) < L.skills && <button type="button" className="button small ghost" onClick={() => set({ skills: [...(draft.skills ?? []), { ru: '', en: '' }] })}><Plus size={12} />{uiText('Добавить навык')}</button>}
      </div>
      <TextPair label="Описание для игроков" value={draft.note} max={L.note} multiline onChange={(note) => set({ note })} />
      {problem && <small className="account-error">{uiText(problem)}</small>}
      <div className="quest-req-form-row">
        <button type="submit" className="button small primary" disabled={busy}>{busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{uiText('Сохранить')}</button>
        <button type="button" className="button small ghost" onClick={onCancel}>{uiText('Отмена')}</button>
        {onRemove && (
          <button type="button" className="button small ghost" disabled={busy} onClick={onRemove}>
            {row.builtIn ? <RotateCcw size={13} /> : <Trash2 size={13} />}{uiText(row.builtIn ? 'Вернуть исходный' : 'Удалить')}
          </button>
        )}
      </div>
    </form>
  )
}
