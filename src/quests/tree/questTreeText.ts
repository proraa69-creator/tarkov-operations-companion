import { provenCompleted, type TaskAvailability } from '../../progression/requirementEngine'
import { questStatusText } from '../../shared/questStatus'
import type { QuestTreeLane, QuestTreeStep } from './questTreeModel'

/** A quest's status in the tree: the same one the lists show; a completion the game did not report stays marked apart. */
export function questTreeStatus(info: TaskAvailability | undefined): { key: string; text: string } {
  const status = info?.status ?? 'unknown'
  if (status === 'completed' && !provenCompleted(info)) return { key: 'probable', text: 'вероятно' }
  return { key: status, text: questStatusText(status) }
}

/** The words of a stage on the trunk. `hint`: what opens it (the same words as «Каталог заданий»). */
export function stepLabel(step: QuestTreeStep, lane: QuestTreeLane): { title: string; detail?: string; hint: string } {
  if (step.kind === 'start') return { title: 'Старт', hint: 'первые задания, выдаются в диалоге' }
  if (step.kind === 'story') return { title: 'Главы истории', hint: 'по порядку глав' }
  if (step.kind === 'line') return { title: `Ветка ${step.order ?? ''}${step.ll ? ` · LL${step.ll}` : ''}`.replace('  ', ' '), detail: `Уровень ${step.level ?? 1}`, hint: 'задания открываются по уровням ветки' }
  if (step.kind === 'stage') return { title: `Лояльность ${step.ll ?? ''}`.trim(), hint: 'по цепочкам и лояльности' }
  return lane.hasLines ? { title: 'Вне веток', hint: 'сюжет, события, задания других торговцев' } : { title: 'Начало', hint: 'первые задания торговца' }
}
