/**
 * English for the quest constructor's point menu and window (owner app: components/PointConstructor.tsx), the pencils
 * of the quest window (components/QuestSheetEditing.tsx) and what players see of a point's items and photos
 * (components/PointPhotos.tsx, QuestCuratedInfo.tsx).
 */
export const POINT_CONSTRUCTOR_PHRASES: Array<[string, string]> = [
  // The point menu
  ['Меню точки', 'Point menu'], ['Редактировать', 'Edit'], ['Тип точки', 'Point type'], ['Новая пустая точка', 'New empty point'],
  ['Удалить точку', 'Delete point'], ['Скрыть точку', 'Hide point'],
  ['Новая пустая точка — правый клик: настроить', 'New empty point: right-click to set it up'],
  ['Поставить точку', 'Place a point'],
  ['Клик по карте ставит пустую точку; правый клик по ней — значок, квест, описание, предмет и фото', 'A click on the map places an empty point; right-click it to set the emblem, quest, description, item and photo'],
  ['Точку можно перетащить мышью — сохраняется сразу. Новая и перенесённая точка встают на выбранный этаж. Правый клик по точке — меню: настроить, удалить.', 'Drag a point with the mouse: it is saved at once. New and moved points go to the selected floor. Right-click a point for its menu: set up, delete.'],
  ['Настроить точку', 'Set up point'], ['Настроить точку: значок, цель / этап, описание, предмет, фото', 'Set up the point: emblem, objective / stage, description, item, photo'],
  // The point window
  ['Настройки точки', 'Point settings'], ['Новая точка', 'New point'], ['Точка, добавленная вручную', 'Point added by hand'], ['Исходная точка квеста', 'Original quest point'],
  ['Значок точки', 'Point emblem'],
  ['У исходной точки квеста можно сменить только цель / этап и вид квестовой метки.', 'An original quest point can only change its objective / stage and the kind of quest marker.'],
  ['Найти квест для точки', 'Find a quest for the point'], ['Найденные квесты', 'Quests found'], ['Цель / этап точки', 'Point objective / stage'], ['Без цели / этапа', 'No objective / stage'],
  ['Заголовок, например «Склад у заправки»', 'Title, e.g. “Storage by the gas station”'],
  ['Предметы из каталога', 'Catalog items'], ['Предметы точки', 'Point items'], ['Убрать предмет', 'Remove item'], ['Искать', 'Look for'],
  ['Фото: где искать', 'Photo: where to look'], ['Фото места', 'Photo of the place'], ['Фото точки', 'Point photos'],
  ['JPG, PNG или WEBP до 5 МБ, не больше 4 фото на точку.', 'JPG, PNG or WEBP up to 5 MB, at most 4 photos per point.'],
  ['Загрузка фото…', 'Loading photo…'], ['Фото не загрузилось', 'The photo did not upload'], ['Фото видно после входа в аккаунт', 'Sign in to see the photo'],
  ['Фото не найдено', 'Photo not found'], ['Сервер не принял фото', 'The server did not accept the photo'], ['Нет связи с сервером', 'No connection to the server'],
  ['Выберите квест для точки квеста.', 'Pick a quest for a quest point.'],
  ['Эту точку карты изменить нельзя: она из каталога, а не из конструктора.', 'This map point cannot be changed: it comes from the catalog, not the constructor.'],
  ['У исходной точки квеста значок только квестовый. Для другой точки поставьте новую.', 'An original quest point keeps a quest emblem. Place a new point for anything else.'],
  // The quest window's pencils
  ['Изменить точку', 'Edit point'], ['Изменить требования', 'Edit requirements'], ['Требований от Raid OS нет.', 'No Raid OS requirements.'],
  ['Название квеста', 'Quest title'], ['Описание квеста', 'Quest description'], ['Заголовок этапа', 'Stage title'], ['Задача этапа', 'Stage task'], ['русский', 'Russian'],
  ['Изменить: название квеста', 'Edit: quest title'], ['Изменить: описание квеста', 'Edit: quest description'], ['Изменить: цель', 'Edit: objective'],
  ['Изменить: заголовок этапа', 'Edit: stage title'], ['Изменить: задача этапа', 'Edit: stage task'],
]

export const POINT_CONSTRUCTOR_RULES: Array<[RegExp, string]> = [
  [/^Фото места: (\d+)$/g, 'Photos of the place: $1'],
]
