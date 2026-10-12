import type { ModeProgress, Quest } from '../domain/types'
import type { TaskAvailability } from './requirementEngine'
import { questStage } from './chronology'

/** Russian words shown in the chronology (translated at render through uiText). */
const TRACKED = new Set(['eft-log', 'manual', 'screen-scan'])

export interface ChronologyTag {
  kind: 'log' | 'chain' | 'line' | 'stage' | 'start' | 'wait' | 'unknown'
  text: string
}

const day = (iso: string) => {
  const time = Date.parse(iso)
  return Number.isFinite(time) && time > 0 ? new Date(time).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''
}

/** A short tag of what dates a quest's status: «лог 26.09», «по ветке», «откроется на 4-м уровне»… */
export function chronologyTag(quest: Quest, info: TaskAvailability | undefined, progress: ModeProgress): ChronologyTag | undefined {
  const record = progress.taskProgress[quest.id]
  if (record && TRACKED.has(record.source)) return { kind: 'log', text: `лог ${day(record.updatedAt)}`.trim() }
  if (info?.basis === 'chain') return { kind: 'chain', text: 'по цепочке' }
  if (info?.basis === 'line') return { kind: 'line', text: 'по ветке' }
  if (info?.basis === 'stage') return { kind: 'stage', text: 'по лояльности' }
  if (info?.basis === 'start') return { kind: 'start', text: 'старт' }
  if (info?.status === 'locked' && info.line) return { kind: 'wait', text: `откроется на ${info.line.level}-м уровне` }
  if (info?.status === 'unknown') return { kind: 'unknown', text: 'нет в логах' }
  return undefined
}

/** The full explanation of a quest's status: which quest in the logs dates it and how. */
export function chronologyNote(quest: Quest, info: TaskAvailability | undefined, progress: ModeProgress, questsById: ReadonlyMap<string, Quest>): string | undefined {
  const record = progress.taskProgress[quest.id]
  if (record && TRACKED.has(record.source)) {
    const word = record.status === 'completed' ? 'сдано' : record.status === 'failed' ? 'провалено' : 'взято'
    const date = day(record.updatedAt)
    return `В логах игры: ${word}${date ? ` ${date}` : ''}.`
  }
  const anchor = info?.anchorId ? questsById.get(info.anchorId) : undefined
  const anchorName = anchor ? `«${anchor.name}»` : 'задание из логов'
  if (info?.basis === 'chain') return `Выполнено раньше: его требует ${anchorName}.`
  if (info?.basis === 'line') {
    const level = anchor?.unlock?.lines?.find((line) => quest.unlock?.lines?.some((own) => own.id === line.id))?.level
    return `Вероятно выполнено: в логах уже есть ${anchorName}${level ? ` — ${level}-й уровень той же ветки` : ''}.`
  }
  if (info?.basis === 'stage') {
    const stage = anchor ? questStage(anchor) : undefined
    return `Вероятно выполнено: в логах уже есть ${anchorName}${stage ? ` — лояльность ${stage} у этого торговца` : ''}.`
  }
  if (info?.basis === 'start') return `Вероятно выполнено: это первое задание торговца, а в логах уже есть ${anchorName}.`
  if (info?.status === 'locked' && info.line) {
    const line = `${info.line.order ? ` ${info.line.order}` : ''}${info.line.ll ? ` (LL${info.line.ll})` : ''}`
    return `Откроется на ${info.line.level}-м уровне ветки${line} торговца. ${info.line.reached ? `По логам ветка дошла до ${info.line.reached}-го уровня.` : 'По логам ветка ещё не начата.'}`
  }
  if (info?.status === 'unknown') return 'Логи об этом задании молчат, а задания игрока начались раньше самых старых логов.'
  return undefined
}
