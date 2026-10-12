import type { QuestUnlock } from '../domain/types'

/**
 * tarkov.dev `otherRequirements` of a task → its line and dialogue conditions (src/domain/types.ts QuestUnlock).
 *
 * - `{ type: 'globalVariable', variableId, compareMethod: '>=', value: 3 }`: the trader line `variableId` at level 3;
 *   `>` is one level more, `=`/`==` that level. Other comparisons (a line that must stay low) do not open anything.
 * - `{ type: 'dialogue' }`: given in a trader dialogue (the trader's first tasks).
 */
export function unlockFromRequirements(requirements: unknown): QuestUnlock | undefined {
  if (!Array.isArray(requirements)) return undefined
  const lines: NonNullable<QuestUnlock['lines']> = []
  let dialogue = false
  for (const entry of requirements) {
    if (!entry || typeof entry !== 'object') continue
    const requirement = entry as Record<string, unknown>
    if (requirement.type === 'dialogue') dialogue = true
    if (requirement.type !== 'globalVariable' || typeof requirement.variableId !== 'string' || !requirement.variableId) continue
    const value = Number(requirement.value)
    if (!Number.isFinite(value)) continue
    const compare = String(requirement.compareMethod ?? '>=')
    const level = compare === '>' ? value + 1 : compare === '>=' || compare === '=' || compare === '==' ? value : undefined
    if (level !== undefined && level >= 1 && !lines.some((line) => line.id === requirement.variableId)) lines.push({ id: requirement.variableId, level })
  }
  return lines.length || dialogue ? { ...(lines.length ? { lines } : {}), ...(dialogue ? { dialogue: true } : {}) } : undefined
}
