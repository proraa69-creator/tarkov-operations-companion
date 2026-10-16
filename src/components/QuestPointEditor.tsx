/* eslint-disable react-refresh/only-export-components */
import { uiText } from '../i18n/renderText'
import { useCallback, useMemo, useState } from 'react'
import { CircleMarker, Tooltip, useMapEvents } from 'react-leaflet'
import { CalendarClock, Check, Crosshair, EyeOff, FileText, LoaderCircle, MapPinPlus, PencilRuler, RotateCcw, Search, SlidersHorizontal, Undo2, X } from 'lucide-react'
import { isOwnerApp } from '../app/buildEdition'
import { cleanIpcError } from '../sync/serverSync'
import { addedOverrideIdOf, hasPointText, OWNER_QUEST_POINT_SOURCE, QUEST_POINT_DESCRIPTION_MAX, QUEST_POINT_TITLE_MAX, useQuestPointOverrides, useQuestPointWriter, type QuestPointInput, type QuestPointOverride } from '../data/questPointOverrides'
import { isQuestIcon, type QuestPointIcon } from '../shared/questPointConstructor'
import type { GameMap, Item, MapMarker, Quest, Trader } from '../domain/types'
import { QuestTextEditor } from './QuestTextEditor'
import { QuestRequirementsEditor } from './QuestRequirementsEditor'
import { EventQuestsEditor } from './EventQuestsEditor'
import './questEditor.css'

/**
 * The quest constructor «Редактировать квесты» (owner app only, server/src/routes/questPoints.ts): find a quest in the
 * list or by name, pick its objective / story stage, drag a wrong point to the right place, click the map to add a
 * point, hide a wrong one or return the original. Every change is saved at once and every player's map shows it
 * (src/data/questPointOverrides.ts). The floor selected on the map goes with a moved / added point when it is not the
 * main level. The quest's texts are edited in the quest window at the bottom (components/QuestTextEditor.tsx).
 */
/** The player-facing description of a point and the owner's own note, as the constructor's form edits them. */
export interface PointTexts { title?: string; titleEn?: string; description?: string; descriptionEn?: string; note?: string }
/** The constructor's sections for the picked quest. */
export type QuestEditorTab = 'points' | 'texts' | 'requirements'
/** What «Отменить» does: the last saved change undone on the server. */
export interface EditorUndo { label: string; run: () => Promise<unknown> }
/**
 * A point placed with no quest picked: empty and not saved yet (owner, 16.10.2026: «ставлю точку, она пустая. жму
 * правой кнопкой. открывается окно»); its window saves it.
 */
export interface DraftPoint { id: string; mapId: string; x: number; z: number; floor?: string }
/** What the point menu and the point window are about: a point drawn on the map, or a draft. */
export type PointTarget = { marker: MapMarker; draft?: undefined } | { draft: DraftPoint; marker?: undefined }
/**
 * Everything the point window sets (components/PointConstructor.tsx): the emblem; for a quest emblem the quest and its
 * objective / stage (`goal`: '' | `o:<objective id>` | `s:<stage index>`); the texts; catalog items and photos.
 */
export interface PointSettings extends PointTexts { icon: QuestPointIcon; questId: string; goal: string; itemIds: string[]; photoIds: string[] }

/**
 * `initialQuestId`: open the constructor on that quest (the owner's «Заявки» → «Открыть в конструкторе»,
 * ?quest=<id>&edit=1). `initialActive`: open it with no quest picked (the «Админ панель» → «Открыть конструктор на
 * карте», ?edit=1 alone).
 */
export function useQuestPointEditor({ mapId, floor, baseFloor, quests, markers, initialQuestId, initialActive = false }: { mapId: string; floor: string; baseFloor: string; quests: Quest[]; markers: MapMarker[]; initialQuestId?: string; initialActive?: boolean }) {
  const enabled = isOwnerApp()
  const overrides = useQuestPointOverrides(enabled)
  const writer = useQuestPointWriter()
  const [active, setActive] = useState(Boolean(initialQuestId) || initialActive)
  const [questId, setQuestId] = useState(initialQuestId ?? '')
  /** '' = all points; `o:<objective id>`; `s:<stage index>`. */
  const [goal, setGoal] = useState('')
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  /** «Сохранено» after the last change went through; cleared when the next one starts. */
  const [saved, setSaved] = useState(false)
  const [lastUndo, setLastUndo] = useState<EditorUndo | null>(null)
  const [tab, setTab] = useState<QuestEditorTab>('points')
  /** Empty points placed with no quest picked (this session only, until their window saves them). */
  const [drafts, setDrafts] = useState<DraftPoint[]>([])
  /** The right-click menu of a point (screen position) and the point whose window is open (`icon`: the emblem picked in the menu). */
  const [menu, setMenu] = useState<{ target: PointTarget; x: number; y: number } | null>(null)
  const [editing, setEditing] = useState<{ target: PointTarget; icon?: QuestPointIcon } | null>(null)

  const quest = questId ? quests.find((entry) => entry.id === questId) : undefined
  const byMarker = useMemo(() => new Map(overrides.filter((entry) => entry.kind !== 'add' && entry.markerId).map((entry) => [entry.markerId!, entry])), [overrides])
  /** Plotted points of every quest: questId → mapId → count (search results and «other maps»). */
  const pointCounts = useMemo(() => {
    const counts = new Map<string, Map<string, number>>()
    for (const marker of markers) {
      if (!marker.questId || !isQuestPoint(marker)) continue
      const perMap = counts.get(marker.questId) ?? new Map<string, number>()
      perMap.set(marker.mapId, (perMap.get(marker.mapId) ?? 0) + 1)
      counts.set(marker.questId, perMap)
    }
    return counts
  }, [markers])
  const goalMatches = useCallback((entry: { objectiveId?: string; stageIndex?: number }) => !goal
    || (goal.startsWith('o:') && entry.objectiveId === goal.slice(2))
    || (goal.startsWith('s:') && entry.stageIndex === Number(goal.slice(2))), [goal])
  /** The edited quest's points on this map (of the chosen objective / stage). */
  const points = useMemo(() => (active && questId ? markers.filter((marker) => marker.questId === questId && marker.mapId === mapId && isQuestPoint(marker) && goalMatches(marker)) : []),
    [active, questId, markers, mapId, goalMatches])
  /** Hidden points of the quest on this map: drawn greyed out, a click returns them. */
  const hidden = useMemo(() => (active && questId ? overrides.filter((entry) => entry.kind === 'hide' && entry.questId === questId && entry.mapId === mapId && goalMatches(entry)) : []),
    [active, questId, overrides, mapId, goalMatches])

  /**
   * Runs one change of the constructor (points here, requirements in QuestRequirementsEditor.tsx): saved at once, then
   * «Сохранено»; an error is shown. The undo it returns becomes «Отменить». True when the server accepted it.
   */
  const perform = async (label: string, action: () => Promise<(() => Promise<unknown>) | void>) => {
    setBusy(true); setError(''); setSaved(false)
    try {
      const undo = await action()
      setLastUndo(undo ? { label, run: undo } : null)
      setSaved(true)
      return true
    } catch (reason) { setError(ownerError(reason)); return false } finally { setBusy(false) }
  }
  const run = (action: () => Promise<(() => Promise<unknown>) | void>, label = 'изменение точки') => perform(label, action)
  /** «Отменить»: the last change is undone on the server (once). */
  const undo = () => {
    const last = lastUndo
    if (!last) return Promise.resolve(false)
    return perform('', async () => { await last.run() })
  }
  /** How to bring a point's correction back as it was before a change (`after`: what the change saved, if anything). */
  const undoPoint = (before: QuestPointOverride | undefined, after: QuestPointOverride | undefined) => {
    if (before) return () => writer.save(restoreInput(before, after?.id === before.id))
    if (after) return () => writer.reset(after.id)
    return undefined
  }
  const floorField = () => (floor !== baseFloor ? { floor } : {})
  /** The note typed in the panel, else the point's own note (a move keeps it). */
  const noteField = (existing?: QuestPointOverride) => {
    const text = note.trim().slice(0, 300) || existing?.note
    return text ? { note: text } : {}
  }
  const goalField = (marker?: MapMarker) => {
    if (marker) return { ...(marker.objectiveId ? { objectiveId: marker.objectiveId } : {}), ...(marker.stageIndex != null ? { stageIndex: marker.stageIndex } : {}) }
    return goalOf(goal)
  }
  const addedOverride = (marker: MapMarker) => {
    const id = addedOverrideIdOf(marker)
    return id ? overrides.find((entry) => entry.id === id) : undefined
  }

  /** Drag and drop: saved at once. An added point keeps its id; a catalog point gets (or updates) its «move». */
  const move = (marker: MapMarker, x: number, z: number) => run(async () => {
    const added = addedOverride(marker)
    if (!added && !marker.questId) return
    const before = added ?? byMarker.get(marker.id)
    const input: QuestPointInput = added
      ? { ...stripMeta(added), x: round(x), z: round(z), ...floorField(), ...noteField(added) }
      : { questId: marker.questId ?? '', markerId: marker.id, mapId: marker.mapId, x: round(x), z: round(z), kind: 'move', ...goalField(marker), ...floorField(), ...textFields(before), ...noteField(before) }
    if (added && floor === baseFloor) delete input.floor
    return undoPoint(before, await writer.save(input))
  }, 'перенос точки')
  /**
   * «Добавить точку»: a click on the map while adding. With a quest picked the point is saved at once for that quest and
   * the objective / stage chosen above (never the quest's first one); without one it is an empty draft that its
   * right-click window sets up.
   */
  const add = (x: number, z: number) => {
    if (!questId) {
      setDrafts((list) => [...list, { id: `draft-${Date.now().toString(36)}-${list.length}`, mapId, x: round(x), z: round(z), ...floorField() }])
      return Promise.resolve(true)
    }
    return run(async () => {
      const saved = await writer.save({ questId, mapId, x: round(x), z: round(z), kind: 'add', ...goalField(), ...floorField(), ...noteField() })
      return undoPoint(undefined, saved)
    }, 'новая точка')
  }
  /** «Скрыть»: a catalog point is hidden (where it stood is kept); an added point is simply deleted. */
  const hide = (marker: MapMarker) => run(async () => {
    const added = addedOverride(marker)
    if (added) { await writer.reset(added.id); return undoPoint(added, undefined) }
    if (!marker.questId) return
    const before = byMarker.get(marker.id)
    const saved = await writer.save({ questId: marker.questId, markerId: marker.id, mapId: marker.mapId, x: round(marker.position[1]), z: round(marker.position[0]), kind: 'hide', ...goalField(marker), ...(marker.floor && marker.floor !== baseFloor ? { floor: marker.floor } : {}), ...textFields(before), ...noteField(before) })
    return undoPoint(before, saved)
  }, 'скрытие точки')
  /**
   * «Вернуть исходную»: the correction is removed (an added point disappears). A moved / hidden point with a description
   * goes back to its place and keeps the description («describe»).
   */
  const reset = (overrideId: string) => run(async () => {
    const before = overrides.find((entry) => entry.id === overrideId)
    if (before && (before.kind === 'move' || before.kind === 'hide') && hasPointText(before)) {
      const saved = await writer.save({ ...restoreInput(before, true), kind: 'describe' })
      return undoPoint(before, saved)
    }
    await writer.reset(overrideId)
    return undoPoint(before, undefined)
  }, 'возврат точки')
  /**
   * The point window's «Сохранить» (components/PointConstructor.tsx): a draft becomes a saved point; a point the owner
   * added takes every setting (another quest, a free point with another emblem…); an original quest point keeps its
   * quest and place and takes the objective / stage, the quest emblem (zone / item), the texts, items and photos.
   */
  const configure = (target: PointTarget, settings: PointSettings) => run(async () => {
    const { note: ownNote, ...shown } = cleanTexts(settings)
    const quest = isQuestIcon(settings.icon) ? settings.questId : ''
    if (isQuestIcon(settings.icon) && !quest) throw new Error('Выберите квест для точки квеста.')
    const fields = {
      icon: settings.icon, ...(quest ? goalOf(settings.goal) : {}), ...shown, ...(ownNote ? { note: ownNote } : {}),
      ...(settings.itemIds.length ? { itemIds: settings.itemIds } : {}), ...(settings.photoIds.length ? { photoIds: settings.photoIds } : {}),
    }
    if (target.draft) {
      const { draft } = target
      const saved = await writer.save({ questId: quest, mapId: draft.mapId, x: draft.x, z: draft.z, ...(draft.floor ? { floor: draft.floor } : {}), kind: 'add', ...fields })
      setDrafts((list) => list.filter((entry) => entry.id !== draft.id))
      return undoPoint(undefined, saved)
    }
    const { marker } = target
    const added = addedOverride(marker)
    if (added) {
      const saved = await writer.save({ id: added.id, questId: quest, mapId: added.mapId, x: added.x, z: added.z, ...(added.floor ? { floor: added.floor } : {}), kind: 'add', ...fields })
      return undoPoint(added, saved)
    }
    if (!marker.questId) throw new Error('Эту точку карты изменить нельзя: она из каталога, а не из конструктора.')
    if (!isQuestIcon(settings.icon)) throw new Error('У исходной точки квеста значок только квестовый. Для другой точки поставьте новую.')
    const before = byMarker.get(marker.id)
    const own = { ...goalOf(settings.goal), ...(settings.icon !== marker.layerId || before?.icon ? { icon: settings.icon } : {}), ...shown, ...(ownNote ? { note: ownNote } : {}),
      ...(settings.itemIds.length ? { itemIds: settings.itemIds } : {}), ...(settings.photoIds.length ? { photoIds: settings.photoIds } : {}) }
    const input: QuestPointInput = before
      ? { id: before.id, questId: before.questId, markerId: marker.id, mapId: before.mapId, x: before.x, z: before.z, ...(before.floor ? { floor: before.floor } : {}), kind: before.kind, ...own }
      : { questId: marker.questId, markerId: marker.id, mapId: marker.mapId, x: round(marker.position[1]), z: round(marker.position[0]), ...(marker.floor && marker.floor !== baseFloor ? { floor: marker.floor } : {}), kind: 'describe', ...own }
    return undoPoint(before, await writer.save(input))
  }, 'настройка точки')
  /** The menu's «Удалить»: a draft or an added point goes, an original point is hidden. */
  const remove = (target: PointTarget) => {
    if (target.draft) { setDrafts((list) => list.filter((entry) => entry.id !== target.draft.id)); return Promise.resolve(true) }
    return hide(target.marker)
  }
  /** The correction behind a point drawn on the map, if any. */
  const overrideOf = (marker: MapMarker): QuestPointOverride | undefined => addedOverride(marker) ?? byMarker.get(marker.id)
  /** A point the constructor sets up: a quest point, or a point the owner added (a free one too). */
  const canEdit = (marker: MapMarker) => enabled && (marker.source === OWNER_QUEST_POINT_SOURCE || (Boolean(marker.questId) && isQuestPoint(marker)))
  /** A marker on the map that the owner can drag right now. */
  const canDrag = (marker: MapMarker) => active && !busy && (
    (Boolean(questId) && marker.questId === questId && isQuestPoint(marker))
    // A free point the owner placed (an extract, a transit…) moves too.
    || (marker.source === OWNER_QUEST_POINT_SOURCE && !marker.questId))
  const pick = (id: string) => { setQuestId(id); setGoal(''); setAdding(false); setError(''); setSaved(false); setLastUndo(null); setTab('points'); setEditing(null) }
  /** The right-click menu of a point at a screen position (owner app). */
  const openMenu = (target: PointTarget, x: number, y: number) => { setMenu({ target, x, y }); setError('') }
  /** The point window (`icon`: an emblem picked in the menu). */
  const openSettings = (target: PointTarget, icon?: QuestPointIcon) => { setMenu(null); setError(''); setSaved(false); setEditing({ target, ...(icon ? { icon } : {}) }) }

  return {
    enabled, active: enabled && active, setActive: (value: boolean) => { setActive(value); if (!value) setAdding(false) },
    questId, quest, pick, goal, setGoal, adding: enabled && active && adding, setAdding, note, setNote,
    busy, error, points, hidden, pointCounts, overrides, move, add, hide, reset, overrideOf, canDrag, mapId, floor, baseFloor,
    tab, setTab, saved, perform, undo, lastUndo,
    drafts: drafts.filter((entry) => entry.mapId === mapId), configure, remove, canEdit,
    menu, openMenu, closeMenu: () => setMenu(null), editing, openSettings, closeSettings: () => setEditing(null),
    /** While a quest is being edited, the map shows only its points (all of them, on every floor). */
    editingQuest: enabled && active && questId ? questId : '',
    shows: goalMatches,
  }
}

export type QuestPointEditorState = ReturnType<typeof useQuestPointEditor>

const QUEST_SOURCES_EXCLUDED = new Set(['quest-fallback', 'quest-any-map', 'quest-info'])
const isQuestPoint = (marker: MapMarker) => (marker.type === 'quest' || marker.layerId === 'quest.zone' || marker.layerId === 'quest.item') && !QUEST_SOURCES_EXCLUDED.has(marker.source ?? '')
const round = (value: number) => Math.round(value * 10) / 10
/** `o:<objective id>` / `s:<stage index>` as the saved fields. */
function goalOf(goal: string): Pick<QuestPointInput, 'objectiveId' | 'stageIndex'> {
  if (goal.startsWith('o:') && goal.length > 2) return { objectiveId: goal.slice(2) }
  if (goal.startsWith('s:') && Number.isInteger(Number(goal.slice(2)))) return { stageIndex: Number(goal.slice(2)) }
  return {}
}
/** A point's objective / stage as the constructor's `goal` key. */
export const goalKeyOf = (entry: { objectiveId?: string; stageIndex?: number } | undefined) =>
  entry?.objectiveId ? `o:${entry.objectiveId}` : entry?.stageIndex != null ? `s:${entry.stageIndex}` : ''
function stripMeta(entry: QuestPointOverride): QuestPointInput {
  const input: QuestPointInput & Partial<Pick<QuestPointOverride, 'updatedAt' | 'updatedBy'>> = { ...entry }
  delete input.updatedAt
  delete input.updatedBy
  delete input.note
  return input
}
/** A correction as it was, to save it again (its id when it still exists; the note too). */
function restoreInput(entry: QuestPointOverride, keepId: boolean): QuestPointInput {
  const input = { ...stripMeta(entry), ...(entry.note ? { note: entry.note } : {}) }
  if (!keepId) delete input.id
  return input
}
/** A point's description, emblem, items and photos, carried along when the point is moved or hidden. */
function textFields(entry?: QuestPointOverride): Pick<QuestPointInput, 'title' | 'titleEn' | 'description' | 'descriptionEn' | 'icon' | 'itemIds' | 'photoIds'> {
  if (!entry) return {}
  return {
    ...(entry.title ? { title: entry.title } : {}), ...(entry.titleEn ? { titleEn: entry.titleEn } : {}),
    ...(entry.description ? { description: entry.description } : {}), ...(entry.descriptionEn ? { descriptionEn: entry.descriptionEn } : {}),
    ...(entry.icon ? { icon: entry.icon } : {}), ...(entry.itemIds?.length ? { itemIds: entry.itemIds } : {}), ...(entry.photoIds?.length ? { photoIds: entry.photoIds } : {}),
  }
}
/** Trimmed texts, empty ones dropped, cut to the server's limits. */
export function cleanTexts(texts: PointTexts): PointTexts {
  const line = (value: string | undefined, max: number) => value?.replace(/\s*\n\s*/g, ' ').trim().slice(0, max) || undefined
  const block = (value: string | undefined, max: number) => value?.trim().slice(0, max) || undefined
  const out: PointTexts = {
    title: line(texts.title, QUEST_POINT_TITLE_MAX), titleEn: line(texts.titleEn, QUEST_POINT_TITLE_MAX),
    description: block(texts.description, QUEST_POINT_DESCRIPTION_MAX), descriptionEn: block(texts.descriptionEn, QUEST_POINT_DESCRIPTION_MAX),
    note: block(texts.note, 300),
  }
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value)) as PointTexts
}
const normalize = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()

function ownerError(reason: unknown) {
  const message = cleanIpcError(reason)
  if (/Не найдено|Неизвестный запрос/.test(message)) return 'Править точки квестов может только аккаунт владельца.'
  if (/Требуется вход|Сессия истекла/.test(message)) return 'Войдите в аккаунт владельца на сервере.'
  return message || 'Сервер недоступен'
}

/** Quests whose name (RU or EN slug) or id contains the text; quests with points on this map first. */
export function searchQuests(quests: Quest[], text: string, mapId: string, counts: Map<string, Map<string, number>>, limit = 12): Quest[] {
  const query = normalize(text)
  if (query.length < 2) return []
  const here = (quest: Quest) => (counts.get(quest.id)?.get(mapId) ?? 0) > 0
  return quests
    .filter((quest) => normalize(quest.name).includes(query) || normalize(quest.normalizedName ?? '').includes(query) || quest.id.toLowerCase() === query)
    .sort((a, b) => Number(here(b)) - Number(here(a)) || Number(normalize(b.name).startsWith(query)) - Number(normalize(a.name).startsWith(query)) || a.name.localeCompare(b.name, 'ru'))
    .slice(0, limit)
}

/** Objectives (trader quest) or stages (story chapter) to pick from. */
export function questGoals(quest: Quest, markers: MapMarker[]): Array<{ key: string; label: string }> {
  if (quest.stages?.length) return quest.stages.map((stage, index) => ({ key: `s:${index}`, label: `Этап ${index + 1}: ${stage.title}` }))
  const goals = (quest.objectiveDetails ?? []).map((objective) => ({ key: `o:${objective.id}`, label: objective.description }))
  for (const marker of markers) {
    if (marker.questId !== quest.id || !marker.objectiveId || goals.some((entry) => entry.key === `o:${marker.objectiveId}`)) continue
    goals.push({ key: `o:${marker.objectiveId}`, label: marker.description || marker.objectiveId })
  }
  return goals
}

/** The map-hud button «Редактировать квесты» (owner app): switches the quest constructor on and off. */
export function QuestEditorButton({ state, onToggle }: { state: QuestPointEditorState; onToggle?: (active: boolean) => void }) {
  if (!state.enabled) return null
  const toggle = () => { const next = !state.active; state.setActive(next); onToggle?.(next) }
  return (
    <div className="map-tools quest-point-editor">
      <button type="button" className={`map-tool${state.active ? ' active' : ''}`} aria-pressed={state.active} onClick={toggle} title={uiText('Конструктор квестов: точки на карте и тексты. Изменения сохраняются сразу и видны всем игрокам')}>
        <PencilRuler size={14} />{uiText('Редактировать квесты')}
      </button>
    </div>
  )
}

/** Quests for the constructor's list: matching the search, or all of them with the ones plotted on this map first. */
export function constructorQuests(quests: Quest[], text: string, mapId: string, counts: Map<string, Map<string, number>>): Quest[] {
  if (normalize(text).length >= 2) return searchQuests(quests, text, mapId, counts, 60)
  const here = (quest: Quest) => (counts.get(quest.id)?.get(mapId) ?? 0) > 0
  return [...quests].sort((a, b) => Number(here(b)) - Number(here(a)) || a.trader.localeCompare(b.trader, 'ru') || a.name.localeCompare(b.name, 'ru'))
}

/** The first plotted point of a quest on a map (the constructor flies there). */
export function firstQuestPoint(markers: MapMarker[], questId: string, mapId: string) {
  return markers.find((marker) => marker.questId === questId && marker.mapId === mapId && isQuestPoint(marker))
}

/**
 * The quest constructor in the map's right panel (owner, 13.10.2026: «нажимаю справа список квестов, либо нахожу в
 * поиске, открывается карта с этим квестом, я могу добавить удалить точку или перенести ее»): every quest of the mode
 * (those plotted on this map first) or the search results; a picked quest shows its objective / stage, a note, its
 * points here (drag on the map to move, hide, return the original) and the maps it has points on. Its texts are edited
 * in the quest window at the bottom of the map (components/QuestTextEditor.tsx).
 */
export function QuestEditorPanel({ state, maps, markers, quests, items = [], traders = [], onPick, onFocus, onSelectMap }: {
  state: QuestPointEditorState
  maps: GameMap[]
  markers: MapMarker[]
  quests: Quest[]
  /** The catalog for «Требования» (the item / key picker). */
  items?: Item[]
  /** The catalog's traders for «Ивент-квесты» (components/EventQuestsEditor.tsx). */
  traders?: Trader[]
  onPick: (quest: Quest) => void
  onFocus: (marker: MapMarker) => void
  onSelectMap: (mapId: string) => void
}) {
  const [query, setQuery] = useState('')
  /** «Ивент-квесты» open instead of the quest list. */
  const [events, setEvents] = useState(false)
  const list = useMemo(() => (state.active && !state.quest ? constructorQuests(quests, query, state.mapId, state.pointCounts) : []), [state.active, state.quest, quests, query, state.mapId, state.pointCounts])
  const goals = useMemo(() => (state.quest ? questGoals(state.quest, markers) : []), [state.quest, markers])
  if (!state.active) return null
  const quest = state.quest
  const otherMaps = quest ? [...(state.pointCounts.get(quest.id) ?? new Map<string, number>())].filter(([mapId]) => mapId !== state.mapId) : []
  const mapName = (id: string) => maps.find((map) => map.id === id)?.name ?? id
  const total = (id: string) => [...(state.pointCounts.get(id)?.values() ?? [])].reduce((sum, count) => sum + count, 0)
  if (events && !quest) {
    return (
      <div className="quest-point-panel quest-editor-panel">
        <EventQuestsEditor quests={quests} items={items} traders={traders} maps={maps} onClose={() => setEvents(false)} />
      </div>
    )
  }
  return (
    <div className="quest-point-panel quest-editor-panel">
      {!quest ? (
        <>
          <button type="button" className="map-tool event-quests-open" onClick={() => setEvents(true)} title={uiText('Добавить и изменить квесты ивентов: название, цели, награды, окончание')}>
            <CalendarClock size={14} />{uiText('Ивент-квесты')}
          </button>
          <button type="button" className={`map-tool${state.adding ? ' active' : ''}`} aria-pressed={state.adding} onClick={() => state.setAdding(!state.adding)} title={uiText('Клик по карте ставит пустую точку; правый клик по ней — значок, квест, описание, предмет и фото')}>
            <MapPinPlus size={14} />{uiText('Поставить точку')}
          </button>
          <label className="quest-point-search">
            <Search size={13} />
            <input className="input" value={query} autoFocus onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти квест по названию (RU / EN)…')} aria-label={uiText('Найти квест')} />
          </label>
          {query.trim().length >= 2 && !list.length && <small className="dim">{uiText('Квест не найден')}</small>}
          <ul className="quest-point-results quest-editor-list" aria-label={uiText('Квесты')}>
            {list.map((entry) => {
              const here = state.pointCounts.get(entry.id)?.get(state.mapId) ?? 0
              const all = total(entry.id)
              return (
                <li key={entry.id}>
                  <button type="button" onClick={() => { setQuery(''); onPick(entry) }}>
                    <strong>{uiText(entry.name)}</strong>
                    <small className="dim">{uiText(entry.trader)} · {here ? uiText(`здесь точек: ${here}`) : all ? uiText(`точек на других картах: ${all}`) : uiText('без точек')}</small>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      ) : (
        <>
          <div className="quest-point-head">
            <strong>{uiText(quest.name)}</strong>
            <button type="button" className="icon-button" onClick={() => state.pick('')} aria-label={uiText('Другой квест')} title={uiText('Другой квест')}><X size={14} /></button>
          </div>
          <div className="quest-editor-tabs" role="tablist" aria-label={uiText('Разделы квеста')}>
            {EDITOR_TABS.map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={state.tab === value} onClick={() => state.setTab(value)}>{uiText(label)}</button>
            ))}
          </div>
          <EditorStatus state={state} />
          {state.tab === 'texts' && <>
            <small className="dim">{uiText('Тексты также правятся в окне квеста внизу карты.')}</small>
            <QuestTextEditor quest={quest} stageIndex={state.goal.startsWith('s:') ? Number(state.goal.slice(2)) : quest.stages?.length ? 0 : null} />
          </>}
          {state.tab === 'requirements' && <QuestRequirementsEditor state={state} quest={quest} items={items} markers={markers} />}
          {state.tab === 'points' && <>
          {goals.length > 0 && (
            <select className="input quest-point-select" value={state.goal} onChange={(event) => state.setGoal(event.target.value)} aria-label={uiText('Цель / этап')}>
              <option value="">{uiText('Все цели и этапы')}</option>
              {goals.map((entry) => <option key={entry.key} value={entry.key}>{uiText(entry.label)}</option>)}
            </select>
          )}
          <input className="input quest-point-note" value={state.note} maxLength={300} onChange={(event) => state.setNote(event.target.value)} placeholder={uiText('Заметка для себя к новым правкам (например, «по баг-репорту»)')} aria-label={uiText('Заметка для себя')} title={uiText('Видите только вы: игроки её не видят')} />
          <div className="quest-point-actions">
            <button type="button" className={`map-tool${state.adding ? ' active' : ''}`} aria-pressed={state.adding} disabled={state.busy} onClick={() => state.setAdding(!state.adding)} title={uiText('Клик по карте — поставить новую точку квеста на выбранный этаж')}>
              <MapPinPlus size={14} />{uiText('Добавить точку')}
            </button>
          </div>
          <small className="dim">{uiText('Точку можно перетащить мышью — сохраняется сразу. Новая и перенесённая точка встают на выбранный этаж. Правый клик по точке — меню: настроить, удалить.')}</small>
          <ul className="quest-point-list">
            {state.points.map((marker, index) => {
              const override = state.overrideOf(marker)
              const status = override?.kind === 'add' ? 'Добавлена' : override?.kind === 'move' ? 'Перемещена' : 'Исходная'
              const resetLabel = override?.kind === 'describe' ? 'Убрать описание' : 'Вернуть исходную точку'
              return (
                <li key={marker.id}>
                  <button type="button" className="quest-point-name" onClick={() => onFocus(marker)} title={uiText('Показать на карте')}>
                    <Crosshair size={12} />{index + 1}. {uiText(status)}
                    {hasPointText(override) && <FileText size={11} className="quest-point-described" aria-label={uiText('с описанием')} />}
                    <small className="dim">x {Math.round(marker.position[1])}, z {Math.round(marker.position[0])}</small>
                  </button>
                  <span className="quest-point-row-actions">
                    <button type="button" className="icon-button" disabled={state.busy} onClick={() => state.openSettings({ marker })} title={uiText('Настроить точку: значок, цель / этап, описание, предмет, фото')} aria-label={uiText('Настроить точку')}><SlidersHorizontal size={13} /></button>
                    {override && override.kind !== 'add' && (
                      <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.reset(override.id)} title={uiText(resetLabel)} aria-label={uiText(resetLabel)}><RotateCcw size={13} /></button>
                    )}
                    <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.hide(marker)} title={uiText(override?.kind === 'add' ? 'Удалить добавленную точку' : 'Скрыть неверную точку')} aria-label={uiText(override?.kind === 'add' ? 'Удалить добавленную точку' : 'Скрыть неверную точку')}><EyeOff size={13} /></button>
                  </span>
                </li>
              )
            })}
            {state.hidden.map((entry) => (
              <li key={entry.id} className="is-hidden">
                <span className="quest-point-name"><EyeOff size={12} />{uiText('Скрыта')}<small className="dim">x {Math.round(entry.x)}, z {Math.round(entry.z)}</small></span>
                <span className="quest-point-row-actions">
                  <button type="button" className="icon-button" disabled={state.busy} onClick={() => void state.reset(entry.id)} title={uiText('Вернуть исходную точку')} aria-label={uiText('Вернуть исходную точку')}><RotateCcw size={13} /></button>
                </span>
              </li>
            ))}
            {!state.points.length && !state.hidden.length && <li className="dim">{uiText('На этой карте у квеста нет точек — нажмите «Добавить точку» и кликните по карте.')}</li>}
          </ul>
          {otherMaps.length > 0 && (
            <div className="quest-point-maps">
              <small className="dim">{uiText('Точки на других картах:')}</small>
              {otherMaps.map(([id, count]) => <button key={id} type="button" className="map-tool small" onClick={() => onSelectMap(id)}>{uiText(mapName(id))} · {count}</button>)}
            </div>
          )}
          </>}
        </>
      )}
    </div>
  )
}

const EDITOR_TABS: Array<[QuestEditorTab, string]> = [['points', 'Точки'], ['texts', 'Тексты'], ['requirements', 'Требования']]

/** «Сохранено» / the error / «Отменить» of the last change, for every section of the constructor. */
export function EditorStatus({ state }: { state: QuestPointEditorState }) {
  if (!state.busy && !state.error && !state.saved && !state.lastUndo) return null
  return (
    <div className="quest-editor-status" role="status" aria-live="polite">
      {state.busy && <LoaderCircle size={13} className="spin" aria-label={uiText('Сохранение…')} />}
      {!state.busy && state.saved && !state.error && <span className="quest-text-saved"><Check size={13} />{uiText('Сохранено — видят все игроки')}</span>}
      {state.error && <span className="account-error">{uiText(state.error)}</span>}
      {!state.busy && state.lastUndo && (
        <button type="button" className="button small ghost" onClick={() => void state.undo()} title={uiText(`Отменить: ${state.lastUndo.label}`)}>
          <Undo2 size={13} />{uiText('Отменить')}
        </button>
      )}
    </div>
  )
}

/**
 * Inside the MapContainer: a click while adding places a point (lat = z, lng = x in game metres); hidden points greyed
 * out (a click returns one); empty drafts dashed, their right click opens the point menu.
 */
export function QuestPointEditorLayer({ state }: { state: QuestPointEditorState }) {
  useMapEvents({
    click: (event) => { if (state.adding && !state.busy) void state.add(event.latlng.lng, event.latlng.lat) },
  })
  return (
    <>
      {state.hidden.map((entry) => (
        <CircleMarker key={entry.id} center={[entry.z, entry.x]} radius={9} bubblingMouseEvents={false} pathOptions={{ color: '#9a9a9a', weight: 2, dashArray: '4 3', fillOpacity: 0.15 }}
          eventHandlers={{ click: (event) => { event.originalEvent.stopPropagation(); if (!state.busy) void state.reset(entry.id) } }}>
          <Tooltip direction="top">{uiText('Скрытая точка — клик, чтобы вернуть')}</Tooltip>
        </CircleMarker>
      ))}
      {state.drafts.map((draft) => {
        const open = (event: { originalEvent: MouseEvent }) => {
          event.originalEvent.preventDefault()
          event.originalEvent.stopPropagation()
          state.openMenu({ draft }, event.originalEvent.clientX, event.originalEvent.clientY)
        }
        return (
          <CircleMarker key={draft.id} center={[draft.z, draft.x]} radius={10} bubblingMouseEvents={false} pathOptions={{ color: '#d5b76f', weight: 2, dashArray: '3 3', fillColor: '#d5b76f', fillOpacity: 0.25 }}
            eventHandlers={{ contextmenu: open, click: open }}>
            <Tooltip direction="top">{uiText('Новая пустая точка — правый клик: настроить')}</Tooltip>
          </CircleMarker>
        )
      })}
    </>
  )
}

/** In the quest card while editing: hide / return the selected point. */
export function QuestPointCardActions({ state, marker, onDone }: { state: QuestPointEditorState; marker: MapMarker | null; onDone: () => void }) {
  if (!state.active || !marker || !marker.questId || marker.questId !== state.questId || !isQuestPoint(marker)) return null
  const override = state.overrideOf(marker)
  return (
    <div className="boss-placement-remove">
      <span className="dim">{uiText(override?.kind === 'add' ? 'Точка добавлена вручную, её видят все игроки.' : override?.kind === 'move' ? 'Точка перенесена вручную, её видят все игроки.' : 'Исходная точка: перетащите её, скройте или добавьте новую — изменения сохраняются сразу и видны всем игрокам.')}</span>
      {override?.note && <small className="dim">{uiText('Заметка для себя')}: {override.note}</small>}
      <div className="boss-placement-actions">
        <button type="button" className="button small" disabled={state.busy} onClick={() => state.openSettings({ marker })}>
          <SlidersHorizontal size={13} />{uiText('Настроить точку')}
        </button>
        {override && override.kind !== 'add' && (
          <button type="button" className="button small" disabled={state.busy} onClick={() => void state.reset(override.id)}>
            <RotateCcw size={13} />{uiText('Вернуть исходную точку')}
          </button>
        )}
        <button type="button" className="button small danger" disabled={state.busy} onClick={() => void state.hide(marker).then((ok) => { if (ok) onDone() })}>
          <EyeOff size={13} />{uiText(override?.kind === 'add' ? 'Удалить добавленную точку' : 'Скрыть неверную точку')}
        </button>
      </div>
      {state.error && <small className="account-error">{uiText(state.error)}</small>}
    </div>
  )
}
