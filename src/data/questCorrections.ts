import type { Quest } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * Quests whose tarkov.dev data is wrong, corrected from the owner's checked source. A correction is pinned: it applies on
 * every catalog build (the server's quest base and the app's own fetch both go through src/data/catalogSource.ts), so a
 * later server or tarkov.dev update never overwrites it. The result carries `manualCorrection` as the mark.
 */
interface QuestCorrection {
  /** Where the corrected values come from and when the owner checked them. */
  source: string
  checkedAt: string
  apply: (quest: Quest, locale: AppLocale) => Quest
}

const PRAPOR = '54cb50c76803fa8b248b4571'
const AK12 = '6499849fc93611967b034949'
const AK12_SUPPRESSOR = '64c196ad26a15b84aa07132f'
const PS320 = '5c0517910db83400232ffee5'
const TRAILER_CABIN_KEY = '5913611c86f77479e0084092'
const PATRIOT_MAPS =['streets-of-tarkov', 'shoreline', 'ground-zero']

const CORRECTIONS: Record<string, QuestCorrection> = {
  // «Работа для патриота» (owner, 14.10.2026: «у нас не правильная информация», tarkov.help): Streets, Shoreline or Ground
  // Zero instead of Lighthouse, Customs or Reserve; Prapor loyalty 2; 10 000 experience, +0.25 Prapor, 200 000 ₽.
  // Pinned (owner: «при обновлении данных с серверов, не обновляй этот квест, пометь»).
  '64f5deac39e45b527a7c4232': {
    source: 'tarkov.help',
    checkedAt: '2026-10-14',
    apply: (quest, locale) => {
      const objective = locale === 'en'
        ? 'Eliminate PMC operatives with an AK-12 with the original suppressor and the Valday PS-320 1x/6x scope on Streets of Tarkov, Shoreline or Ground Zero'
        : 'Устранить бойцов ЧВК из АК-12 с оригинальным глушителем и прицелом Валдай ПС-320 1x/6x на локациях Улицы Таркова, Берег или Эпицентр'
      const rewards = locale === 'en'
        ? ['10,000 experience', 'Prapor standing +0.25', 'Toolset × 1', '"Khattabka" VOG-25 hand grenade × 3', 'Roubles × 200000']
        : ['10 000 опыта', 'Репутация у Прапора +0,25', 'Набор инструментов × 1', 'Граната "Хаттабка" на базе ВОГ-25 × 3', 'Рубли × 200000']
      return {
        ...quest,
        level: 15,
        experience: 10000,
        mapId: PATRIOT_MAPS[0],
        mapIds: PATRIOT_MAPS,
        anyMap: false,
        objectives: [objective],
        objectiveDetails: (quest.objectiveDetails ?? []).map((detail, index) => index === 0 ? { ...detail, description: objective, count: 10, mapIds: PATRIOT_MAPS } : detail),
        rewards,
        traderLoyalty: { needed: [{ traderId: PRAPOR, level: 2 }], reached: quest.traderLoyalty?.reached ?? [] },
        raidRequirements: [
          { itemId: AK12, count: 1, purpose: 'bring', mapIds: PATRIOT_MAPS },
          { itemId: AK12_SUPPRESSOR, count: 1, purpose: 'bring', mapIds: PATRIOT_MAPS },
          { itemId: PS320, count: 1, purpose: 'bring', mapIds: PATRIOT_MAPS },
        ],
      }
    },
  },
  // «Золотые понты» (owner, 31.10.2026, a player's report: «для золотых понтов он больше не нужен»): the golden Zibbo is no
  // longer in the trailer park cabin — it is found on Customs and an ordinary Zibbo is planted in dorm room 303 (tarkov.dev's
  // own objective texts); tarkov.dev still lists the cabin key from the old version. The room 303 key stays.
  '5979eee086f774311955e614': {
    source: 'tarkov.dev objectives, player report',
    checkedAt: '2026-10-31',
    apply: (quest) => ({
      ...quest,
      requiredItems: quest.requiredItems?.filter((id) => id !== TRAILER_CABIN_KEY),
      raidRequirements: quest.raidRequirements?.filter((requirement) => requirement.itemId !== TRAILER_CABIN_KEY),
    }),
  },
}

/** The catalog's quests with the pinned corrections applied (both languages), each marked with `manualCorrection`. */
export function applyQuestCorrections(quests: Quest[], locale: AppLocale): Quest[] {
  return quests.map((quest) => {
    const correction = CORRECTIONS[quest.id]
    if (!correction) return quest
    return { ...correction.apply(quest, locale), manualCorrection: { source: correction.source, checkedAt: correction.checkedAt } }
  })
}
