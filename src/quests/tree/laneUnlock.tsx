/* eslint-disable react-refresh/only-export-components */
import { Route } from 'lucide-react'
import { uiText } from '../../i18n/renderText'
import { provenCompleted } from '../../progression/requirementEngine'
import type { QuestTreeModel } from './questTreeModel'
import { questTreeStatus } from './questTreeText'
import { StatusMark } from './StatusMark'
import type { QuestTreeAvailability } from './QuestTreeView'

export interface LaneUnlock {
  /** Other traders' quests the lane's first quests ask for, in the tree's order. */
  first: string[]
  /** Every quest on the way to them (they too), counted once. */
  path: string[]
  /** The lane's quest whose chain shows the whole way. */
  start: string
}

/**
 * How a trader's quests open (report 133, 10.11.2026: «возможность видеть условия открытия того или иного квеста, например как
 * открыть смотрителя»): the other traders' quests the lane's quests need, and every quest before those. None for a lane whose
 * quests need only their own trader's.
 */
export function laneUnlock(model: Pick<QuestTreeModel, 'lanes' | 'laneOf' | 'incoming' | 'outgoing'>, laneKey: string): LaneUnlock | undefined {
  const lane = model.lanes.find((entry) => entry.key === laneKey)
  if (!lane || lane.story) return undefined
  const own = new Set(lane.questIds)
  const order = new Map(model.lanes.flatMap((entry) => entry.questIds).map((id, index) => [id, index]))
  const first = new Set<string>()
  // The trader's main line: of the quests that need no earlier quest of the same trader, the one most of the lane follows
  // (Lightkeeper: «Источник информации», opened by Mechanic's «На свет. Новое знакомство»). Other lines' own requirements
  // stand in the tree as chips.
  const followers = (id: string, seen = new Set<string>()): number => {
    for (const link of model.outgoing.get(id) ?? []) if (own.has(link.to) && !seen.has(link.to)) { seen.add(link.to); followers(link.to, seen) }
    return seen.size
  }
  const entries = lane.questIds.filter((id) => !(model.incoming.get(id) ?? []).some((link) => own.has(link.from) && link.kind !== 'failed'))
  const main = [...entries].sort((a, b) => followers(b) - followers(a))[0]
  const start: string | undefined = main
  for (const link of main ? model.incoming.get(main) ?? [] : []) if (!own.has(link.from) && link.kind !== 'failed') first.add(link.from)
  if (!first.size || !start) return undefined
  const path = new Set<string>()
  const walk = (id: string) => {
    if (path.has(id)) return
    path.add(id)
    for (const link of model.incoming.get(id) ?? []) if (link.kind !== 'failed' && !own.has(link.from)) walk(link.from)
  }
  first.forEach(walk)
  const byOrder = (a: string, b: string) => (order.get(a) ?? 0) - (order.get(b) ?? 0)
  return { first: [...first].sort(byOrder), path: [...path].sort(byOrder), start }
}

/** «Как открыть Смотрителя»: over the tree of that trader. */
export function LaneUnlockBar({ model, laneKey, availability, onJump, onShowPath }: {
  model: QuestTreeModel
  laneKey: string
  availability: QuestTreeAvailability
  onJump: (questId: string) => void
  onShowPath: (questId: string) => void
}) {
  const unlock = laneUnlock(model, laneKey)
  const lane = model.lanes.find((entry) => entry.key === laneKey)
  if (!unlock || !lane) return null
  const done = unlock.path.filter((id) => provenCompleted(availability.get(id))).length
  return (
    <div className="quest-tree-unlock" data-testid="quest-tree-unlock">
      <strong><Route size={14} aria-hidden="true" />{uiText('Как открыть')}: {uiText(lane.trader)}</strong>
      <span className="quest-tree-unlock-label">{uiText('Сначала выполнить')}:</span>
      <span className="quest-tree-unlock-quests">
        {unlock.first.map((id) => {
          const quest = model.quests.get(id)!
          const status = questTreeStatus(availability.get(id))
          return (
            <button key={id} type="button" className={`quest-tree-unlock-quest is-${status.key}`} title={`${uiText(quest.trader)} · ${uiText(status.text)}`} onClick={() => onJump(id)}>
              <StatusMark status={status.key} />{uiText(quest.name)}<small>{uiText(quest.trader)}</small>
            </button>
          )
        })}
      </span>
      <span className="quest-tree-unlock-count">{uiText('Всего на пути')}: {done}/{unlock.path.length}</span>
      <button type="button" className="button small ghost" onClick={() => onShowPath(unlock.start)}>{uiText('Показать весь путь')}</button>
    </div>
  )
}
