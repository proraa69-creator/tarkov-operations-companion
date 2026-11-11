/**
 * English for «Ваши предложения» → «Добавить точку» (src/components/SuggestPointSection.tsx, SupportButtons.tsx), the
 * owner's «Принять точку» (src/reports/ReportsTable.tsx) and the server's answers (server/src/routes/bugReports.ts).
 */
export const SUGGEST_POINT_PHRASES: Array<[string, string]> = [
  ['Добавить точку', 'Add a point'],
  ['К предложению', 'Back to the suggestion'],
  ['Чтобы подтвердить точку, пришлите скриншот из игры: по его координатам она встанет на карту.', 'To confirm a point, send a screenshot from the game: the point goes on the map by its coordinates.'],
  ['За точку, которой ещё нет на карте, — 1 бонус: +1 день подписки.', 'A point that is not on the map yet earns 1 bonus: +1 day of subscription.'],
  ['Значок точки', 'Point icon'],
  ['Выходы и переходы', 'Extracts and transits'],
  ['Задания', 'Tasks'],
  ['Ключи', 'Keys'],
  ['Предметы', 'Items'],
  ['Выход ЧВК', 'PMC extract'], ['Выход дикого', 'Scav extract'], ['Совместный выход', 'Co-op extract'], ['Переход', 'Transit'], ['Рубильник', 'Switch'],
  ['Квест', 'Task'], ['Квестовый предмет', 'Quest item'], ['Ключ', 'Key'], ['Контейнер', 'Container'], ['Спавн 100 %', 'Spawn 100 %'],
  ['Драгоценности', 'Valuables'], ['Станковое оружие', 'Mounted weapons'], ['Медицина', 'Medical'], ['Провизия', 'Provisions'], ['Технический лут', 'Technical loot'], ['Документы', 'Documents'],
  ['Название квеста…', 'Task name…'],
  ['Название ключа…', 'Key name…'],
  ['Название предмета или места…', 'Item or place name…'],
  ['Название точки…', 'Point name…'],
  ['Название точки', 'Point name'],
  ['Найдено', 'Found'],
  ['Выбрать другое', 'Choose another'],
  ['Точка на карте', 'Point on the map'],
  ['Место взято со скриншота', 'Place taken from the screenshot'],
  ['Приложите скриншот из игры: «Документы» → Escape from Tarkov → Screenshots.', 'Attach a screenshot from the game: «Documents» → Escape from Tarkov → Screenshots.'],
  ['Приложите скриншот из игры.', 'Attach a screenshot from the game.'],
  ['Выбрать скриншот', 'Choose a screenshot'],
  ['В имени файла нет координат. Нужен скриншот из игры, файл не переименовывать.', 'The file name has no coordinates. A game screenshot is needed — do not rename the file.'],
  ['Координаты скриншота не с этой карты. Выберите другую карту.', 'The screenshot coordinates are not from this map. Choose another map.'],
  ['Такая точка уже есть на карте.', 'This point is already on the map.'],
  ['Такая точка уже есть на карте', 'This point is already on the map'],
  ['Выберите значок точки.', 'Choose the point icon.'],
  ['Найдите квест и выберите его из списка.', 'Find the task and choose it from the list.'],
  ['Найдите ключ и выберите его из списка.', 'Find the key and choose it from the list.'],
  ['Напишите название точки.', 'Write the point name.'],
  ['Выберите карту.', 'Choose a map.'],
  ['Отправить точку', 'Send the point'],
  ['Спасибо! Точка отправлена', 'Thank you! The point has been sent'],
  ['Мы проверим её по скриншоту и добавим на карту.', 'We will check it by the screenshot and add it to the map.'],
  // The server's answers
  ['К точке нужен скриншот из игры: по его координатам она встанет на карту', 'A point needs a game screenshot: it goes on the map by its coordinates'],
  ['В имени скриншота нет координат. Нужен скриншот из игры, файл не переименовывать', 'The screenshot name has no coordinates. A game screenshot is needed — do not rename the file'],
  ['Выберите квест, к которому относится точка', 'Choose the task the point belongs to'],
  ['Выберите ключ из списка', 'Choose the key from the list'],
  ['Точку добавляют через «Ваши предложения»', 'Points are added through «Your suggestions»'],
  // A kill zone pressed on the map (report №128)
  ['Зона устранения', 'Kill zone'], ['Квест на устранение', 'Kill task'], ['Квесты на устранение', 'Kill tasks'],
  // Locked rooms on the map (owner, 11.11.2026)
  ['Вход по ключу', 'Entry by key'], ['Мест спавна в этой комнате', 'Spawn spots in this room'],
  // The quest window's look (owner, 11.11.2026)
  ['Вид окна', 'Window look'], ['Обычный', 'Standard'], ['Вкладки по этапам', 'Tabs by stage'], ['Шкала этапов', 'Stage timeline'], ['Этапы', 'Stages'], ['Готово', 'Done'],
  // The map search (report 134)
  ['Найти точку, ключ или предмет…', 'Find a point, key or item…'], ['Есть на картах', 'On maps'],
  // Scav snipers on the map (report 131)
  ['Снайпер (дикий)', 'Scav sniper'], ['Здесь появляется дикий-снайпер.', 'A Scav sniper appears here.'],
  // The quest tree: how a trader opens (report 133)
  ['Как открыть', 'How to unlock'], ['Сначала выполнить', 'Complete first'], ['Всего на пути', 'On the way'], ['Показать весь путь', 'Show the whole way'],
  // «Ключи для квестов»: the stash as a filter (owner, 11.11.2026)
  ['Изменить ключи в схроне', 'Edit stash keys'], ['В этом разделе нет ключей из схрона.', 'No stash keys in this section.'], ['В схроне пока нет ключей. Нажмите «Найти ключи» или «Изменить ключи в схроне».', 'No keys in the stash yet. Press «Find keys» or «Edit stash keys».'],
  // The owner's table
  ['Принять точку', 'Accept the point'],
  ['Точка принята', 'Point accepted'],
  ['Точка уже принята', 'The point has already been accepted'],
  ['В отчёте нет точки', 'The report has no point'],
  ['Отчёт закрыт: верните его в работу', 'The report is closed: put it back to work'],
  ['Точки карты на этом сервере недоступны', 'Map points are not available on this server'],
  ['Точку не удалось поставить', 'The point could not be placed'],
  // The Overview's «Заменить блок» and «Экран» card (11.11.2026)
  ['Заменить блок', 'Replace block'],
  ['поменяются местами', 'they swap places'],
  ['Нет связи с ПК', 'No link to the PC'],
  ['Выключить пресет', 'Turn the preset off'],
  ['Включить пресет', 'Turn the preset on'],
  ['Переключить', 'Switch'],
  ['Включён', 'On'],
  ['Выключен', 'Off'],
  ['Удерживайте блок пальцем и перенесите на место другого — они поменяются местами. Шестерёнка — заменить блок.', 'Hold a block and drop it on another to swap them. The gear replaces a block.'],
  // «Управление» on the phone (11.11.2026)
  ['Управление', 'Control'],
  ['Обнаружение предметов', 'Find items'],
  ['Следующий пресет', 'Next preset'],
  ['Пресет', 'Preset'],
  ['Поиск ключей запущен с телефона', 'Key search started from the phone'],
  ['Поиск ключей остановлен', 'Key search stopped'],
  ['встанет сюда', 'goes here'],
  // Map: a heap of spots seen from afar (11.11.2026)
  ['приблизьте карту — покажутся все', 'zoom in to see them all'],
]
