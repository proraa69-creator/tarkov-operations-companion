import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { Quest } from '../../domain/types'
import { uiText } from '../../i18n/renderText'
import type { QuestTreeAvailability } from './QuestTreeView'
import { isChipLink, type QuestTreeLane, type QuestTreeModel } from './questTreeModel'
import { StatusMark } from './StatusMark'
import { questTreeStatus, stepLabel } from './questTreeText'

const MAX_INDENT = 6

interface QuestTreeOutlineProps {
  model: QuestTreeModel
  availability: QuestTreeAvailability
  /** A lane's key, or `all`. */
  lane: string
  /** Set while searching: only these quests, from every lane. */
  matches?: string[]
  selectedId?: string
  onOpen: (questId: string) => void
  onJump: (questId: string) => void
}

const otherName = (quest: Quest) => `${uiText(quest.kind === 'story' ? 'Глава истории' : quest.trader)}: ${uiText(quest.name)}`

/**
 * The tree on the phone: a canvas to drag around is no use on a small screen, so it is the same tree as an outline. The
 * stages in order, each quest under the quest that opens it, and a line that leads to another trader's quest.
 */
export function QuestTreeOutline({ model, availability, lane, matches, selectedId, onOpen, onJump }: QuestTreeOutlineProps) {
  const found = matches && new Set(matches)
  const lanes = model.lanes.filter((entry) => found ? entry.questIds.some((id) => found.has(id)) : lane === 'all' || entry.key === lane)
  return <div className="quest-tree-outline" data-testid="quest-tree-outline">
    {lanes.map((entry) => <OutlineLane key={entry.key} lane={entry} model={model} availability={availability} found={found} showTitle={lanes.length > 1} selectedId={selectedId} onOpen={onOpen} onJump={onJump} />)}
  </div>
}

function OutlineLane({ lane, model, availability, found, showTitle, selectedId, onOpen, onJump }: { lane: QuestTreeLane; model: QuestTreeModel; availability: QuestTreeAvailability; found?: Set<string>; showTitle: boolean; selectedId?: string; onOpen: (id: string) => void; onJump: (id: string) => void }) {
  const row = (id: string, depth: number): ReactNode => {
    const quest = model.quests.get(id)!
    const status = questTreeStatus(availability.get(id))
    const before = (model.incoming.get(id) ?? []).filter((link) => link.from !== model.parentOf.get(id))
    const after = (model.outgoing.get(id) ?? []).filter(isChipLink)
    const shown = !found || found.has(id)
    const indent = found ? 0 : Math.min(depth, MAX_INDENT)
    return <div key={id} className="quest-tree-outline-branch">
      {shown && <>
        <button type="button" className={`quest-tree-row is-${status.key}${id === selectedId ? ' is-selected' : ''}`} style={{ marginLeft: indent * 12, width: `calc(100% - ${indent * 12}px)` }} aria-current={id === selectedId ? 'true' : undefined} onClick={() => onOpen(id)}>
          <StatusMark status={status.key} />
          <span className="quest-tree-row-copy">
            <strong>{uiText(quest.name)}</strong>
            <small>{uiText(`ур. ${quest.level}`)}{status.text ? ` · ${uiText(status.text)}` : ''}{quest.kappa ? ` · ${uiText('капа')}` : ''}</small>
          </span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        {before.map((link) => <button key={link.from} type="button" className="quest-tree-row-link" style={{ marginLeft: indent * 12 + 24 }} onClick={() => onJump(link.from)}>{uiText('после')} {otherName(model.quests.get(link.from)!)}</button>)}
        {after.map((link) => <button key={link.to} type="button" className="quest-tree-row-link" style={{ marginLeft: indent * 12 + 24 }} onClick={() => onJump(link.to)}>{uiText('открывает')} {otherName(model.quests.get(link.to)!)}</button>)}
      </>}
      {(model.children.get(id) ?? []).map((child) => row(child, depth + 1))}
    </div>
  }
  return <section className="quest-tree-outline-lane" aria-label={uiText(lane.story ? 'Главы истории' : lane.trader)}>
    {showTitle && <h3>{uiText(lane.story ? 'Главы истории' : lane.trader)}</h3>}
    {lane.steps.map((step) => {
      const label = stepLabel(step, lane)
      const hasMatch = !found || step.roots.some((root) => subtreeHas(model, root, found))
      if (!hasMatch) return null
      return <div key={step.key} className="quest-tree-outline-step">
        <div className="quest-tree-outline-step-title">{uiText(label.title)}{label.detail ? <small>{uiText(label.detail)}</small> : null}</div>
        {step.roots.map((root) => row(root, 0))}
      </div>
    })}
  </section>
}

function subtreeHas(model: QuestTreeModel, id: string, found: Set<string>): boolean {
  return found.has(id) || (model.children.get(id) ?? []).some((child) => subtreeHas(model, child, found))
}
