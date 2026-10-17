/** English for «Ивент-квесты» (owner app: the event quests' list and editor, src/components/EventQuestsEditor.tsx). */
export const EVENT_QUEST_PHRASES: Array<[string, string]> = [
  ['Ивент-квесты', 'Event quests'], ['Ивент-квест', 'Event quest'],
  ['Добавить и изменить квесты ивентов: название, цели, награды, окончание', 'Add and edit event quests: title, objectives, rewards, end'],
  ['Квесты ивентов, которых нет в tarkov.dev. Изменения сразу видят все игроки; квест с тем же названием из tarkov.dev заменяет наш.', 'Event quests tarkov.dev does not have. Every player sees changes at once; a tarkov.dev quest with the same title replaces ours.'],
  ['Загрузка с сервера…', 'Loading from the server…'],
  ['с правками', 'edited'], ['исходный', 'original'], ['свой квест', 'own quest'], ['скрыт у игроков', 'hidden from players'], ['ивент завершён', 'event over'],
  ['Добавить квест', 'Add quest'], ['Возвращён исходный квест', 'The original quest is back'], ['Квест удалён', 'Quest deleted'],
  ['Вернуть исходный квест', 'Restore the original quest'], ['Ваши правки этого квеста удалятся.', 'Your changes to this quest will be deleted.'],
  ['Удалить квест', 'Delete the quest'], ['Игроки перестанут его видеть.', 'Players will no longer see it.'],
  ['Править ивент-квесты может только аккаунт владельца.', 'Only the owner account can edit event quests.'],
  ['Ивент-квест (изменён)', 'Event quest (edited)'], ['Ивент-квест (исходный)', 'Event quest (original)'], ['Свой ивент-квест', 'Own event quest'], ['Новый ивент-квест', 'New event quest'],
  ['EN (пусто — как RU)', 'EN (empty: as RU)'],
  ['Серия', 'Series'], ['Подпись серии (например, «ивент до 20 октября»)', 'Series caption (e.g. “event until 20 October”)'],
  ['Выберите торговца', 'Choose a trader'], ['Режимы', 'Modes'],
  ['Ивент до (ваше время; пусто — без окончания)', 'Event until (your time; empty: no end)'], ['Окончание ивента', 'Event end'],
  ['Скрыть квест у игроков', 'Hide the quest from players'],
  ['Предыдущие квесты (нужно выполнить)', 'Previous quests (must be completed)'], ['Найти квест по названию…', 'Find a quest by title…'], ['Найти предыдущий квест', 'Find a previous quest'],
  ['Тип цели', 'Objective type'], ['необязательная', 'optional'], ['Удалить цель', 'Delete the objective'], ['Добавить цель', 'Add objective'],
  ['Цели устранения', 'Kill targets'], ['Кого устранить', 'Whom to eliminate'],
  ['Предметы (любой из них)', 'Items (any of them)'], ['Добавить предмет', 'Add item'],
  ['Награда', 'Reward'], ['Выдаётся при взятии задания', 'Given when the task is taken'],
  ['Навыки в награде (например, «Хирургия +1 уровень»)', 'Skill rewards (e.g. “Surgery +1 level”)'], ['Добавить навык', 'Add skill'],
  ['Укажите название квеста (RU).', 'Enter the quest title (RU).'], ['Выберите торговца.', 'Choose a trader.'], ['Укажите название серии (RU).', 'Enter the series name (RU).'],
  ['Отметьте хотя бы один режим.', 'Tick at least one mode.'], ['Добавьте хотя бы одну цель.', 'Add at least one objective.'], ['У каждой цели должен быть текст (RU).', 'Every objective needs a text (RU).'],
  ['Слишком много ивент-квестов. Удалите лишние.', 'Too many event quests. Delete some.'], ['Ивент-квест не найден', 'Event quest not found'],
  // Objective types and kill targets
  ['Посетить место', 'Visit a place'], ['Устранить цели', 'Eliminate targets'], ['Передать предмет', 'Hand over an item'],
  ['Установить предмет', 'Plant an item'], ['Найти квестовый предмет', 'Find a quest item'], ['Передать квестовый предмет', 'Hand over a quest item'],
  ['Установить квестовый предмет', 'Plant a quest item'], ['Использовать предмет', 'Use an item'], ['Совершить переход', 'Use a transit'], ['Действие в убежище', 'Hideout action'],
  // «ЧВК», «Дикие», «Рейдеры» and «Найти предмет» are in the other dictionaries
  ['Любые цели', 'Any targets'],
]

export const EVENT_QUEST_RULES: Array<[RegExp, string]> = [
  [/^Текст цели (\d+)$/g, 'Objective $1 text'],
]
