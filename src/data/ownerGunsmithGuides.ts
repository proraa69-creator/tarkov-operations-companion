import type { BuildGuidePart, Quest } from '../domain/types'

/**
 * The owner's own builds of Gunsmith tasks, over tarkov.help's and the wiki's (src/data/tarkovHelpGunsmith.ts,
 * src/data/wikiGunsmith.ts): a task whose specification changed while the guide sites still show the old build.
 *
 * «Оружейник. АКМ» (owner, 16.11.2026, report 168: «Указанные модификации в гайде не соответствуют требованиям… Механик не
 * принимает»; «собери по сборке на первом скриншоте», «у нас в сборке не хватает пт акм и пт-1»): his build from the game —
 * Fortis Shift (the task asks for it), PMAG 30 GEN M3, «Гексагон», TAPCO SAW, Б-33, Б-10М+Б-19, Short Mount with Short Prism
 * 2.5x, ПТ АКМ with ПТ-1. In the game: ergonomics 49, recoil 84 + 208, sighting range 800. The gas tube and the rear sight
 * are the weapon's own.
 */
interface OwnerGuide { questId: string; weaponId: string; parts: Array<{ itemId: string; name: string; nameEn: string }> }

export const OWNER_GUNSMITH_GUIDES: readonly OwnerGuide[] = [
  {
    questId: '5ae3270f86f77445ba41d4dd',
    weaponId: '59d6088586f774275f37482f',
    parts: [
      { itemId: '59f8a37386f7747af3328f06', name: 'Тактическая рукоятка Fortis "Shift"', nameEn: 'Fortis Shift tactical grip' },
      { itemId: '59d6272486f77466146386ff', name: 'Магазин Magpul "PMAG 30 GEN M3" на 30 патронов 7.62x39 для АК', nameEn: 'AK 7.62x39 Magpul PMAG 30 GEN M3 30-round magazine' },
      { itemId: '593d489686f7745c6255d58a', name: 'Модератор звука Гексагон 7.62x39 для АКМ', nameEn: 'Hexagon AKM 7.62x39 sound suppressor' },
      { itemId: '5947f92f86f77427344a76b1', name: 'Пистолетная рукоятка TAPCO "SAW-Style" для АК (Черная)', nameEn: 'AK TAPCO SAW-Style pistol grip (Black)' },
      { itemId: '5649af884bdc2d1b2b8b4589', name: 'Крышка ствольной коробки Зенит "Б-33" для АК', nameEn: 'AK Zenit B-33 dust cover' },
      { itemId: '5648b4534bdc2d3d1c8b4580', name: 'Цевье Зенит "Б-10М" с накладкой "Б-19" для АК', nameEn: 'AK Zenit B-10M handguard with B-19 upper mount' },
      { itemId: '5c1cdd302e221602b3137250', name: 'Крепление Kiba Arms "Short Mount" для установки прицелов', nameEn: 'Kiba Arms Short Mount sight adapter' },
      { itemId: '5c1cdd512e22161b267d91ae', name: 'Оптический прицел Kiba Arms "Short Prism 2.5x"', nameEn: 'Kiba Arms Short Prism 2.5x scope' },
      { itemId: '5b222d335acfc4771e1be099', name: 'Замок-адаптер Зенит "ПТ" для АКМ', nameEn: 'AKM Zenit PT Lock' },
      { itemId: '5b222d405acfc400153af4fe', name: 'Приклад Зенит "ПТ-1 Классика" для АК', nameEn: 'AK Zenit PT-1 "Klassika" stock' },
    ],
  },
]

/** The owner's builds over whatever guide the tasks have; `english`: the catalog's language is English. */
export function withOwnerGuides(quests: Quest[], english = false): Quest[] {
  return quests.map((quest) => {
    const owned = OWNER_GUNSMITH_GUIDES.filter((guide) => guide.questId === quest.id)
    if (!owned.length || !quest.objectiveDetails?.some((objective) => objective.build)) return quest
    return {
      ...quest,
      objectiveDetails: quest.objectiveDetails.map((objective) => {
        const build = objective.build
        const guide = build && owned.find((entry) => entry.weaponId === build.weaponId)
        if (!build || !guide) return objective
        const parts: BuildGuidePart[] = guide.parts.map((part) => ({
          itemId: part.itemId,
          name: english ? part.nameEn : part.name,
          ...(build.partIds.includes(part.itemId) ? { required: true } : {}),
          sellers: [],
        }))
        return { ...objective, build: { ...build, guide: { source: 'owner' as const, parts } } }
      }),
    }
  })
}
