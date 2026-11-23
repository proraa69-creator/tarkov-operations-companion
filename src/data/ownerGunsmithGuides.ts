import type { BuildGuidePart, Quest } from '../domain/types'

/**
 * Parts the guide sites (src/data/tarkovHelpGunsmith.ts, src/data/wikiGunsmith.ts) leave out of a Gunsmith build, added at
 * the end of their list, and the weapon's own parts the build takes off (`withoutSlots`); the rest of their build, its
 * screenshot and the app's own picture stay as they are.
 *
 * «Оружейник. АКМ» (owner, 16.11.2026: «Внизу у нас не хватало в АКМ приклада и крепления его. ПТ АКМ крепление и сам
 * приклад ПТ1. Все остальное у нас верное»): tarkov.help's build lacks the stock — the ПТ АКМ lock and the ПТ-1 stock.
 *
 * «Оружейник. АК-105» (a player via the owner, 23.11.2026: «на ак 105 стоит приклад и стоковая ручка, а нужно убрать приклад и
 * ручка молот», with the game's screen): the task's weight limit is 4.8 kg and the site's parts on the weapon's own stock and
 * grip weigh 4.81 — the build has no stock and the Molot bakelite grip.
 */
interface OwnerAddition {
  questId: string
  weaponId: string
  parts: Array<{ itemId: string; name: string; nameEn: string }>
  /** The weapon's slots the build leaves empty (BuildGuide.withoutSlots). */
  withoutSlots?: string[]
}

export const OWNER_GUNSMITH_ADDITIONS: readonly OwnerAddition[] = [
  {
    questId: '5ae3270f86f77445ba41d4dd',
    weaponId: '59d6088586f774275f37482f',
    parts: [
      { itemId: '5b222d335acfc4771e1be099', name: 'Замок-адаптер Зенит "ПТ" для АКМ', nameEn: 'AKM Zenit PT Lock' },
      { itemId: '5b222d405acfc400153af4fe', name: 'Приклад Зенит "ПТ-1 Классика" для АК', nameEn: 'AK Zenit PT-1 "Klassika" stock' },
    ],
  },
  {
    questId: '5ae327c886f7745c7b3f2f3f',
    weaponId: '5ac66d9b5acfc4001633997a',
    parts: [
      { itemId: '59e6318286f77444dd62c4cc', name: 'Пистолетная рукоятка бакелитовая Молот для АК', nameEn: 'AK bakelite pistol grip (Molot)' },
    ],
    withoutSlots: ['mod_stock'],
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
        const without = (addition.withoutSlots ?? []).filter((slot) => !guide.withoutSlots?.includes(slot))
        if (!added.length && !without.length) return objective
        return { ...objective, build: { ...build, guide: {
          ...guide,
          parts: [...guide.parts, ...added],
          ...(without.length ? { withoutSlots: [...(guide.withoutSlots ?? []), ...without] } : {}),
        } } }
      }),
    }
  })
}
