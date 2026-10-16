import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Camera, Check, LoaderCircle, Package, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { QUEST_POINT_DESCRIPTION_MAX, QUEST_POINT_TITLE_MAX } from '../data/questPointOverrides'
import { uploadQuestPointPhoto } from '../data/questPointPhotos'
import { isQuestIcon, isQuestPointIcon, QUEST_POINT_ITEMS_MAX, QUEST_POINT_PHOTO_LIMITS, type QuestPointIcon } from '../shared/questPointConstructor'
import type { Item, MapMarker, Quest } from '../domain/types'
import { goalKeyOf, questGoals, searchQuests, type PointSettings, type PointTarget, type QuestPointEditorState } from './QuestPointEditor'
import { ItemPicker } from './QuestRequirementsEditor'
import { PointItems, PointPhotos } from './PointPhotos'
import './questEditor.css'

/**
 * The quest constructor's point menu and point window on the map (owner app; owner, 16.10.2026: «ставлю точку, она
 * пустая. жму правой кнопкой. открывается окно, с выбором настройки точки … можно выбрать любую эмблему … если
 * выбираешь квест: то там будет свое меню … полное описание точки и возможность добавить предмет из каталога или
 * фотографию»). A right click on a point opens the menu («Редактировать», the emblems, «Удалить»); the window sets the
 * emblem, the quest with its objective / stage, the texts (RU / EN), catalog items and photos. Saved at once for every
 * player (components/QuestPointEditor.tsx `configure`).
 */

/** One emblem the map knows: its layer, label and picture in the map's current marker style (pages/MapsPage.tsx). */
export interface PointEmblem { id: QuestPointIcon; label: string; icon: ReactNode }

/** What a point is to the constructor: an empty draft, a point the owner added, or an original catalog point. */
function targetKind(state: QuestPointEditorState, target: PointTarget): 'draft' | 'added' | 'original' {
  if (target.draft) return 'draft'
  return state.overrideOf(target.marker)?.kind === 'add' ? 'added' : 'original'
}

/** The right-click menu of a point. */
export function PointMenu({ state, emblems }: { state: QuestPointEditorState; emblems: PointEmblem[] }) {
  const menu = state.menu
  const ref = useRef<HTMLDivElement>(null)
  const close = state.closeMenu
  useEffect(() => {
    if (!menu) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') close() }
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) close() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown) }
  }, [menu, close])
  if (!menu) return null
  const { target } = menu
  const kind = targetKind(state, target)
  const override = target.marker ? state.overrideOf(target.marker) : undefined
  const offered = kind === 'original' ? emblems.filter((emblem) => isQuestIcon(emblem.id)) : emblems
  const title = target.marker ? target.marker.title || uiText('Точка') : uiText('Новая пустая точка')
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 380))
  const removeLabel = kind === 'original' ? 'Скрыть точку' : 'Удалить точку'
  return createPortal(
    <div ref={ref} className="point-menu" role="menu" aria-label={uiText('Меню точки')} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="point-menu-title">{title}</div>
      <button type="button" role="menuitem" onClick={() => state.openSettings(target)}><Pencil size={13} />{uiText('Редактировать')}</button>
      <div className="point-menu-label">{uiText('Тип точки')}</div>
      <div className="point-menu-emblems" role="group" aria-label={uiText('Тип точки')}>
        {offered.map((emblem) => (
          <button key={emblem.id} type="button" role="menuitem" onClick={() => state.openSettings(target, emblem.id)} title={uiText(emblem.label)} aria-label={uiText(emblem.label)}>
            {emblem.icon}
          </button>
        ))}
      </div>
      {kind === 'original' && override && (
        <button type="button" role="menuitem" disabled={state.busy} onClick={() => { close(); void state.reset(override.id) }}><RotateCcw size={13} />{uiText('Вернуть исходную точку')}</button>
      )}
      <button type="button" role="menuitem" className="is-danger" disabled={state.busy} onClick={() => { close(); void state.remove(target) }}><Trash2 size={13} />{uiText(removeLabel)}</button>
    </div>,
    document.body,
  )
}

/** The point window: opened from the menu or the pencil of a point in the quest window. */
export function PointSettingsWindow({ state, emblems, quests, items, markers }: { state: QuestPointEditorState; emblems: PointEmblem[]; quests: Quest[]; items: Item[]; markers: MapMarker[] }) {
  const editing = state.editing
  if (!editing) return null
  const key = editing.target.draft ? editing.target.draft.id : editing.target.marker.id
  return createPortal(
    <div className="point-window-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) state.closeSettings() }}>
      <PointSettingsForm key={`${key}|${editing.icon ?? ''}`} state={state} target={editing.target} icon={editing.icon} emblems={emblems} quests={quests} items={items} markers={markers} />
    </div>,
    document.body,
  )
}

/** The settings a point opens with. */
function initialSettings(state: QuestPointEditorState, target: PointTarget, icon?: QuestPointIcon): PointSettings {
  if (target.draft) {
    return { icon: icon ?? 'quest.zone', questId: state.questId, goal: state.questId ? state.goal : '', itemIds: [], photoIds: [] }
  }
  const { marker } = target
  const override = state.overrideOf(marker)
  const own = override?.icon ?? (isQuestPointIcon(marker.layerId) ? marker.layerId : 'quest.zone')
  return {
    icon: icon ?? own, questId: marker.questId ?? '', goal: goalKeyOf(marker),
    title: override?.title, titleEn: override?.titleEn, description: override?.description, descriptionEn: override?.descriptionEn, note: override?.note,
    itemIds: override?.itemIds ?? [], photoIds: override?.photoIds ?? [],
  }
}

function PointSettingsForm({ state, target, icon, emblems, quests, items, markers }: {
  state: QuestPointEditorState; target: PointTarget; icon?: QuestPointIcon; emblems: PointEmblem[]; quests: Quest[]; items: Item[]; markers: MapMarker[]
}) {
  const kind = targetKind(state, target)
  const [settings, setSettings] = useState<PointSettings>(() => initialSettings(state, target, icon))
  const [english, setEnglish] = useState(Boolean(settings.titleEn || settings.descriptionEn))
  const [questQuery, setQuestQuery] = useState('')
  const [picking, setPicking] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const set = (patch: Partial<PointSettings>) => setSettings((current) => ({ ...current, ...patch }))
  const questMode = isQuestIcon(settings.icon)
  const quest = questMode && settings.questId ? quests.find((entry) => entry.id === settings.questId) : undefined
  const goals = useMemo(() => (quest ? questGoals(quest, markers) : []), [quest, markers])
  const found = useMemo(() => (questMode && !quest ? searchQuests(quests, questQuery, state.mapId, state.pointCounts, 8) : []), [questMode, quest, quests, questQuery, state.mapId, state.pointCounts])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const chosenItems = settings.itemIds.flatMap((id) => {
    const item = itemsById.get(id)
    return [{ itemId: id, name: item?.name ?? id, ...(item?.iconUrl ? { iconUrl: item.iconUrl } : {}) }]
  })
  const offered = kind === 'original' ? emblems.filter((emblem) => isQuestIcon(emblem.id)) : emblems
  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    setUploading(true); setPhotoError('')
    try {
      const id = await uploadQuestPointPhoto(file)
      setSettings((current) => ({ ...current, photoIds: [...current.photoIds, id].slice(0, QUEST_POINT_PHOTO_LIMITS.perPoint) }))
    } catch (reason) {
      setPhotoError(reason instanceof Error ? reason.message : 'Фото не загрузилось')
    } finally {
      setUploading(false)
    }
  }
  const save = async () => {
    if (state.busy || uploading) return
    if (await state.configure(target, settings)) state.closeSettings()
  }
  const heading = kind === 'draft' ? 'Новая точка' : kind === 'added' ? 'Точка, добавленная вручную' : 'Исходная точка квеста'
  return (
    <form className="point-window" role="dialog" aria-modal="true" aria-label={uiText('Настройки точки')} onSubmit={(event) => { event.preventDefault(); void save() }}>
      <div className="quest-point-head">
        <strong>{uiText(heading)}</strong>
        <button type="button" className="icon-button" onClick={state.closeSettings} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
      </div>

      <fieldset>
        <legend>{uiText('Значок точки')}</legend>
        <div className="point-emblems" role="radiogroup" aria-label={uiText('Значок точки')}>
          {offered.map((emblem) => (
            <button key={emblem.id} type="button" role="radio" aria-checked={settings.icon === emblem.id} className={settings.icon === emblem.id ? 'active' : undefined}
              onClick={() => set({ icon: emblem.id })} title={uiText(emblem.label)}>
              {emblem.icon}<span>{uiText(emblem.label)}</span>
            </button>
          ))}
        </div>
        {kind === 'original' && <small className="dim">{uiText('У исходной точки квеста можно сменить только цель / этап и вид квестовой метки.')}</small>}
      </fieldset>

      {questMode && (
        <fieldset className="point-quest">
          <legend>{uiText('Квест')}</legend>
          {quest ? (
            <div className="point-quest-picked">
              <strong>{uiText(quest.name)}</strong><small className="dim">{uiText(quest.trader)}</small>
              {kind !== 'original' && <button type="button" className="icon-button" onClick={() => set({ questId: '', goal: '' })} aria-label={uiText('Другой квест')} title={uiText('Другой квест')}><X size={13} /></button>}
            </div>
          ) : (
            <>
              <label className="quest-point-search">
                <Search size={13} />
                <input className="input" value={questQuery} onChange={(event) => setQuestQuery(event.target.value)} placeholder={uiText('Найти квест по названию (RU / EN)…')} aria-label={uiText('Найти квест для точки')} />
              </label>
              {questQuery.trim().length >= 2 && !found.length && <small className="dim">{uiText('Квест не найден')}</small>}
              <ul className="quest-point-results" aria-label={uiText('Найденные квесты')}>
                {found.map((entry) => (
                  <li key={entry.id}><button type="button" onClick={() => { set({ questId: entry.id, goal: '' }); setQuestQuery('') }}><strong>{uiText(entry.name)}</strong><small className="dim">{uiText(entry.trader)}</small></button></li>
                ))}
              </ul>
            </>
          )}
          {quest && goals.length > 0 && (
            <select className="input" value={settings.goal} onChange={(event) => set({ goal: event.target.value })} aria-label={uiText('Цель / этап точки')}>
              <option value="">{uiText('Без цели / этапа')}</option>
              {goals.map((entry) => <option key={entry.key} value={entry.key}>{uiText(entry.label)}</option>)}
            </select>
          )}
        </fieldset>
      )}

      <fieldset>
        <legend>{uiText('Описание для игроков')}</legend>
        <input className="input" value={settings.title ?? ''} maxLength={QUEST_POINT_TITLE_MAX} onChange={(event) => set({ title: event.target.value })} placeholder={uiText('Заголовок, например «Склад у заправки»')} aria-label={uiText('Заголовок точки')} />
        <textarea className="input" rows={3} value={settings.description ?? ''} maxLength={QUEST_POINT_DESCRIPTION_MAX} onChange={(event) => set({ description: event.target.value })} placeholder={uiText('Где и что искать: этаж, дверь, полка…')} aria-label={uiText('Где и что искать')} />
        <small className="quest-point-form-count">{(settings.description ?? '').length} / {QUEST_POINT_DESCRIPTION_MAX}</small>
        <label className="dim"><input type="checkbox" checked={english} onChange={(event) => setEnglish(event.target.checked)} /> {uiText('Текст на английском')}</label>
        {english && <>
          <input className="input" value={settings.titleEn ?? ''} maxLength={QUEST_POINT_TITLE_MAX} onChange={(event) => set({ titleEn: event.target.value })} placeholder="Title" aria-label={uiText('Заголовок на английском')} />
          <textarea className="input" rows={3} value={settings.descriptionEn ?? ''} maxLength={QUEST_POINT_DESCRIPTION_MAX} onChange={(event) => set({ descriptionEn: event.target.value })} placeholder="Where and what to look for" aria-label={uiText('Описание на английском')} />
        </>}
      </fieldset>

      <fieldset>
        <legend>{uiText('Предметы из каталога')}</legend>
        <PointItems items={chosenItems} onRemove={(itemId) => set({ itemIds: settings.itemIds.filter((id) => id !== itemId) })} />
        {picking
          ? <ItemPicker items={items} onClose={() => setPicking(false)} onPick={(item) => { set({ itemIds: [...new Set([...settings.itemIds, item.id])].slice(0, QUEST_POINT_ITEMS_MAX) }); setPicking(false) }} />
          : <button type="button" className="button small" disabled={settings.itemIds.length >= QUEST_POINT_ITEMS_MAX} onClick={() => setPicking(true)}><Package size={13} />{uiText('Добавить предмет')}</button>}
      </fieldset>

      <fieldset>
        <legend>{uiText('Фото: где искать')}</legend>
        <PointPhotos ids={settings.photoIds} onRemove={(id) => set({ photoIds: settings.photoIds.filter((entry) => entry !== id) })} />
        <label className={`button small point-photo-add${settings.photoIds.length >= QUEST_POINT_PHOTO_LIMITS.perPoint || uploading ? ' is-disabled' : ''}`}>
          {uploading ? <LoaderCircle size={13} className="spin" /> : <Camera size={13} />}{uiText(uploading ? 'Загрузка фото…' : 'Добавить фото')}
          <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={settings.photoIds.length >= QUEST_POINT_PHOTO_LIMITS.perPoint || uploading} aria-label={uiText('Фото места')}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; void addPhoto(file) }} />
        </label>
        <small className="dim">{uiText('JPG, PNG или WEBP до 5 МБ, не больше 4 фото на точку.')}</small>
        {photoError && <small className="account-error">{uiText(photoError)}</small>}
      </fieldset>

      <fieldset className="is-private">
        <legend>{uiText('Заметка для себя')}</legend>
        <input className="input" value={settings.note ?? ''} maxLength={300} onChange={(event) => set({ note: event.target.value })} placeholder={uiText('Видите только вы, игроки её не видят')} aria-label={uiText('Заметка для себя')} />
      </fieldset>

      {state.error && <small className="account-error">{uiText(state.error)}</small>}
      <div className="quest-text-actions">
        <button type="submit" className="button small primary" disabled={state.busy || uploading}>{state.busy ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />}{uiText('Сохранить')}</button>
        <button type="button" className="button small ghost" onClick={state.closeSettings}>{uiText('Отмена')}</button>
      </div>
    </form>
  )
}
