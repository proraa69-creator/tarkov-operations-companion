import type { ModeProgress, Quest } from '../domain/types'
import type { TaskAvailability } from './requirementEngine'
import { questStage } from './chronology'
import { TRACKED_SOURCES as TRACKED } from './questBasics'

/** Russian words shown in the chronology (translated at render through uiText). */

export interface ChronologyTag {
  kind: 'log' | 'chain' | 'line' | 'stage' | 'start' | 'wait'
  text: string
}

const day = (iso: string) => {
  const time = Date.parse(iso)
  return Number.isFinite(time) && time > 0 ? new Date(time).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : ''
}

/** A short tag of what dates a quest's status: «лог 26.09», «по ветке», «откроется на 4-м уровне»… */
export function chronologyTag(quest: Quest, info: TaskAvailability | undefined, progress: ModeProgress): ChronologyTag | undefined {
  const record = progress.taskProgress[quest.id]
  if (record && TRACKED.has(record.source)) return { kind: 'log', text: `${record.source === 'manual-fix' ? 'вручную' : record.source === 'screen-scan' ? 'экран' : 'лог'} ${day(record.updatedAt)}`.trim() }
  if (info?.basis === 'chain') return { kind: 'chain', text: 'по цепочке' }
  if (info?.basis === 'line') return { kind: 'line', text: 'по ветке' }
  if (info?.basis === 'stage') return { kind: 'stage', text: 'по лояльности' }
  if (info?.basis === 'start') return { kind: 'start', text: 'старт' }
  if (info?.status === 'locked' && info.line) return { kind: 'wait', text: `откроется на ${info.line.level}-м уровне` }
  // a quest the logs do not mention is only dimmed, no words (owner, 12.10.2026, «Оружейник»)
  return undefined
}

/** The full explanation of a quest's status: which quest in the logs dates it and how. */
export function chronologyNote(quest: Quest, info: TaskAvailability | undefined, progress: ModeProgress, questsById: ReadonlyMap<string, Quest>): string | undefined {
  const record = progress.taskProgress[quest.id]
  if (record && TRACKED.has(record.source)) {
    const date = day(record.updatedAt)
    // Which source decided it (src/quests/questEngine.ts): the logs, another PC's logs, the screen or a manual mark.
    if (record.source === 'manual-fix' || record.source === 'manual') {
      const word = record.status === 'completed' ? 'выполнено' : record.status === 'failed' ? 'провалено' : 'в текущих'
      return `${record.source === 'manual-fix' ? 'Отмечено вручную' : 'Старая ручная отметка'}: ${word}${date ? ` ${date}` : ''}.`
    }
    const word = record.status === 'completed' ? 'сдано' : record.status === 'failed' ? 'провалено' : 'взято'
    const where = record.source === 'screen-scan' ? 'С экрана игры' : record.origin === 'server' ? 'В логах игры (другой ПК)' : 'В логах игры'
    return `${where}: ${word}${date ? ` ${date}` : ''}.`
  }
  const anchor = info?.anchorId ? questsById.get(info.anchorId) : undefined
  const anchorName = anchor ? `«${anchor.name}»` : 'задание из логов'
  // Inference never counts (src/quests/questEngine.ts): «вероятно», like the other bases.
  if (info?.basis === 'chain' && info.proof === 'prerequisite') return `Выполнено: без него не взять ${anchorName}.`
  if (info?.basis === 'chain') return `Вероятно выполнено: его требует ${anchorName}.`
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
  return undefined
}
