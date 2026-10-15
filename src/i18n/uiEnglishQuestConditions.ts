/** English for «Условия квестов» on the Overview (src/overview/QuestConditionsCard.tsx, src/overview/conditionText.ts). */
export const QUEST_CONDITION_PHRASES: Array<[string, string]> = [
  ['Сбор на рейд', 'Raid loadout'],
  ['На этой карте нет квестов с условиями на снаряжение', 'No quests with gear conditions on this map'],
  ['Подробнее о сборке и предметах', 'The build and the items in detail'],
  ['Подходит и другое оружие из списка', 'Other weapons of the list count too'],
  ['Есть и другие варианты модулей', 'Other part options count too'], ['Есть и другие варианты снаряжения', 'Other gear options count too'],
  ['Нельзя надевать', 'Do not wear'], ['Надеть', 'Wear'], ['Модули на оружии', 'Weapon parts'],
  ['все вместе', 'all of them'], ['любой из', 'any one'], ['любое из', 'any one'], ['любой из вариантов', 'any one option'],
  ['Условия убийства', 'Kill conditions'], ['Убить', 'Kill'], ['Попасть', 'Hit'], ['Противник', 'Target'], ['Дистанция', 'Distance'],
  ['Части тела', 'Body parts'], ['Зоны', 'Zones'], ['только в зонах задания', 'only in the task zones'], ['Время в игре', 'In-game time'],
  ['Цель под эффектом', 'Target under effect'], ['Вы под эффектом', 'You under effect'], ['Открыть квест', 'Open task'],
  // the short words of the card's line (src/overview/conditionText.ts)
  ['ЧВК', 'PMC'], ['Дикие', 'Scavs'], ['любые цели', 'any target'], ['снайперы', 'Sniper Scavs'], ['рейдеры', 'Raiders'], ['отступники', 'Rogues'],
  ['голова', 'head'], ['грудь', 'thorax'], ['живот', 'stomach'], ['руки', 'arms'], ['ноги', 'legs'], ['попадание', 'a hit counts'],
]

/** Templates with numbers. */
export const QUEST_CONDITION_RULES: Array<[RegExp, string]> = [
  [/^ещё (\d+)$/g, '$1 more'],
  [/^(\d+)\+ м$/g, '$1+ m'],
  [/^до (\d+) м$/g, 'within $1 m'],
  [/^Вариант (\d+)$/g, 'Option $1'],
  [/^ничего из (\d+)$/g, 'none of $1'],
  [/^Показать все \((\d+)\)$/g, 'Show all ($1)'],
]
