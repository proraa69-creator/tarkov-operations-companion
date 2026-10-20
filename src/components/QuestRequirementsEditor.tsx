/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Package, Pencil, Plus, Search, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import {
  CURATED_KIND_LABEL, CURATED_KINDS, kindOfPurpose, QUEST_REQUIREMENT_COMMENT_MAX, restoreRequirementInput, useQuestRequirementOverrides, useQuestRequirementWriter,
  type QuestRequirementInput, type QuestRequirementOverride,
} from '../data/questRequirementOverrides'
import type { CuratedRequirementKind, Item, MapMarker, Quest } from '../domain/types'
import type { QuestPointEditorState } from './QuestPointEditor'
import { RaidOsMark } from './QuestCuratedInfo'
import './questEditor.css'

/** «Все» / «Предметы» / «Ключи» of the catalog picker. */
export type ItemFilter = 'all' | 'items' | 'keys'

export const isKeyItem = (item: Pick<Item, 'category' | 'types'>) => item.category === 'Ключ' || Boolean(item.types?.includes('keys'))
const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[-_.«»"]+/g, ' ').replace(/\s+/g, ' ').trim()

/** Catalog items matching the text (name, short name, English slug or id), keys / other items only when filtered. */
export function searchCatalogItems(items: Item[], text: string, filter: ItemFilter, limit = 40): Item[] {
  const query = normalize(text)
  const kept = items.filter((item) => (filter === 'all' || (filter === 'keys') === isKeyItem(item)))
  if (query.length < 2) return []
  const words = query.split(' ')
  const score = (item: Item) => {
    const name = normalize(item.name)
    const short = normalize(item.shortName ?? '')
    if (item.id === query) return 0
    if (short === query || name === query) return 1
    if (name.startsWith(query) || short.startsWith(query)) return 2
    return 3
  }
  return kept
    .filter((item) => {
      if (item.id === query) return true
      const haystack = `${normalize(item.name)} ${normalize(item.shortName ?? '')} ${normalize(item.normalizedName ?? '')}`
      return words.every((word) => haystack.includes(word))
    })
    .sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
}

/**
 * «Требования» of the quest constructor (owner, 15.10.2026: «функцию выбора предмета или ключа из каталога, что бы я в
 * реальном времени мог добавить требование квеста»): the quest's requirements as every player sees them, the catalog's
 * own ones with «Скрыть», the owner's ones to edit, reorder and remove, and «Добавить требование» with a searchable
 * picker over the catalog. Every change is saved on the server at once and reaches every app within the live update.
 */
export function QuestRequirementsEditor({ state, quest, items, markers }: { state: QuestPointEditorState; quest: Quest; items: Item[]; markers: MapMarker[] }) {
  const overrides = useQuestRequirementOverrides(true)
  const writer = useQuestRequirementWriter()
  const [picking, setPicking] = useState(false)
  /** The entry being edited: an override id, or `new:<item id>` for a new one. */
  const [editing, setEditing] = useState('')
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const mine = useMemo(() => overrides.filter((entry) => entry.questId === quest.id).sort((a, b) => a.position - b.position), [overrides, quest.id])
  const hidden = mine.filter((entry) => entry.op === 'hide')
  const shown = quest.raidRequirements ?? []
  const points = useMemo(() => markers.filter((marker) => marker.questId === quest.id && (marker.layerId === 'quest.zone' || marker.layerId === 'quest.item' || marker.type === 'quest')), [markers, quest.id])
  const name = (itemId: string) => itemsById.get(itemId)?.name ?? itemId

  const save = (input: QuestRequirementInput, label: string) => state.perform(label, async () => {
    const before = input.id ? mine.find((entry) => entry.id === input.id) : mine.find((entry) => entry.itemId === input.itemId && entry.kind === input.kind)
    const saved = await writer.save(input)
    if (before) return () => writer.save(restoreRequirementInput(before, saved?.id === before.id))
    if (saved) return () => writer.remove(saved.id)
  })
  const remove = (entry: QuestRequirementOverride, label: string) => state.perform(label, async () => {
    await writer.remove(entry.id)
    return () => writer.save(restoreRequirementInput(entry, false))
  })
  const move = (entry: QuestRequirementOverride, step: -1 | 1) => state.perform('порядок требований', async () => {
    const ids = mine.map((row) => row.id)
    const from = ids.indexOf(entry.id)
    const to = from + step
    if (from < 0 || to < 0 || to >= ids.length) return
    const next = [...ids];
    [next[from], next[to]] = [next[to], next[from]]
    await writer.reorder(quest.id, next)
    return () => writer.reorder(quest.id, ids)
  })
  const added = (itemId: string) => { setPicking(false); setEditing(`new:${itemId}`) }

  return (
    <div className="quest-req-editor">
      <small className="dim">{uiText('То, что нужно для квеста: игроки видят это в задании, на карте, в «Требованиях рейда» и в подсказке предмета.')}</small>
      <ul className="quest-req-list" aria-label={uiText('Требования квеста')}>
        {shown.map((requirement, index) => {
          const curated = requirement.curated
          const entry = curated ? mine.find((row) => row.id === curated.id) : undefined
          const item = itemsById.get(requirement.itemId)
          const key = curated ? curated.id : `${requirement.itemId}-${requirement.purpose}-${index}`
          const kind = curated?.kind ?? kindOfPurpose(requirement.purpose)
          return (
            <li key={key} className={`quest-req-row${curated ? ' is-curated' : ''}`}>
              {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-req-icon"><Package size={16} /></span>}
              <span className="quest-req-copy">
                <strong>{uiText(name(requirement.itemId))}{requirement.count > 1 ? ` ×${requirement.count}` : ''}{curated && <RaidOsMark />}</strong>
                <small>
                  {uiText(CURATED_KIND_LABEL[kind])}{requirement.foundInRaid ? ` · ${uiText('найден в рейде')}` : ''}
                  {curated?.replaced ? ` · ${uiText('исправлено')}` : curated ? '' : ` · ${uiText('из каталога')}`}
                </small>
                {curated?.comment && <small>{curated.comment}</small>}
              </span>
              <span className="quest-req-actions">
                {entry && <>
                  <button type="button" className="icon-button" disabled={state.busy || mine.indexOf(entry) === 0} onClick={() => void move(entry, -1)} title={uiText('Выше')} aria-label={uiText('Выше')}><ArrowUp size={13} /></button>
                  <button type="button" className="icon-button" disabled={state.busy || mine.indexOf(entry) === mine.length - 1} onClick={() => void move(entry, 1)} title={uiText('Ниже')} aria-label={uiText('Ниже')}><ArrowDown size={13} /></button>
                  <button type="button" className="icon-button" disabled={state.busy} onClick={() => setEditing(editing === entry.id ? '' : entry.id)} title={uiText('Изменить')} aria-label={uiText('Изменить')}><Pencil size={13} /></button>
                  <button type="button" className="icon-button" disabled={state.busy} onClick={() => void remove(entry, 'удаление требования')} title={uiText(curated?.replaced ? 'Вернуть как в каталоге' : 'Удалить')} aria-label={uiText(curated?.replaced ? 'Вернуть как в каталоге' : 'Удалить')}><Trash2 size={13} /></button>
                </>}
                {!curated && (
                  <button type="button" className="icon-button" disabled={state.busy} onClick={() => void save({ questId: quest.id, op: 'hide', itemId: requirement.itemId, kind, count: 1 }, 'скрытие требования')} title={uiText('Скрыть требование')} aria-label={uiText('Скрыть требование')}><EyeOff size={13} /></button>
                )}
              </span>
              {entry && editing === entry.id && (
                <RequirementForm
                  quest={quest} item={item} itemId={entry.itemId} entry={entry} points={points} busy={state.busy}
                  onSave={(input) => save({ ...input, id: entry.id }, 'изменение требования').then((ok) => { if (ok) setEditing('') })}
                  onCancel={() => setEditing('')}
                />
              )}
            </li>
          )
        })}
        {hidden.map((entry) => {
          const item = itemsById.get(entry.itemId)
          return (
            <li key={entry.id} className="quest-req-row is-hidden">
              {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-req-icon"><Package size={16} /></span>}
              <span className="quest-req-copy">
                <strong>{uiText(name(entry.itemId))}</strong>
                <small>{uiText(CURATED_KIND_LABEL[entry.kind])} · {uiText('скрыто')}</small>
              </span>
              <span className="quest-req-actions">
                <button type="button" className="icon-button" disabled={state.busy} onClick={() => void remove(entry, 'показ требования')} title={uiText('Показать снова')} aria-label={uiText('Показать снова')}><Eye size={13} /></button>
              </span>
            </li>
          )
        })}
        {!shown.length && !hidden.length && <li className="dim">{uiText('У квеста нет требований. Добавьте предмет или ключ из каталога.')}</li>}
      </ul>
      {editing.startsWith('new:') && (
        <div className="quest-req-row is-curated">
          <RequirementForm
            quest={quest} item={itemsById.get(editing.slice(4))} itemId={editing.slice(4)} points={points} busy={state.busy}
            onSave={(input) => save(input, 'новое требование').then((ok) => { if (ok) setEditing('') })}
            onCancel={() => setEditing('')}
          />
        </div>
      )}
      {picking
        ? <ItemPicker items={items} onPick={(item) => added(item.id)} onClose={() => setPicking(false)} />
        : <button type="button" className="button small" disabled={state.busy} onClick={() => { setPicking(true); setEditing('') }}><Plus size={13} />{uiText('Добавить требование')}</button>}
    </div>
  )
}

/** The searchable picker over the catalog: icon, name, category; «Все» / «Предметы» / «Ключи». */
export function ItemPicker({ items, onPick, onClose, initialFilter = 'all' }: { items: Item[]; onPick: (item: Item) => void; onClose: () => void; initialFilter?: ItemFilter }) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ItemFilter>(initialFilter)
  const results = useMemo(() => searchCatalogItems(items, query, filter), [items, query, filter])
  const filters: Array<[ItemFilter, string]> = [['all', 'Все'], ['items', 'Предметы'], ['keys', 'Ключи']]
  return (
    <div className="quest-item-picker" role="dialog" aria-label={uiText('Выбор предмета из каталога')}>
      <div className="quest-point-head">
        <strong>{uiText('Предмет или ключ из каталога')}</strong>
        <button type="button" className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
      </div>
      <label className="quest-point-search">
        <Search size={13} />
        <input className="input" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Название предмета или ключа (RU / EN)…')} aria-label={uiText('Найти предмет')} />
      </label>
      <div className="quest-item-picker-filters" role="group" aria-label={uiText('Фильтр каталога')}>
        {filters.map(([value, label]) => (
          <button key={value} type="button" className={`map-tool small${filter === value ? ' active' : ''}`} aria-pressed={filter === value} onClick={() => setFilter(value)}>{uiText(label)}</button>
        ))}
      </div>
      {query.trim().length >= 2 && !results.length && <small className="dim">{uiText('Ничего не найдено')}</small>}
      {query.trim().length < 2 && <small className="dim">{uiText('Введите хотя бы две буквы.')}</small>}
      <ul className="quest-item-results" aria-label={uiText('Предметы каталога')}>
        {results.map((item) => (
          <li key={item.id}>
            <button type="button" onClick={() => onPick(item)}>
              {item.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="quest-req-icon"><Package size={16} /></span>}
              <span><strong>{uiText(item.name)}</strong><small>{uiText(item.category)}{item.shortName && item.shortName !== item.name ? ` · ${item.shortName}` : ''}</small></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Kind, count, «найден в рейде», comment (RU / EN) and an optional objective or point of one requirement. */
function RequirementForm({ quest, item, itemId, entry, points, busy, onSave, onCancel }: {
  quest: Quest; item?: Item; itemId: string; entry?: QuestRequirementOverride; points: MapMarker[]; busy: boolean
  onSave: (input: QuestRequirementInput) => void; onCancel: () => void
}) {
  const [kind, setKind] = useState<CuratedRequirementKind>(entry?.kind ?? (item && isKeyItem(item) ? 'key' : 'bring'))
  const [count, setCount] = useState(String(entry?.count ?? 1))
  const [fir, setFir] = useState(entry?.foundInRaid ?? false)
  const [comment, setComment] = useState(entry?.comment ?? '')
  const [commentEn, setCommentEn] = useState(entry?.commentEn ?? '')
  const [link, setLink] = useState(entry?.pointId ? `p:${entry.pointId}` : entry?.objectiveId ? `o:${entry.objectiveId}` : '')
  const amount = Math.min(999, Math.max(1, Math.round(Number(count)) || 1))
  const firKind = kind === 'handover' || kind === 'find'
  const submit = () => {
    const point = link.startsWith('p:') ? points.find((marker) => marker.id === link.slice(2)) : undefined
    onSave({
      questId: quest.id, op: 'add', itemId, kind, count: amount,
      ...(firKind ? { foundInRaid: fir } : {}),
      ...(comment.trim() ? { comment: comment.trim().slice(0, QUEST_REQUIREMENT_COMMENT_MAX) } : {}),
      ...(commentEn.trim() ? { commentEn: commentEn.trim().slice(0, QUEST_REQUIREMENT_COMMENT_MAX) } : {}),
      ...(link.startsWith('o:') ? { objectiveId: link.slice(2) } : {}),
      ...(point ? { pointId: point.id, ...(point.objectiveId ? { objectiveId: point.objectiveId } : {}) } : {}),
    })
  }
  return (
    <form className="quest-req-form" onSubmit={(event) => { event.preventDefault(); if (!busy) submit() }} aria-label={uiText('Требование')}>
      <strong>{uiText(item?.name ?? itemId)}</strong>
      <div className="quest-req-form-row">
        <select className="input" value={kind} onChange={(event) => setKind(event.target.value as CuratedRequirementKind)} aria-label={uiText('Что сделать')}>
          {CURATED_KINDS.map((value) => <option key={value} value={value}>{uiText(CURATED_KIND_LABEL[value])}</option>)}
        </select>
        <label>{uiText('Кол-во')}<input className="input quest-req-count" type="number" min={1} max={999} value={count} onChange={(event) => setCount(event.target.value)} aria-label={uiText('Количество')} /></label>
        {firKind && <label><input type="checkbox" checked={fir} onChange={(event) => setFir(event.target.checked)} />{uiText('найден в рейде')}</label>}
      </div>
      {(quest.objectiveDetails?.length || points.length) ? (
        <select className="input" value={link} onChange={(event) => setLink(event.target.value)} aria-label={uiText('Привязка')}>
          <option value="">{uiText('Без привязки к цели или точке')}</option>
          {(quest.objectiveDetails ?? []).map((objective, index) => <option key={`${index}:${objective.id}`} value={`o:${objective.id}`}>{uiText(`Цель ${index + 1}`)}: {uiText(objective.description).slice(0, 70)}</option>)}
          {points.map((marker, index) => <option key={marker.id} value={`p:${marker.id}`}>{uiText(`Точка ${index + 1}`)} · {marker.mapId}{marker.hint?.title ? ` · ${marker.hint.title}` : ''}</option>)}
        </select>
      ) : null}
      <textarea className="input" rows={2} maxLength={QUEST_REQUIREMENT_COMMENT_MAX} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={uiText('Комментарий для игроков (необязательно)')} aria-label={uiText('Комментарий')} />
      <textarea className="input" rows={1} maxLength={QUEST_REQUIREMENT_COMMENT_MAX} value={commentEn} onChange={(event) => setCommentEn(event.target.value)} placeholder={uiText('Комментарий на английском (необязательно)')} aria-label={uiText('Комментарий на английском')} />
      <div className="quest-req-form-row">
        <button type="submit" className="button small primary" disabled={busy}>{uiText(entry ? 'Сохранить' : 'Добавить')}</button>
        <button type="button" className="button small ghost" onClick={onCancel}>{uiText('Отмена')}</button>
      </div>
    </form>
  )
}
