import { useEffect, useRef } from 'react'
import { Camera, Check, MapPin } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { SheetObjectives } from '../progression/sheetObjectives'
import { PointHintLine } from './QuestCuratedInfo'
import { EditableText } from './QuestSheetEditing'
import { useObjectivePhotos } from './QuestGuidePhotos'

/**
 * «Цели» on the quest card under the map, grouped: в рейде, заложить, найти, сдать торговцу. When the objectives are
 * on different maps each in-raid line starts with its map; the map being viewed is highlighted. With `onToggle` (a current
 * quest) every line starts with a box: a tick marks the objective done by hand (src/progression/mapObjectives.ts); the
 * line's text ticks it too, and `focusObjectiveId` (the objective of the point tapped on the map) is lit (owner,
 * 02.11.2026: «Сделай более удобную отметку в телефонах»). With `pointOf`, a line with its own point on a map has a pin to the
 * left of the box, which takes the map there (owner, 05.11.2026: «кнопочка геометки… тебя перекидывает именно в эту точку»).
 */
export function QuestSheetObjectives({ questId, sheet, trader, onEditPoint, onToggle, focusObjectiveId, pointOf, onGoToPoint }: {
  /** The quest: its lines then show their own photos (useObjectivePhotos). */
  questId?: string
  sheet: SheetObjectives
  trader: string
  onEditPoint?: (markerId: string) => void
  onToggle?: (objectiveId: string, done: boolean) => void
  focusObjectiveId?: string
  /** This objective has a point of its own on a map. */
  pointOf?: (objectiveId: string) => boolean
  onGoToPoint?: (objectiveId: string) => void
}) {
  const root = useRef<HTMLDivElement>(null)
  const photos = useObjectivePhotos(questId)
  // the lit objective in sight: the phone's quest window is a third of the map and scrolls (styles/mobile.css)
  useEffect(() => {
    const line = focusObjectiveId ? root.current?.querySelector<HTMLElement>('.sheet-objective.is-focus') : null
    const box = line?.closest<HTMLElement>('.map-quest-sheet-body')
    if (!line || !box) return
    const lineBox = line.getBoundingClientRect()
    const view = box.getBoundingClientRect()
    if (lineBox.top >= view.top && lineBox.bottom <= view.bottom) return
    box.scrollBy({ top: lineBox.top - view.top - 44, behavior: 'smooth' })
  }, [focusObjectiveId])
  return (
    <div ref={root} className="sheet-objective-groups">
      {sheet.groups.map((group) => (
        <div key={group.kind} className={`sheet-objective-group is-${group.kind}`}>
          <h5>{uiText(group.title)}{group.kind === 'handover' && trader ? <span className="sheet-objective-trader"> · {uiText(trader)}</span> : null}</h5>
          <ul>
            {/* Keys by position as well: a catalog quest may repeat an objective id, and a repeated key leaves the row of the
                quest shown before in the next one (owner, 20.10.2026: «подзадачи гуляют из квеста в квест»). */}
            {group.objectives.map((objective, index) => {
              const own = photos.photosOf(objective)
              return <li key={`${index}:${objective.id}`} {...photos.rowProps(`${group.kind}:${index}`, own)} className={`sheet-objective${objective.done ? ' is-done' : ''}${objective.here ? ' is-here' : ''}${focusObjectiveId && objective.id === focusObjectiveId ? ' is-focus' : ''}${own.length ? ' has-photos' : ''}`}>
                <span className="sheet-objective-controls">{onGoToPoint && !objective.done && pointOf?.(objective.id) && <button type="button" className="sheet-objective-point" title={uiText('Показать точку на карте')} aria-label={uiText('Показать точку на карте')} onClick={() => onGoToPoint(objective.id)}><MapPin size={11} aria-hidden="true" /></button>}
                {onToggle
                  ? <button type="button" className="sheet-objective-tick" aria-pressed={objective.done} title={uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')} aria-label={`${uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')}: ${uiText(objective.item ?? objective.text)}`} onClick={() => onToggle(objective.id, !objective.done)}>
                    {objective.done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  : objective.done && <Check size={12} className="sheet-objective-check" aria-label={uiText('Выполнено')} />}</span>
                {sheet.showWhere && objective.where && <span className={`sheet-objective-where${objective.here ? ' is-here' : ''}`}>{uiText(objective.where)}</span>}
                {/* the box's twin for a finger: the text ticks the line as well (the box stays the control for a screen reader),
                    though not when the text was being selected */}
                <span className={`sheet-objective-text${onToggle ? ' is-tickable' : ''}`} onClick={onToggle ? () => { if (window.getSelection()?.isCollapsed !== false) onToggle(objective.id, !objective.done) } : undefined}>
                  <EditableText field="objective" target={objective.id} value={objective.text}>
                    {objective.item ? <><span className="sheet-objective-verb">{uiText('Сдать торговцу')}:</span> {uiText(objective.item)}</> : uiText(objective.text)}
                  </EditableText>
                  {objective.count ? <span className="mono"> ×{objective.count}</span> : null}
                  {objective.item && objective.foundInRaid ? <span className="sheet-objective-fir"> · {uiText('найден в рейде')}</span> : null}
                  {objective.optional ? <span className="dim"> ({uiText('необязательно')})</span> : null}
                </span>
                {own.length > 0 && <button type="button" className="sheet-objective-photos" data-testid="sheet-objective-photos" title={uiText('Фото места')} aria-label={`${uiText('Фото места')}: ${own.length}`} onClick={() => photos.view(own)}><Camera size={10} aria-hidden="true" />{own.length}</button>}
                {objective.hints?.map((hint) => <PointHintLine key={hint.markerId} hint={hint} onEdit={onEditPoint ? () => onEditPoint(hint.markerId) : undefined} />)}
              </li>
            })}
          </ul>
        </div>
      ))}
      {photos.overlay}
    </div>
  )
}
