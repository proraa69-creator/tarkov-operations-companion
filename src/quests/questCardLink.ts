import type { Quest } from '../domain/types'

/**
 * The address of a quest's card on the Quests page, on the tab that has it. Without a tab the page opens «Текущие», which
 * lists only the quests taken: on the PC any other quest then showed an empty card or another quest's (owner, 06.11.2026).
 */
export function questCardHref(quest: Pick<Quest, 'id' | 'kind'>) {
  return `/quests?filter=${quest.kind === 'story' ? 'story' : 'all'}&selected=${encodeURIComponent(quest.id)}`
}
