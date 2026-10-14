import type { Quest } from '../domain/types'
import type { AppLocale } from '../i18n/LocaleProvider'

/**
 * Quests whose tarkov.dev data lags behind the game, corrected from the owner's checked source. Each correction applies
 * only while tarkov.dev still has the old values it was written against, so a later tarkov.dev fix wins on its own.
 */
interface QuestCorrection {
  /** The old upstream state this correction replaces. */
  stale: (quest: Quest) => boolean
  apply: (quest: Quest, locale: AppLocale) => Quest
}

const PRAPOR = '54cb50c76803fa8b248b4571'
const AK12 = '6499849fc93611967b034949'
const AK12_SUPPRESSOR = '64c196ad26a15b84aa07132f'
const PS320 = '5c0517910db83400232ffee5'
const PATRIOT_MAPS = ['streets-of-tarkov', 'shoreline', 'ground-zero']

const CORRECTIONS: Record<string, QuestCorrection> = {
  // «Работа для патриота» (owner, 14.10.2026: «у нас не правильная информация», tarkov.help): Streets, Shoreline or Ground
  // Zero instead of Lighthouse, Customs or Reserve; Prapor loyalty 2; 10 000 experience, +0.25 Prapor, 200 000 ₽.
  '64f5deac39e45b527a7c4232': {
    stale: (quest) => quest.experience === 18000 || Boolean(quest.mapIds?.includes('lighthouse')),
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
}

/** The catalog's quests with the known corrections applied (both languages). */
export function applyQuestCorrections(quests: Quest[], locale: AppLocale): Quest[] {
  return quests.map((quest) => {
    const correction = CORRECTIONS[quest.id]
    return correction && correction.stale(quest) ? correction.apply(quest, locale) : quest
  })
}
