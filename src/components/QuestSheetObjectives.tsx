import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Archive, Camera, Check, CheckCircle2, Crosshair, ListChecks, MapPin, Package } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { stagesOf, type SheetNeed, type SheetObjectives, type SheetStage, type SheetStageKind } from '../progression/sheetObjectives'
import type { QuestSheetView } from './questSheetView'
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
export function QuestSheetObjectives({ questId, sheet, trader, onEditPoint, onToggle, focusObjectiveId, pointOf, onGoToPoint, view = 'classic' }: {
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
  /** «Обычный», «Вкладки по этапам» or «Шкала этапов» (components/questSheetView.ts). */
  view?: QuestSheetView
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
  const stages = sheet.stages ?? stagesOf(sheet.groups)
  // «Вкладки по этапам»: the first stage with something left, until another tab is pressed; a point pressed on the map
  // opens the tab of its objective (a tab pressed afterwards wins until the next point).
  const [tab, setTab] = useState<{ kind: SheetStageKind; focus?: string } | null>(null)
  const focusStage = focusObjectiveId ? stages.find((stage) => stage.groups.some((group) => group.objectives.some((objective) => objective.id === focusObjectiveId))) : undefined
  const picked = tab && (!focusStage || tab.focus === focusObjectiveId) ? stages.find((stage) => stage.kind === tab.kind) : undefined
  const openStage = picked ?? focusStage ?? stages.find((stage) => countOf(stage).done < countOf(stage).total) ?? stages[0]
  const shown = view === 'tabs' && openStage ? [openStage] : stages
  const needs = questNeeds(stages)
  return (
    <div ref={root} className={`sheet-stages is-view-${view}`}>
      {view === 'tabs' && stages.length > 1 && (
        <div className="sheet-tabs" role="tablist" aria-label={uiText('Этапы')}>
          {stages.map((stage) => {
            const count = countOf(stage)
            return (
              <button key={stage.kind} type="button" role="tab" aria-selected={stage === openStage} className={`sheet-tab is-${stage.kind}${stage === openStage ? ' active' : ''}`} onClick={() => setTab({ kind: stage.kind, ...(focusObjectiveId ? { focus: focusObjectiveId } : {}) })}>
                <span className="sheet-tab-icon" aria-hidden="true">{STAGE_ICON[stage.kind]}</span>
                {uiText(stage.title)}
                <small className={count.done === count.total ? 'is-done' : undefined}>{count.done}/{count.total}</small>
              </button>
            )
          })}
        </div>
      )}
      {/* Owner, 10.11.2026: «не понятно что нужно сделать сейчас в рейде а что в схроне… разбей цели на понятные блоки и этапы»:
          one block per stage, the quest's own texts inside; each line's items with their pictures (report of the same day). */}
      {shown.map((stage) => ({ stage, stageIndex: stages.indexOf(stage) })).map(({ stage, stageIndex }) => (
        <section key={stage.kind} className={`sheet-stage is-${stage.kind}`} aria-label={uiText(stage.title)}>
          <header className="sheet-stage-head">
            {/* «Шкала этапов» (owner, 11.11.2026: «сделай ее более ровной, более понятной»): the stage's step on one line with the
                others, its count in the dot, its objectives right under it */}
            {view === 'timeline'
              ? <span className={`sheet-step-dot is-${stepState(stages, stageIndex)}`} aria-hidden="true">{countOf(stage).done === countOf(stage).total ? <Check size={12} strokeWidth={3} /> : `${countOf(stage).done}/${countOf(stage).total}`}</span>
              : <span className="sheet-stage-icon" aria-hidden="true">{STAGE_ICON[stage.kind]}</span>}
            <span className="sheet-stage-name">
              <strong>{view !== 'timeline' && <span className="sheet-stage-step">{String(stageIndex + 1).padStart(2, '0')}</span>}{uiText(stage.title)}{stage.kind === 'trader' && trader ? <span className="sheet-objective-trader"> · {uiText(trader)}</span> : null}</strong>
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
                        ? <button type="button" className="sheet-objective-point" title={uiText('Показать точку на карте')} aria-label={uiText('Показать точку на карте')} onClick={() => onGoToPoint(objective.id)}><MapPin size={17} aria-hidden="true" /></button>
                        : <span className="sheet-objective-point is-empty" aria-hidden="true" />)}
                      {onToggle
                        ? <button type="button" className="sheet-objective-tick" aria-pressed={objective.done} title={uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')} aria-label={`${uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')}: ${uiText(objective.item ?? objective.text)}`} onClick={() => onToggle(objective.id, !objective.done)}>
                          {objective.done && <Check size={17} strokeWidth={3} aria-hidden="true" />}
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
                          {objective.optional ? <span className="dim"> ({uiText('опционально')})</span> : null}
                        </span>
                        {own.length > 0 && <button type="button" className="sheet-objective-photos" data-testid="sheet-objective-photos" title={uiText('Фото места')} aria-label={`${uiText('Фото места')}: ${own.length}`} onClick={() => photos.view(own)}><Camera size={10} aria-hidden="true" />{own.length}</button>}
                      </span>
                      {objective.hints?.map((hint) => <PointHintLine key={hint.markerId} hint={hint} onEdit={onEditPoint ? () => onEditPoint(hint.markerId) : undefined} />)}
                    </span>
                  </li>
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
      {view === 'timeline' && <SheetFinish stages={stages} />}
      {/* What the quest needs, once each, in one block on the right (owner, 11.11.2026: «Не нужно показывать два ключа. Покажи
          один ключ… Сделай справа просто блок с требуемыми предметами»), not under every objective. */}
      {needs.length > 0 && <aside className="sheet-needs-block" aria-label={uiText('Требуемые предметы')}><h5>{uiText('Требуемые предметы')}</h5><SheetNeeds needs={needs} /></aside>}
      {photos.overlay}
    </div>
  )
}

/** Every item the objectives still to do and the stages need, one row per item (the biggest count), in the order met. */
function questNeeds(stages: readonly SheetStage[]): SheetNeed[] {
  const byItem = new Map<string, SheetNeed>()
  const add = (need: SheetNeed) => {
    const had = byItem.get(need.itemId)
    if (!had) byItem.set(need.itemId, need)
    else if (need.count > had.count) byItem.set(need.itemId, { ...had, count: need.count })
  }
  for (const stage of stages) {
    for (const group of stage.groups) for (const objective of group.objectives) if (!objective.done) objective.needs?.forEach(add)
    stage.needs?.forEach(add)
  }
  return [...byItem.values()]
}

/** How many of a stage's objectives are done, of how many (the optional ones not counted unless done). */
function countOf(stage: SheetStage) {
  const all = stage.groups.flatMap((group) => group.objectives).filter((objective) => !objective.optional || objective.done)
  return { done: all.filter((objective) => objective.done).length, total: all.length }
}

/** A stage of «Шкала этапов»: done, the first one not done (now), or still ahead. */
function stepState(stages: readonly SheetStage[], index: number) {
  const counts = stages.map(countOf)
  const current = counts.findIndex((count) => count.done < count.total)
  const count = counts[index]!
  return count.done === count.total ? 'done' : index === current ? 'current' : 'next'
}

/** The end of «Шкала этапов»: «Готово» with the quest's count. */
function SheetFinish({ stages }: { stages: readonly SheetStage[] }) {
  const counts = stages.map(countOf)
  const done = counts.reduce((sum, count) => sum + count.done, 0)
  const total = counts.reduce((sum, count) => sum + count.total, 0)
  return (
    <section className={`sheet-stage is-finish${total > 0 && done === total ? ' is-done' : ''}`} aria-label={uiText('Готово')}>
      <header className="sheet-stage-head">
        <span className="sheet-step-dot is-finish" aria-hidden="true"><CheckCircle2 size={13} /></span>
        <span className="sheet-stage-name"><strong>{uiText('Готово')}</strong><small>{done}/{total}</small></span>
      </header>
    </section>
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
