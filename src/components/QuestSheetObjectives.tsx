import { Check } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import type { SheetObjectives } from '../progression/sheetObjectives'

/**
 * «Цели» on the quest card under the map, grouped: в рейде, заложить, найти, сдать торговцу. When the objectives are
 * on different maps each in-raid line starts with its map; the map being viewed is highlighted.
 */
export function QuestSheetObjectives({ sheet, trader }: { sheet: SheetObjectives; trader: string }) {
  return (
    <div className="sheet-objective-groups">
      {sheet.groups.map((group) => (
        <div key={group.kind} className={`sheet-objective-group is-${group.kind}`}>
          <h5>{uiText(group.title)}{group.kind === 'handover' && trader ? <span className="sheet-objective-trader"> · {uiText(trader)}</span> : null}</h5>
          <ul>
            {group.objectives.map((objective) => (
              <li key={objective.id} className={`sheet-objective${objective.done ? ' is-done' : ''}${objective.here ? ' is-here' : ''}`}>
                {objective.done && <Check size={12} className="sheet-objective-check" aria-label={uiText('Выполнено')} />}
                {sheet.showWhere && objective.where && <span className={`sheet-objective-where${objective.here ? ' is-here' : ''}`}>{uiText(objective.where)}</span>}
                <span className="sheet-objective-text">
                  {objective.item ? <><span className="sheet-objective-verb">{uiText('Сдать торговцу')}:</span> {uiText(objective.item)}</> : uiText(objective.text)}
                  {objective.count ? <span className="mono"> ×{objective.count}</span> : null}
                  {objective.item && objective.foundInRaid ? <span className="sheet-objective-fir"> · {uiText('найден в рейде')}</span> : null}
                  {objective.optional ? <span className="dim"> ({uiText('необязательно')})</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
