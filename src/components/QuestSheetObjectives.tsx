import { Check } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { SheetObjectives } from '../progression/sheetObjectives'
import { PointHintLine } from './QuestCuratedInfo'
import { EditableText } from './QuestSheetEditing'

/**
 * «Цели» on the quest card under the map, grouped: в рейде, заложить, найти, сдать торговцу. When the objectives are
 * on different maps each in-raid line starts with its map; the map being viewed is highlighted. With `onToggle` (a current
 * quest) every line starts with a box: a tick marks the objective done by hand (src/progression/mapObjectives.ts).
 */
export function QuestSheetObjectives({ sheet, trader, onEditPoint, onToggle }: { sheet: SheetObjectives; trader: string; onEditPoint?: (markerId: string) => void; onToggle?: (objectiveId: string, done: boolean) => void }) {
  return (
    <div className="sheet-objective-groups">
      {sheet.groups.map((group) => (
        <div key={group.kind} className={`sheet-objective-group is-${group.kind}`}>
          <h5>{uiText(group.title)}{group.kind === 'handover' && trader ? <span className="sheet-objective-trader"> · {uiText(trader)}</span> : null}</h5>
          <ul>
            {/* Keys by position as well: a catalog quest may repeat an objective id, and a repeated key leaves the row of the
                quest shown before in the next one (owner, 20.10.2026: «подзадачи гуляют из квеста в квест»). */}
            {group.objectives.map((objective, index) => (
              <li key={`${index}:${objective.id}`} className={`sheet-objective${objective.done ? ' is-done' : ''}${objective.here ? ' is-here' : ''}`}>
                {onToggle
                  ? <button type="button" className="sheet-objective-tick" aria-pressed={objective.done} title={uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')} aria-label={`${uiText(objective.done ? 'Снять галочку' : 'Цель выполнена')}: ${uiText(objective.item ?? objective.text)}`} onClick={() => onToggle(objective.id, !objective.done)}>
                    {objective.done && <Check size={11} strokeWidth={3} aria-hidden="true" />}
                  </button>
                  : objective.done && <Check size={12} className="sheet-objective-check" aria-label={uiText('Выполнено')} />}
                {sheet.showWhere && objective.where && <span className={`sheet-objective-where${objective.here ? ' is-here' : ''}`}>{uiText(objective.where)}</span>}
                <span className="sheet-objective-text">
                  <EditableText field="objective" target={objective.id} value={objective.text}>
                    {objective.item ? <><span className="sheet-objective-verb">{uiText('Сдать торговцу')}:</span> {uiText(objective.item)}</> : uiText(objective.text)}
                  </EditableText>
                  {objective.count ? <span className="mono"> ×{objective.count}</span> : null}
                  {objective.item && objective.foundInRaid ? <span className="sheet-objective-fir"> · {uiText('найден в рейде')}</span> : null}
                  {objective.optional ? <span className="dim"> ({uiText('необязательно')})</span> : null}
                </span>
                {objective.hints?.map((hint) => <PointHintLine key={hint.markerId} hint={hint} onEdit={onEditPoint ? () => onEditPoint(hint.markerId) : undefined} />)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
