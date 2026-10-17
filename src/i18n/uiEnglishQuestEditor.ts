/**
 * English for the quest constructor «Редактировать квесты» (owner app: points with descriptions, texts, requirements;
 * src/components/QuestPointEditor.tsx, QuestRequirementsEditor.tsx) and for what players see of it (QuestCuratedInfo.tsx).
 */
export const QUEST_EDITOR_PHRASES: Array<[string, string]> = [
  // Sections and status
  ['Разделы квеста', 'Quest sections'], ['Точки', 'Points'], ['Тексты', 'Texts'], ['Требования', 'Requirements'],
  ['Сохранение…', 'Saving…'], ['Отменить', 'Undo'],
  ['Тексты также правятся в окне квеста внизу карты.', 'Texts can also be edited in the quest window at the bottom of the map.'],
  // Point descriptions
  ['Описание для игроков', 'Description for players'], ['Заметка для себя', 'Note to self'], ['Описание точки', 'Point description'],
  ['Заголовок точки', 'Point title'], ['Где и что искать', 'Where and what to look for'],
  ['Заголовок (необязательно), например «Склад у заправки»', 'Title (optional), e.g. “Storage by the gas station”'],
  ['Где и что искать: этаж, дверь, полка…', 'Where and what to look for: floor, door, shelf…'],
  ['Текст на английском', 'English text'], ['Заголовок на английском', 'English title'], ['Описание на английском', 'English description'],
  ['Видите только вы, игроки её не видят', 'Only you see it, players do not'], ['Видите только вы: игроки её не видят', 'Only you see it: players do not'],
  ['Заметка для себя к новым правкам (например, «по баг-репорту»)', 'Note to self for new changes (e.g. “bug report”)'],
  ['с описанием', 'with a description'], ['Убрать описание', 'Remove the description'], ['Напишите описание для игроков.', 'Write a description for players.'],
  ['Где искать', 'Where to look'],
  // Requirements
  ['Требуется', 'Required'], ['Требования квеста', 'Quest requirements'], ['Требование', 'Requirement'],
  ['То, что нужно для квеста: игроки видят это в задании, на карте, в «Требованиях рейда» и в подсказке предмета.', 'What the quest needs: players see it in the task, on the map, in “Raid requirements” and in the item tooltip.'],
  ['У квеста нет требований. Добавьте предмет или ключ из каталога.', 'The quest has no requirements. Add an item or a key from the catalog.'],
  ['Добавить требование', 'Add requirement'], ['Добавить', 'Add'], ['Скрыть требование', 'Hide requirement'], ['Показать снова', 'Show again'],
  ['Вернуть как в каталоге', 'Restore the catalog version'], ['из каталога', 'from the catalog'], ['исправлено', 'corrected'], ['скрыто', 'hidden'],
  ['Взять в рейд', 'Bring into the raid'], ['Нужен ключ', 'Key needed'], ['Использовать', 'Use'],
  ['Что сделать', 'What to do'], ['Кол-во', 'Qty'], ['Количество', 'Count'], ['Привязка', 'Link'],
  ['Без привязки к цели или точке', 'Not linked to an objective or point'],
  ['Комментарий', 'Comment'], ['Комментарий для игроков (необязательно)', 'Comment for players (optional)'],
  ['Комментарий на английском', 'English comment'], ['Комментарий на английском (необязательно)', 'English comment (optional)'],
  ['Добавлено Raid OS: проверено вручную', 'Added by Raid OS: checked by hand'],
  // The catalog picker
  ['Выбор предмета из каталога', 'Pick an item from the catalog'], ['Предмет или ключ из каталога', 'Item or key from the catalog'],
  ['Название предмета или ключа (RU / EN)…', 'Item or key name (RU / EN)…'], ['Найти предмет', 'Find item'],
  ['Фильтр каталога', 'Catalog filter'], ['Предметы каталога', 'Catalog items'], ['Ничего не найдено', 'Nothing found'],
  ['Введите хотя бы две буквы.', 'Type at least two letters.'],
]

export const QUEST_EDITOR_RULES: Array<[RegExp, string]> = [
  [/^Точка (\d+)$/g, 'Point $1'],
  [/^Отменить: (.+)$/g, 'Undo: $1'],
]
