/** English for «Сбор на рейд» on the Overview (src/overview/QuestConditionsCard.tsx, src/overview/conditionText.ts). */
export const QUEST_CONDITION_PHRASES: Array<[string, string]> = [
  ['Сбор на рейд', 'Raid loadout'],
  ['На этой карте нет квестов с условиями на снаряжение', 'No quests with gear conditions on this map'],
  ['Подробнее о сборке и предметах', 'The build and the items in detail'],
  ['Подходит и другое оружие из списка', 'Other weapons of the list count too'],
  ['Есть и другие варианты модулей', 'Other part options count too'], ['Есть и другие варианты снаряжения', 'Other gear options count too'],
  ['Надеть', 'Wear'], ['Модули на оружии', 'Weapon parts'],
  ['все вместе', 'all of them'],
  ['Условия убийства', 'Kill conditions'], ['Убить', 'Kill'], ['Попасть', 'Hit'], ['Противник', 'Target'], ['Дистанция', 'Distance'],
  ['Части тела', 'Body parts'], ['Зоны', 'Zones'], ['только в зонах задания', 'only in the task zones'], ['Время в игре', 'In-game time'],
  ['Цель под эффектом', 'Target under effect'], ['Вы под эффектом', 'You under effect'], ['Открыть квест', 'Open task'],
  // the short words of the card's line (src/overview/conditionText.ts)
  ['ЧВК', 'PMC'], ['Дикие', 'Scavs'], ['любые цели', 'any target'], ['снайперы', 'Sniper Scavs'], ['рейдеры', 'Raiders'], ['отступники', 'Rogues'],
  // the sections of quests with gear conditions (src/overview/GearQuestSection.tsx)
  ['С условиями на снаряжение', 'Gear conditions'], ['Снаряжение для рейда', 'Raid gear'],
  ['голова', 'head'], ['грудь', 'thorax'], ['живот', 'stomach'], ['руки', 'arms'], ['ноги', 'legs'], ['попадание', 'a hit counts'],
]

/** Templates with numbers. */
export const QUEST_CONDITION_RULES: Array<[RegExp, string]> = [
  [/^ещё (\d+)$/g, '$1 more'],
  [/^(\d+)\+ м$/g, '$1+ m'],
  [/^до (\d+) м$/g, 'within $1 m'],
  [/^Показать все \((\d+)\)$/g, 'Show all ($1)'],
  // «или любое из N» after the one example of a choice (src/overview/QuestConditionsCard.tsx ChoiceMore)
  [/^или любое из (\d+)$/g, 'or any of $1'],
  [/^или другой вариант из (\d+)$/g, 'or another option of $1'],
]
