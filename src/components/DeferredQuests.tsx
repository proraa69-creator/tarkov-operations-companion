import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hourglass, Package, Pencil, Star, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import type { Item } from '../domain/types'
import { deferralTermText, type DeferredQuestRow } from '../progression/deferredQuests'
import { setDeferredFavorites, useDeferredFavorites } from '../progression/questDeferral'
import { usePopupMenu } from './usePopupMenu'
import './questEditor.css'
import './deferredQuests.css'

/** The quests may still be loading when a page opens: a count that shows up this soon still makes the button glow. */
export const DEFERRED_BLINK_WINDOW_MS = 3000
/** The three swells of deferredQuests.css (3 × 1.3 s) and a little more. */
export const DEFERRED_GLOW_MS = 4000

/**
 * True once per visit of the page, while the button glows: it opened with quests put aside (owner, 03.11.2026: «кнопка
 * должна мигнуть 3 раза мягкими плавными подсвечиваниями… на случай если человек забыл что туда добавил квест»).
 */
function useVisitGlow(count: number) {
  const [glow, setGlow] = useState<'wait' | 'on' | 'done'>('wait')
  useEffect(() => {
    const timer = window.setTimeout(() => setGlow((current) => (current === 'wait' ? 'done' : current)), DEFERRED_BLINK_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])
  useEffect(() => {
    if (glow !== 'on') return
    const timer = window.setTimeout(() => setGlow('done'), DEFERRED_GLOW_MS)
    return () => window.clearTimeout(timer)
  }, [glow])
  if (glow === 'wait' && count > 0) setGlow('on')
  return glow === 'on'
}

/**
 * «Отложенные квесты» (progression/deferredQuests.ts) on the map and on «Квесты»: the count of quests put aside inside the
 * button, a click opens their list.
 */
export function DeferredQuestsButton({ count, onOpen, className = '' }: { count: number; onOpen: () => void; className?: string }) {
  const glowing = useVisitGlow(count)
  return (
    <button
      type="button"
      className={`deferred-quests-button${count ? ' has-deferred' : ''}${glowing ? ' is-glowing' : ''}${className ? ` ${className}` : ''}`}
      aria-label={count ? `${uiText('Отложенные квесты')}: ${count}` : uiText('Отложенные квесты')}
      title={uiText('Квесты, которые вы отложили. Отложить: правый клик по квесту → «Добавить в отложенные»')}
      onClick={onOpen}
    >
      <Hourglass size={14} aria-hidden="true" />
      <span>{uiText('Отложенные квесты')}</span>
      {count > 0 && <b className="deferred-quests-count" aria-hidden="true">{count}</b>}
    </button>
  )
}

/** A right click on a quest: where, and the owner's «Редактировать точку» of a quest point on the map. */
export interface QuestDeferMenuState { questId: string; title: string; x: number; y: number; onEdit?: () => void }

/**
 * The right click on a quest (its row, its point on the map): «Добавить в отложенные» (owner, 03.11.2026: «пока что там
 * будет один пункт»); a point the owner can edit also has «Редактировать точку». Escape or a click elsewhere closes it.
 * `onClose` must keep its identity between renders.
 */
export function QuestDeferMenu({ menu, onDefer, onClose }: { menu: QuestDeferMenuState | null; onDefer: (questId: string) => void; onClose: () => void }) {
  const ref = usePopupMenu(menu, onClose)
  if (!menu) return null
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - (menu.onEdit ? 120 : 86)))
  return createPortal(
    <div ref={ref} className="point-menu quest-defer-menu" role="menu" aria-label={uiText('Меню квеста')} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="point-menu-title">{uiText(menu.title)}</div>
      <button type="button" role="menuitem" onClick={() => { onClose(); onDefer(menu.questId) }}><Hourglass size={13} aria-hidden="true" />{uiText('Добавить в отложенные')}</button>
      {menu.onEdit && <button type="button" role="menuitem" onClick={() => { onClose(); menu.onEdit?.() }}><Pencil size={13} aria-hidden="true" />{uiText('Редактировать точку')}</button>}
    </div>,
    document.body,
  )
}

/**
 * «Отложенные квесты»: each quest put aside with a tick, its trader and maps, and what it needs in the raid; the ticked
 * ones go back to the lists and the map on «Вернуть». `onClose` must keep its identity between renders.
 */
export function DeferredQuestsDialog({ rows, onRestore, onClose }: { rows: DeferredQuestRow[]; onRestore: (questIds: string[]) => void; onClose: () => void }) {
  const { locale } = useLocale()
  // «Предметы в избранное» (progression/questDeferral.ts): on by default.
  const favorites = useDeferredFavorites()
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const ids = rows.map(({ quest }) => quest.id)
  // Only rows still listed count (a quest done meanwhile leaves the list).
  const picked = ids.filter((id) => chosen.has(id))
  const all = rows.length > 0 && picked.length === rows.length
  const toggle = (id: string) => setChosen((current) => {
    const next = new Set(current)
    if (!next.delete(id)) next.add(id)
    return next
  })
  return createPortal(
    <div className="registration-overlay deferred-quests-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog deferred-quests-dialog" role="dialog" aria-modal="true" aria-labelledby="deferred-quests-title">
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <div className="deferred-quests-head">
          <h2 id="deferred-quests-title">{uiText('Отложенные квесты')}</h2>
          {/* On the right (owner, 03.11.2026: «там справа будет эта кнопка добавить в избранное отложенный предмет»). */}
          <label className="deferred-favorites-switch" title={uiText('Ключи и предметы квеста, который вы отложили, сами добавляются в «Избранное» как напоминание.')}>
            <Star size={14} aria-hidden="true" />
            <span>{uiText('Предметы в избранное')}</span>
            <button type="button" role="switch" aria-checked={favorites} className={`toggle ${favorites ? 'on' : ''}`} onClick={() => setDeferredFavorites(!favorites)}><span /></button>
          </label>
        </div>
        {rows.length ? <>
          <p className="deferred-quests-lead">{uiText('Отметьте квесты, которые вернуть в общий список и на карту.')}</p>
          <label className="deferred-quests-all"><input type="checkbox" checked={all} onChange={() => setChosen(all ? new Set() : new Set(ids))} />{uiText('Выбрать все')}</label>
          <ul className="deferred-quests-list">
            {rows.map(({ quest, detail, items, entry }) => (
              <li key={quest.id}>
                <label className={`deferred-quest${chosen.has(quest.id) ? ' is-chosen' : ''}`}>
                  <input type="checkbox" checked={chosen.has(quest.id)} onChange={() => toggle(quest.id)} />
                  <span className="deferred-quest-copy">
                    <strong>{uiText(quest.name)}</strong><small>{uiText(detail)}</small>
                    {/* Put aside from the Overview for a while: when it comes back by itself. */}
                    {deferralTermText(entry, locale) && <small className="deferred-quest-term"><Hourglass size={11} aria-hidden="true" />{deferralTermText(entry, locale)}</small>}
                  </span>
                  <RaidItem items={items} />
                </label>
              </li>
            ))}
          </ul>
          <div className="deferred-quests-actions">
            <button type="button" className="button ghost" onClick={onClose}>{uiText('Отмена')}</button>
            <button type="button" className="button primary" disabled={!picked.length} onClick={() => onRestore(picked)}>{uiText('Вернуть')}{picked.length ? ` (${picked.length})` : ''}</button>
          </div>
        </> : <p className="deferred-quests-lead">{uiText('Отложенных квестов нет. Нажмите правой кнопкой мыши на квест в списке или на его точку на карте и выберите «Добавить в отложенные»: квест и его метки уберутся, пока вы не вернёте его здесь.')}</p>}
      </section>
    </div>,
    document.body,
  )
}

/**
 * What the quest needs in the raid: one square picture (a key first) with its name, and «+N» in its corner for the other
 * items (owner, 03.11.2026: «если предметов несколько… справа сверху в углу маленькая +цифра… картинки все должны быть
 * 1х1»). All of them are named on hover.
 */
function RaidItem({ items }: { items: Item[] }) {
  const [first, ...others] = items
  if (!first) return <span className="deferred-item is-empty">{uiText('Ничего брать не нужно')}</span>
  return (
    <span className="deferred-item" title={items.map((item) => uiText(item.name)).join('\n')}>
      <span className="deferred-item-picture">
        {first.iconUrl ? <img src={first.iconUrl} alt="" loading="lazy" /> : <Package size={20} aria-hidden="true" />}
        {others.length > 0 && <b className="deferred-item-more">+{others.length}</b>}
      </span>
      <span className="deferred-item-name">{uiText(first.name)}</span>
    </span>
  )
}
