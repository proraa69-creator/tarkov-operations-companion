import { uiText } from '../i18n/renderText'
import type { Quest } from '../domain/types'

export function matchesQuestSearch(
  quest: Quest,
  query: string,
  raidMode: string,
): boolean {
  if (!query.trim()) return true

  const lowerQuery = query.toLowerCase()

  const searchFields = [
    quest.name,
    quest.trader,
    quest.description,
    quest.level.toString(),
    ...((quest.objectives || []) as any[]),
  ]

  return searchFields.some((field) => {
    if (!field) return false
    const searchText = `${field} ${uiText(field)}`.toLowerCase()
    return searchText.includes(lowerQuery)
  })
}

export function getQuestCategory(quest: Quest): 'story' | 'active' | 'completed' | 'kappa' | 'all' {
  if (quest.kind === 'story') return 'story'
  if (quest.kappa) return 'kappa'
  return 'all'
}

export function sortQuests(quests: Quest[], locale: string): Quest[] {
  return quests.sort((left, right) => {
    if (left.kappa && !right.kappa) return -1
    if (!left.kappa && right.kappa) return 1
    if (left.level !== right.level) return left.level - right.level
    if (left.trader !== right.trader) return left.trader.localeCompare(right.trader, locale)
    return left.name.localeCompare(right.name, locale)
  })
}
