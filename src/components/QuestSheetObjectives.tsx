import { useEffect, useRef, type ReactNode } from 'react'
import { Archive, Camera, Check, Crosshair, ListChecks, MapPin, Package } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { stagesOf, type SheetNeed, type SheetObjectives, type SheetStageKind } from '../progression/sheetObjectives'
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
    <div ref={root} className="sheet-stages">
      {/* Owner, 10.11.2026: «не понятно что нужно сделать сейчас в рейде а что в схроне… разбей цели на понятные блоки и этапы»:
          one block per stage, the quest's own texts inside; each line's items with their pictures (report of the same day). */}
      {(sheet.stages ?? stagesOf(sheet.groups)).map((stage, stageIndex) => (
        <section key={stage.kind} className={`sheet-stage is-${stage.kind}`} aria-label={uiText(stage.title)}>
          <header className="sheet-stage-head">
            <span className="sheet-stage-icon" aria-hidden="true">{STAGE_ICON[stage.kind]}</span>
            <span className="sheet-stage-name">
              <strong><span className="sheet-stage-step">{String(stageIndex + 1).padStart(2, '0')}</span>{uiText(stage.title)}{stage.kind === 'trader' && trader ? <span className="sheet-objective-trader"> · {uiText(trader)}</span> : null}</strong>
              <small>{uiText(stage.hint)}</small>
            </span>
          </header>
          {stage.groups.map((group) => (
            <div key={group.kind} className={`sheet-objective-group is-${group.kind}`}>
              {/* a sub-heading only where the stage holds more than one kind (в рейде: заложить, найти) */}
              {stage.groups.length > 1 && <h5>{uiText(group.kind === 'raid' ? 'Выполнить' : group.title)}</h5>}
              <ul>
                {/* Keys by position as well: a catalog quest may repeat an objective id, and a repeated key leaves the row of the
                    quest shown before in the next one (owner, 20.10.2026: «подзадачи гуляют из квеста в квест»). */}
                {group.objectives.map((objective, index) => {
                  const own = photos.photosOf(objective)
                  return <li key={`${index}:${objective.id}`} {...photos.rowProps(`${group.kind}:${index}`, own)} className={`sheet-objective${objective.done ? ' is-done' : ''}${objective.here ? ' is-here' : ''}${focusObjectiveId && objective.id === focusObjectiveId ? ' is-focus' : ''}${own.length ? ' has-photos' : ''}`}>
                    <span className="sheet-objective-controls">
                      {/* the pin keeps its place when there is none, so every box stands in one column */}
                      {onGoToPoint && (!objective.done && pointOf?.(objective.id)
                        ? <button type="button" className="sheet-objective-point" title={uiText('Показать точку на карте')} aria-label={uiText('Показать точку на карте')} onClick={() => onGoToPoint(objective.id)}><MapPin size={11} aria-hidden="true" /></button>
                        : <span className="sheet-objective-point is-empty" aria-hidden="true" />)}
                      {onToggle
                        ? <button type="button" className="sheet-objective-tick" aria-pressed={objective.done} title={uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')} aria-label={`${uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')}: ${uiText(objective.item ?? objective.text)}`} onClick={() => onToggle(objective.id, !objective.done)}>
                          {objective.done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                        </button>
                        : objective.done && <Check size={12} className="sheet-objective-check" aria-label={uiText('Выполнено')} />}
                    </span>
                    <span className="sheet-objective-body">
                      <span className="sheet-objective-line">
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
                      </span>
                      {!objective.done && objective.needs?.length ? <SheetNeeds needs={objective.needs} /> : null}
                      {objective.hints?.map((hint) => <PointHintLine key={hint.markerId} hint={hint} onEdit={onEditPoint ? () => onEditPoint(hint.markerId) : undefined} />)}
                    </span>
                  </li>
                })}
              </ul>
            </div>
          ))}
          {stage.needs?.length ? <div className="sheet-stage-needs"><h5>{uiText('Взять в рейд')}</h5><SheetNeeds needs={stage.needs} /></div> : null}
        </section>
      ))}
      {photos.overlay}
    </div>
  )
}

const STAGE_ICON: Record<SheetStageKind, ReactNode> = {
  raid: <Crosshair size={14} />,
  trader: <Archive size={14} />,
  out: <ListChecks size={14} />,
}

/** The items a line needs, each with its picture, its count and what it is for. */
function SheetNeeds({ needs }: { needs: readonly SheetNeed[] }) {
  return (
    <ul className="sheet-needs" aria-label={uiText('Требования рейда')}>
      {needs.map((need) => (
        <li key={`${need.itemId}:${need.label}`} className="sheet-need" title={uiText(need.name)}>
          {need.iconUrl ? <img src={need.iconUrl} alt="" loading="lazy" decoding="async" /> : <span className="sheet-need-empty" aria-hidden="true"><Package size={14} /></span>}
          <span className="sheet-need-text">
            <strong>{uiText(need.name)}{need.count > 1 ? <span className="mono"> ×{need.count}</span> : null}</strong>
            <small>{uiText(need.label)}{need.foundInRaid ? ` · ${uiText('найден в рейде')}` : ''}</small>
          </span>
        </li>
      ))}
    </ul>
  )
}
