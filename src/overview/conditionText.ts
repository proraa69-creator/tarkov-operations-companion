/**
 * Short Russian words for a kill objective's conditions («×10 · ЧВК · 50+ м · голова»). They go through uiText like
 * every interface text: the English is in src/i18n/uiEnglishQuestConditions.ts.
 */
import type { ObjectiveConditions, QuestObjective } from '../domain/types'

/** The game's target roles in a word; a boss or any other role keeps the catalog's name. */
const TARGETS: Record<string, string> = {
  AnyPmc: 'ЧВК', Usec: 'USEC', Bear: 'BEAR', Savage: 'Дикие', assaultGroup: 'Дикие', Any: 'любые цели', Marksman: 'снайперы',
  PmcBot: 'рейдеры', ExUsec: 'отступники', exUsecFree: 'отступники',
}

const BODY_PARTS: Record<string, string> = {
  Head: 'голова', Chest: 'грудь', Stomach: 'живот', LeftArm: 'руки', RightArm: 'руки', LeftLeg: 'ноги', RightLeg: 'ноги',
}

export function targetWord(target: { key: string; name: string }) {
  return TARGETS[target.key] ?? target.name
}

export function bodyPartWord(part: { key: string; name: string }) {
  return BODY_PARTS[part.key] ?? part.name
}

export function distanceText(distance: NonNullable<ObjectiveConditions['distance']>) {
  return distance.compare === '>=' ? `${distance.value}+ м` : `до ${distance.value} м`
}

export function timeText(time: NonNullable<ObjectiveConditions['time']>) {
  const hour = (value: number) => `${String(value).padStart(2, '0')}:00`
  return `${hour(time.from)}–${hour(time.until)}`
}

/** The short line under the pictures: count, targets, distance, body parts, hours. Each piece is one uiText. */
export function conditionPieces(objective: Pick<QuestObjective, 'count'> & { conditions?: ObjectiveConditions }): string[] {
  const conditions = objective.conditions ?? {}
  const targets = [...new Set((conditions.targets ?? []).map(targetWord))]
  const parts = [...new Set((conditions.bodyParts ?? []).map(bodyPartWord))]
  return [
    objective.count > 1 ? `×${objective.count}` : '',
    targets.join(', '),
    conditions.distance ? distanceText(conditions.distance) : '',
    parts.join(', '),
    conditions.time ? timeText(conditions.time) : '',
    conditions.hitOnly ? 'попадание' : '',
  ].filter(Boolean)
}
