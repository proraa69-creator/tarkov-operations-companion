import type { BuildGuidePart, Quest } from '../domain/types'

/**
 * Parts the guide sites (src/data/tarkovHelpGunsmith.ts, src/data/wikiGunsmith.ts) leave out of a Gunsmith build, added at
 * the end of their list; the rest of their build, its screenshot and the app's own picture stay as they are.
 *
 * «Оружейник. АКМ» (owner, 16.11.2026: «Внизу у нас не хватало в АКМ приклада и крепления его. ПТ АКМ крепление и сам
 * приклад ПТ1. Все остальное у нас верное»): tarkov.help's build lacks the stock — the ПТ АКМ lock and the ПТ-1 stock.
 */
interface OwnerAddition { questId: string; weaponId: string; parts: Array<{ itemId: string; name: string; nameEn: string }> }

export const OWNER_GUNSMITH_ADDITIONS: readonly OwnerAddition[] = [
  {
    questId: '5ae3270f86f77445ba41d4dd',
    weaponId: '59d6088586f774275f37482f',
    parts: [
      { itemId: '5b222d335acfc4771e1be099', name: 'Замок-адаптер Зенит "ПТ" для АКМ', nameEn: 'AKM Zenit PT Lock' },
      { itemId: '5b222d405acfc400153af4fe', name: 'Приклад Зенит "ПТ-1 Классика" для АК', nameEn: 'AK Zenit PT-1 "Klassika" stock' },
    ],
  },
]

/** The owner's parts at the end of the guide's build, when it lacks them; `english`: the catalog's language is English. */
export function withOwnerGuides(quests: Quest[], english = false): Quest[] {
  return quests.map((quest) => {
    const owned = OWNER_GUNSMITH_ADDITIONS.filter((entry) => entry.questId === quest.id)
    if (!owned.length || !quest.objectiveDetails?.some((objective) => objective.build?.guide)) return quest
    return {
      ...quest,
      objectiveDetails: quest.objectiveDetails.map((objective) => {
        const build = objective.build
        const guide = build?.guide
        const addition = build && owned.find((entry) => entry.weaponId === build.weaponId)
        if (!build || !guide || !addition) return objective
        const listed = new Set(guide.parts.map((part) => part.itemId))
        const added: BuildGuidePart[] = addition.parts.filter((part) => !listed.has(part.itemId)).map((part) => ({
          itemId: part.itemId,
          name: english ? part.nameEn : part.name,
          ...(build.partIds.includes(part.itemId) ? { required: true } : {}),
          sellers: [],
        }))
        return added.length ? { ...objective, build: { ...build, guide: { ...guide, parts: [...guide.parts, ...added] } } } : objective
      }),
    }
  })
}
