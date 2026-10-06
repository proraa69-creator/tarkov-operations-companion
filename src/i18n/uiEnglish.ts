import { FEATURE_PHRASES } from './uiEnglishFeatures'
import { GOON_PHRASES } from './uiEnglishGoons'
import { MAP_PHRASES, MAP_RULES } from './uiEnglishMap'
import { SERVER_PHRASES } from './uiEnglishServer'
import { SERVER_STATUS_PHRASES } from './uiEnglishServerStatus'
import { THEME_PHRASES } from './uiEnglishThemes'
import { MOBILE_PHRASES } from './uiEnglishMobile'
import { SETTINGS_AREA_PHRASES } from './uiEnglishSettingsArea'
import { ACCOUNT_PHRASES } from './uiEnglishAccount'
import { OWNER_SITE_PHRASES } from './uiEnglishOwnerSite'
import { OWNER_ADMIN_PHRASES } from './uiEnglishOwnerAdmin'
import { PAYMENT_PHRASES } from './uiEnglishPayments'
import { PHONE_PHRASES } from './uiEnglishPhone'
import { EMAIL_PHRASES } from './uiEnglishEmail'
import { ACCOUNT_GATE_PHRASES } from './uiEnglishAccountGate'
import { QUEST_PHRASES } from './uiEnglishQuests'
import { MINIMAP_PAGE_PHRASES } from './uiEnglishMinimap'
import { BOSS_INFO_PHRASES } from './uiEnglishBossInfo'
import { GAME_DATA_PHRASES } from './uiEnglishGameData'
import { BOSS_SUPPLEMENT_PHRASES } from './uiEnglishBossSupplement'
import { PAYWALL_PHRASES } from './uiEnglishPaywall'
import { ECONOMY_PHRASES } from './uiEnglishEconomy'
import { ARSENAL_PHRASES } from './uiEnglishArsenal'
import { GUN_BUILDER_PHRASES } from './uiEnglishGunBuilder'
import { RAID_PREP_PHRASES } from './uiEnglishRaidPrep'
import { SQUAD_PHRASES } from './uiEnglishSquad'
import { SERVER_UPDATE_PHRASES } from './uiEnglishServerUpdate'
import { SUPPORT_PHRASES } from './uiEnglishSupport'

const PHRASES: Array<[string, string]> = [
  ['Следующий рейд начинается здесь', 'Your next raid starts here'],
  ['Оперативный штаб', 'Operations center'], ['Открыть карту', 'Open map'],
  ['Текущие задания', 'Current tasks'], ['Доступные задания', 'Available tasks'], ['Выполненные', 'Completed'],
  ['Недоступные', 'Locked'], ['Все задания', 'All tasks'], ['Мои задания', 'Current tasks'],
  ['Прогресс', 'Progress'], ['Капа', 'Kappa'], ['Кочевники', 'Goons'], ['Нет данных', 'No data'],
  ['обновление каждую минуту', 'updates every minute'], ['ПЛАН РЕЙДА', 'RAID PLAN'],
  ['Построить маршрут', 'Build route'], ['Задания', 'Tasks'], ['Выбрать карту', 'Choose map'],
  ['Приоритет карт', 'Map priority'], ['Все карты', 'All maps'], ['Любая карта', 'Any map'],
  ['Требования рейда', 'Raid requirements'], ['Рынок · избранное', 'Market · favorites'], ['Подробнее', 'Details'],
  ['лучшее предложение', 'best offer'], ['Добавлено с барахолки', 'Added from flea market'],
  ['Взять и заложить', 'Take and plant'], ['Взять для маркировки', 'Take for marking'], ['Взять ключ', 'Take key'],
  ['Взять с собой', 'Bring along'], ['Передать торговцу', 'Hand over to trader'], ['Найти в рейде', 'Find in raid'],
  ['Профиль оператора', 'Operator profile'], ['Локальная учётная запись', 'Local account'],
  ['Данные персонажа обновляются из Tarkov.dev каждую минуту.', 'Character data is refreshed from Tarkov.dev every minute.'],
  ['только чтение', 'read only'], ['Персонаж', 'Character'], ['Режим', 'Mode'], ['Сезон', 'Season'],
  ['Ник не привязан', 'Nickname not linked'], ['Привяжите ник для выбранного режима', 'Link a nickname for this mode'],
  ['Привязан', 'Linked'], ['Не настроен', 'Not configured'], ['Смена ника (вайп)', 'Change nickname (reset)'],
  ['Привязать ник', 'Link nickname'], ['Текущий профиль', 'Current profile'],
  ['Профиль Tarkov.dev ещё не обновлён', 'Tarkov.dev profile has not been refreshed yet'],
  ['Уровень', 'Level'], ['ч. в игре', 'hours played'], ['Настройки', 'Settings'], ['Обзор', 'Overview'],
  ['Карты', 'Maps'], ['Барахолка', 'Flea market'], ['Торговцы', 'Traders'], ['Профиль', 'Profile'],
  ['Убежище', 'Hideout'], ['Предметы', 'Items'], ['Ключи', 'Keys'], ['Боеприпасы', 'Ammo'],
  ['Поиск', 'Search'], ['Фильтр', 'Filter'], ['Сбросить', 'Reset'], ['Закрыть', 'Close'], ['Назад', 'Back'],
  ['Сохранить', 'Save'], ['Удалить', 'Delete'], ['Отмена', 'Cancel'], ['Подтвердить', 'Confirm'], ['Обновить', 'Refresh'],
  ['Источник данных', 'Data source'], ['Последнее обновление', 'Last updated'], ['Автообновление', 'Auto refresh'],
  ['Тёмная', 'Dark'], ['Светлая', 'Light'], ['Язык', 'Language'], ['Интерфейс', 'Interface'],
  ['Квестовые предметы', 'Quest items'], ['Выходы PMC', 'PMC extracts'], ['Выходы Диких', 'Scav extracts'],
  ['Боссы', 'Bosses'], ['Лут', 'Loot'], ['Точки интереса', 'Points of interest'], ['Скрыть все', 'Hide all'], ['Показать все', 'Show all'],
  ['Название', 'Name'], ['Торговец', 'Trader'], ['Локация', 'Location'], ['Описание', 'Description'],
  ['Цели', 'Objectives'], ['Награды', 'Rewards'], ['Требования', 'Requirements'], ['Уровень лояльности', 'Loyalty level'],
  ['Заблокировано', 'Locked'], ['Доступно', 'Available'], ['Активно', 'Active'], ['Завершено', 'Completed'],
  ['Нет результатов', 'No results'], ['Не найдено', 'Not found'], ['Любая локация', 'Any location'],
  ['Загружаем актуальную базу', 'Loading current database'],
  ['Демо-режим', 'Demo mode'], ['Идёт обновление данных', 'Refreshing data'], ['Ожидание обновления', 'Waiting for refresh'],
  ['Tarkov.dev онлайн', 'Tarkov.dev online'], ['Локальный кэш', 'Local cache'], ['Последнее обновление:', 'Last updated:'],
  ['Задания, предметы, карты и модули убежища…', 'Tasks, items, maps, and hideout modules…'],
  ['Основная навигация', 'Main navigation'], ['Игровой режим', 'Game mode'], ['Язык интерфейса', 'Interface language'],
  ['Обновить данные', 'Refresh data'], ['Глобальный поиск', 'Global search'],
  ['Например: Водолей, ключ 206, Таможня…', 'For example: Aquarius, room 206 key, Customs…'],
  ['Введите минимум два символа', 'Enter at least two characters'],
  ['Ничего не найдено. Попробуйте другое название.', 'Nothing found. Try another name.'],
  ['Текущие', 'Current'], ['Сюжетные', 'Story'], ['Все', 'All'], ['Все торговцы', 'All traders'],
  ['Выполненные задания', 'Completed tasks'], ['Сюжетные квесты', 'Story quests'], ['Задания капы', 'Kappa tasks'],
  ['Прогресс операции', 'Operation progress'], ['Поиск задания…', 'Search tasks…'], ['Найдено:', 'Found:'],
  ['Главы истории', 'Story chapters'], ['Каталог заданий', 'Task catalog'], ['Актуальный этап', 'Current stage'],
  ['Глава истории', 'Story chapter'], ['Текущая глава', 'Current chapter'], ['Текущее', 'Current'], ['Каталог', 'Catalog'],
  ['У торговца', 'At trader'], ['Показать на карте', 'Show on map'], ['Нет выбранного задания', 'No task selected'],
  ['Задача', 'Task'], ['Этапы главы', 'Chapter stages'], ['Сейчас выполняется', 'In progress'],
  ['Подробные цели временно недоступны.', 'Detailed objectives are temporarily unavailable.'],
  ['Требуемые предметы', 'Required items'], ['Награды на Wiki не указаны.', 'Rewards are not listed on the Wiki.'],
  ['Страница на Wiki', 'Wiki page'], ['Сюжетные главы не найдены.', 'No story chapters found.'],
  ['Нет заданий с такими фильтрами.', 'No tasks match these filters.'], ['Провалено', 'Failed'],
  ['Выберите портрет торговца, подробные данные появятся в следующих версиях.', 'Choose a trader portrait. Detailed data will appear in a future version.'],
  ['Контакты', 'Contacts'], ['Система', 'System'], ['Локальные предпочтения и управление данными аккаунта.', 'Local preferences and account data management.'],
  ['Компактные таблицы', 'Compact tables'], ['Больше строк на экране', 'More rows on screen'], ['Первая версия', 'Initial version'],
  ['Данные', 'Data'], ['Обновить сейчас', 'Refresh now'], ['Запрос выполняется…', 'Request in progress…'],
  ['Локальный прогресс', 'Local progress'], ['Сбросить аккаунт', 'Reset account'],
  ['Привязка профиля', 'Profile linking'], ['Привяжите игровой профиль', 'Link your game profile'],
  ['Ник Escape from Tarkov', 'Escape from Tarkov nickname'], ['Например: shaurma', 'For example: shaurma'],
  ['Найти профиль', 'Find profile'], ['Подтвердить', 'Confirm'],
  ['Распознаю предмет…', 'Recognizing item…'], ['Предмет не распознан', 'Item not recognized'],
  ['Нужен для квестов', 'Needed for tasks'], ['Для квестов не нужен', 'Not needed for tasks'],
  ['Нужен для Каппы', 'Needed for Kappa'], ['Загрузка карты…', 'Loading map…'], ['Мини-карта', 'Minimap'],
  ['Нет данных карты.', 'No map data.'], ['нет цены', 'no price'], ['нет квестов', 'no tasks'],
  ['Загрузка интерактивной карты Wiki…', 'Loading interactive Wiki map…'],
]

const EXTRA: Array<[string, string]> = [
  ['только что', 'just now'], ['назад', 'ago'], ['опыта', 'XP'], ['репутация', 'reputation'], ['Задание от торговца', 'Task from'],
  ['Таможня', 'Customs'], ['Завод', 'Factory'], ['Лес', 'Woods'], ['Берег', 'Shoreline'], ['Развязка', 'Interchange'], ['Резерв', 'Reserve'], ['Маяк', 'Lighthouse'], ['Улицы Таркова', 'Streets of Tarkov'], ['Лаборатория', 'The Lab'], ['Лабиринт', 'The Labyrinth'], ['Эпицентр', 'Ground Zero'], ['Терминал', 'Terminal'], ['Ледокол', 'Icebreaker'],
  ['Тоннели', 'Tunnels'], ['Гараж', 'Garage'], ['Лазарет', 'Infirmary'], ['Вертолётная площадка', 'Helipad'], ['Спортзал / столовая', 'Gym / canteen'], ['Каюты (нижние)', 'Lower accommodation'], ['Каюты (средние)', 'Middle accommodation'], ['Каюты (верхние)', 'Upper accommodation'], ['Офицерская палуба', "Officers’ deck"], ['Лестница (закрыта)', 'Stairs (blocked)'], ['Мостик', 'Bridge'], ['Крыша мостика', 'Bridge roof'], ['Пост управления', 'Control room'], ['Машинное отделение', 'Engine room'], ['Машинное отделение (верх)', 'Upper engine room'], ['Топливные насосы (низ)', 'Lower fuel pumps'], ['Топливные насосы', 'Fuel pumps'], ['Склад / охрана', 'Storage / security'],
  ['Эксперименты', 'Experimental'], ['Задание', 'Task'], ['Карта', 'Map'], ['ОПЕРАЦИИ', 'OPERATIONS'], ['СИСТЕМА', 'SYSTEM'],
  ['Поиск по заданиям, предметам и картам', 'Search tasks, items, and maps'], ['Выполнено', 'Completed'], ['из', 'of'],
  ['Видел', 'Spotted'], ['Ваша отметка', 'Your sighting'], ['Сообщение сообщества', 'Community report'],
  ['мин', 'min'], ['игроков', 'players'], ['задание', 'task'], ['задания', 'tasks'], ['заданий', 'tasks'], ['на', 'on'], ['ур.', 'lvl.'], ['капа', 'Kappa'],
  ['На карте «', 'On “'], ['» нет заданий текущего этапа. Они появятся, когда вы примете в игре задание с этой локации.', '” there are no current-stage tasks. They will appear when you accept a task for this location in the game.'],
  ['Для текущих заданий на этой карте нет предметов, которые нужно взять с собой или заложить.', 'Your current tasks on this map do not require any items to bring or plant.'],
  ['Только то, что нужно взять в рейд: заложить, пометить или открыть дверь. Предметы «найти и вынести» сюда не входят.', 'Only items to bring into the raid: planting items, markers, and keys. Items to find and extract are not included.'],
  ['Экспериментальная сборка', 'Experimental build'],
  ['Функции поверх игры. Они только читают экран и файлы скриншотов — в игру ничего не внедряется.', 'In-game overlays. These features only read the screen and screenshot files; nothing is injected into the game.'],
  ['Эти функции работают только в приложении для Windows.', 'These features are available only in the Windows application.'],
  ['Окна поверх игры видны только в режиме экрана', 'For reliable overlays, use'], ['«Оконный без рамки»', '“Borderless fullscreen”'],
  ['(Borderless). В полноэкранном режиме Windows не даёт рисовать поверх игры.', '(Borderless). Overlays cannot be guaranteed in exclusive fullscreen.'],
  ['Функции', 'Features'], ['Информация о предмете — клавиша «Ж»', 'Item price — semicolon (;) key'],
  ['Наведите курсор на предмет, дождитесь подсказки с названием и нажмите «Ж»: только цена на барахолке.', 'Hover over an item, wait for its name tooltip, and press semicolon (;): flea market price only.'],
  ['Мини-карта — клавиша «M»', 'Minimap — M key'],
  ['Показывает карту текущего рейда с выходами и точками текущих квестов. Повторное нажатие скрывает.', 'Shows the current raid map with extracts and current task markers. Press again to hide.'],
  ['Позиция по скриншотам', 'Screenshot position tracking'],
  ['Скриншот EFT хранит координаты в имени файла. Нажимайте в рейде клавишу скриншота игры (по умолчанию PrtSc) или включите автоматические скриншоты. Снимки не удаляются.', 'EFT stores coordinates in screenshot filenames. Press the game’s screenshot key in a raid (PrtSc by default) or enable automatic screenshots. Your screenshots are never deleted.'],
  ['Автоматические скриншоты', 'Automatic screenshots'],
  ['В рейде, пока игра на переднем плане, приложение само нажимает клавишу скриншота игры. Это эмуляция клавиши — используйте на свой риск.', 'During a raid, while the game is in the foreground, the app presses the game’s screenshot key automatically. This simulates a key press; use at your own risk.'],
  ['Интервал', 'Interval'], ['с между снимками', 's between screenshots'], ['Состояние', 'Status'], ['Горячие клавиши', 'Hotkeys'], ['работают', 'ready'], ['ошибка:', 'error:'], ['Рейд', 'Raid'], ['в рейде', 'in raid'], ['в меню', 'in menu'], ['Отслеживание', 'Tracking'], ['включено', 'enabled'], ['выключено', 'disabled'], ['Последняя позиция', 'Last position'], ['с назад', 's ago'], ['ещё нет', 'not yet'], ['Папка скриншотов:', 'Screenshots folder:'], ['Проверить карточку предмета', 'Test item price overlay'], ['Показать / скрыть мини-карту', 'Show / hide minimap'],
  ['Все калибры', 'All calibers'], ['Боеприпас', 'Ammo'], ['Ключ', 'Key'], ['Рынок', 'Market'],
  ['Предметы, ключи и боеприпасы в одном разделе. Карточка предмета открывается здесь же.', 'Items, keys, and ammunition in one place. Select an item to view its details here.'],
  ['демо-данные', 'demo data'], ['обновлено', 'updated'], ['Tarkov.dev временно недоступен — цены показаны только для демонстрации.', 'Tarkov.dev is temporarily unavailable; prices are for demonstration only.'],
  ['Все предметы', 'All items'], ['Избранное', 'Favorites'], ['позиций', 'items'], ['Найти предмет…', 'Find item…'], ['Предмет', 'Item'], ['Категория', 'Category'], ['Урон', 'Damage'], ['Пробитие', 'Penetration'], ['Источник', 'Source'], ['Цена', 'Price'], ['Предметы не найдены.', 'No items found.'], ['Закрыть карточку', 'Close item details'], ['кг', 'kg'], ['Цены', 'Prices'], ['лучшее', 'best'], ['Нет данных для выбранного режима.', 'No data for the selected mode.'], ['В избранном', 'Favorited'], ['Добавить в избранное', 'Add to favorites'], ['В списке рейда', 'On raid list'], ['В список рейда', 'Add to raid list'],
  ['Папка Logs не найдена автоматически. Укажите её вручную.', 'The Logs folder was not found automatically. Please select it manually.'], ['Не удалось прочитать журналы', 'Unable to read logs'], ['Не удалось разобрать файлы', 'Unable to parse files'], ['Синхронизация по журналам', 'Log synchronization'],
  ['Задания читаются из журналов Escape from Tarkov. PvP, PvE и Сезон раскладываются отдельно — по режиму сессии, серверу и профилю.', 'Tasks are read from Escape from Tarkov logs. PvP, PvE, and Season are kept separate by session mode, server, and profile.'], ['только чтение, локально', 'read-only, local'], ['Папка Logs ещё не найдена', 'Logs folder not found yet'], ['Файлы журналов', 'Log files'], ['Выбрать папку Logs', 'Choose Logs folder'], ['Выбрать файлы журналов', 'Choose log files'], ['Прочитано игровых сессий:', 'Game sessions read:'], ['Программа следит за журналами и обновляет задания сама, пока вы играете.', 'The app monitors logs and updates tasks automatically as you play.'], ['Текущих:', 'Current:'], ['выполнено:', 'completed:'], ['провалено:', 'failed:'], ['играли', 'last played'], ['Сброс профиля', 'Profile reset'], ['— учитываются события после него', '— only later events are included'], ['В журналах нет этого режима', 'This mode is missing from the logs'], ['Читаю журналы…', 'Reading logs…'], ['Задания из журналов', 'Tasks from logs'],
  ['«Принято» — задание текущее. «Выполнено» — сдано торговцу. Сюжетные главы игра в журналы не пишет: они подхватываются, когда в игре открыта вкладка сюжета.', 'Accepted tasks are current. Completed tasks have been handed in. Story chapters are not logged by the game; they are read when you open the story tab in-game.'],
  ['Неизвестное задание', 'Unknown task'], ['выполнено', 'completed'], ['провалено', 'failed'], ['принято', 'accepted'], ['В журналах режима', 'In the logs for'], ['нет событий заданий.', 'there are no task events.'], ['Все категории', 'All categories'], ['База снабжения', 'Supply database'], ['Характеристики, назначение, лучшие цены и связи с заданиями.', 'Specifications, uses, best prices, and related tasks.'], ['записей', 'entries'], ['Название или сокращение…', 'Name or abbreviation…'], ['Показано:', 'Showing:'], ['Класс', 'Class'],
  ['Выходы ЧВК', 'PMC extracts'], ['Совместные выходы', 'Co-op extracts'], ['Переходы', 'Transits'], ['Квесты', 'Tasks'], ['Спавны', 'Spawns'], ['Опасности', 'Hazards'], ['Ценный лут', 'Valuable loot'], ['Оружие/боеприпасы', 'Weapons / ammunition'], ['Медицина', 'Medical supplies'], ['Провизия', 'Provisions'], ['Технический лут', 'Technical loot'], ['Контейнеры/тайники', 'Containers / caches'], ['Ориентиры', 'Landmarks'], ['Выход ЧВК', 'PMC extract'], ['Выход Диких', 'Scav extract'], ['Совместный выход', 'Co-op extract'], ['Переход', 'Transit'], ['Квест', 'Task'], ['Квестовый предмет', 'Quest item'], ['Босс', 'Boss'], ['Спавн', 'Spawn'], ['Опасность', 'Hazard'], ['Контейнер', 'Container'], ['Ориентир', 'Landmark'], ['Выходы и переходы', 'Extracts and transits'], ['Дополнительно', 'Additional layers'], ['Тактические', 'Tactical'], ['Минимал', 'Minimal'], ['Классика', 'Classic'], ['ИКОНКИ', 'ICONS'], ['ЛОКАЦИИ', 'LOCATIONS'], ['ТОЧКИ НА КАРТЕ', 'MAP MARKERS'], ['Включены только выходы и текущие квесты. Остальное можно открыть здесь.', 'Only extracts and current tasks are enabled. Enable other layers here.'], ['МАРКЕРОВ', 'MARKERS'], ['Основной', 'Main'], ['Текущий этап', 'Current stage'], ['Точное место этапа неизвестно — метка стоит приблизительно.', 'The exact stage location is unknown; this marker is approximate.'], ['Открыть задание', 'Open task'], ['Примерное место', 'Approximate location'], ['Квесты на карте', 'Tasks on map'], ['Найти точку…', 'Find marker…'], ['Актуальные квесты', 'Current tasks'], ['Нет текущих квестов', 'No current tasks'], ['На этой карте сейчас нет активных заданий.', 'There are no current tasks on this map.'], ['Закрыто', 'Locked'], ['Неизвестно', 'Unknown'], ['Сменить ник для', 'Change nickname for'], ['? Прогресс и привязка текущего режима будут сброшены. Остальные режимы не изменятся.', '? Progress and linking for this mode will be reset. Other modes will not change.'], ['автообновление 1 мин.', 'auto refresh every minute'],
  ['Глава и этап подхватываются сами, когда в игре открыта вкладка сюжета. Поправить можно в карточке главы.', 'The chapter and stage are read automatically while the story tab is open in-game.'], ['Принятые в игре задания этого режима по журналам EFT.', 'Tasks accepted in this game mode, as recorded in EFT logs.'], ['Капа: выполнено', 'Kappa: completed'], ['Глава', 'Chapter'], ['этапов', 'stages'], ['Показать', 'Show'], ['на карте', 'on map'], ['глава', 'chapter'], ['уровень', 'level'], ['. «Показать на карте» ведёт к карте этого этапа.', '. “Show on map” opens the map for this stage.'], ['В журналах этого режима нет принятых заданий. Примите задание у торговца в игре — оно появится здесь само.', 'No accepted tasks were found in the logs for this mode. Accept a task from a trader in-game; it will appear here automatically.'],
  ['Рыночная разведка', 'Market intelligence'], ['Экономика', 'Economy'], ['Сравнение источников продажи. Все цены показывают режим и время последнего обновления.', 'Compare sale sources. All prices show the game mode and last update time.'], ['демо-цены', 'demo prices'], ['Tarkov.dev временно недоступен. Показаны встроенные демонстрационные значения — не используйте их для точного расчёта сделки.', 'Tarkov.dev is temporarily unavailable. Built-in demo values are shown; do not use them for actual trade calculations.'], ['Рейтинг ценности', 'Value ranking'], ['Лучший источник', 'Best source'], ['Разница', 'Difference'], ['Доступ и маршруты', 'Access and routes'], ['Где применяется ключ, какое задание открывает и сколько он стоит.', 'Where to use each key, its related tasks, and its price.'], ['ключей', 'keys'], ['Номер комнаты или название…', 'Room number or name…'], ['Разные локации', 'Multiple locations'], ['Баллистика', 'Ballistics'], ['Сравнение урона, пробития и цены для быстрой подготовки боекомплекта.', 'Compare damage, penetration, and prices to prepare your ammunition.'], ['сортировка по пробитию', 'sorted by penetration'], ['Патрон', 'Round'], ['Калибр', 'Caliber'], ['Против брони', 'Against armor'], ['до класса', 'up to class'], ['Инфраструктура', 'Infrastructure'], ['Схематический вид сверху: модули, уровни и требования к постройке. Уровни пока указываются вручную — в журналах EFT нет надёжного снимка убежища.', 'Top-down schematic: modules, levels, and construction requirements. Levels are set manually for now; EFT logs do not provide a reliable hideout snapshot.'], ['модулей', 'modules'], ['Схема убежища', 'Hideout layout'], ['ВХОД ↓', 'ENTRANCE ↓'], ['Модуль', 'Module'], ['Указано игроком', 'Set by player'], ['Для уровня', 'For level'], ['Максимальный уровень', 'Maximum level'], ['Модули', 'Modules'], ['Предметы и условия', 'Items and requirements'], ['Предметные требования не указаны в источнике.', 'Item requirements are not provided by the source.'], ['Дальнейших улучшений нет.', 'No further upgrades.'], ['Время постройки: ~', 'Build time: ~'], ['ч', 'h'], ['Все уровни', 'All levels'], ['Ур.', 'Lvl.'], ['предметов', 'items'], ['карт', 'maps'], ['Последнее:', 'Last update:'], ['Сбросить этот аккаунт и создать заново: задания, избранное и привязки режимов', 'Reset this account and start again: tasks, favorites, and linked modes'], ['Сбросить аккаунт и создать локальный прогресс заново?', 'Reset this account and start local progress again?'], ['Карта «', 'Map “'], ['» не найдена', '” not found'], ['Карта определится, когда начнётся рейд', 'The map will be detected when a raid starts'], ['Точка приблизительная', 'Approximate marker'], ['шанс', 'chance'], ['зона', 'zone'], ['Состав:', 'Members:'], ['Примерное место на карте', 'Approximate map location'], ['сезонного режима', 'Season mode'], ['Введите ник Escape from Tarkov (минимум 3 символа)', 'Enter an Escape from Tarkov nickname (at least 3 characters)'], ['Профиль не найден', 'Profile not found'], ['Регистрация', 'Registration'], ['Введите ник именно из режима', 'Enter your nickname for'], ['. Программа ищет профиль в индексе Tarkov.dev для этого режима и сверяет с журналами, если они есть.', '. The app searches the Tarkov.dev index for this mode and checks available game logs.'], ['Ник закрепляется отдельно за этим режимом. Изменить его можно позже в профиле.', 'The nickname is linked to this mode only. You can change it later in your profile.'], ['Наведите курсор на предмет, дождитесь подсказки с названием и нажмите «Ж» ещё раз.', 'Hover over an item, wait for its name tooltip, and press semicolon (;) again.'], ['квестов:', 'tasks:'], ['позиция: нет', 'position: unknown'],
  ['2 уровень', 'Second level'], ['Технический уровень', 'Technical level'], ['Подземный', 'Underground'], ['Бункеры', 'Bunkers'], ['Туннели', 'Tunnels'], ['Парковка', 'Parking'], ['Бартер', 'Barter'], ['Базовая цена', 'Base price'], ['Броня', 'Armor'], ['Оружие', 'Weapons'], ['Снаряжение', 'Equipment'], ['Провизия', 'Provisions'], ['Модификации', 'Modifications'], ['Прочее', 'Other'], ['Тур', 'Tour'],
]
const ORDERED = [...EXTRA, ...PHRASES, ...FEATURE_PHRASES, ...GOON_PHRASES, ...MAP_PHRASES, ...SERVER_PHRASES, ...SERVER_STATUS_PHRASES, ...THEME_PHRASES, ...MOBILE_PHRASES, ...SETTINGS_AREA_PHRASES, ...ACCOUNT_PHRASES, ...OWNER_SITE_PHRASES, ...OWNER_ADMIN_PHRASES, ...PAYMENT_PHRASES, ...PHONE_PHRASES, ...EMAIL_PHRASES, ...MINIMAP_PAGE_PHRASES, ...QUEST_PHRASES, ...BOSS_INFO_PHRASES, ...GAME_DATA_PHRASES, ...BOSS_SUPPLEMENT_PHRASES, ...ECONOMY_PHRASES, ...ARSENAL_PHRASES, ...GUN_BUILDER_PHRASES, ...RAID_PREP_PHRASES, ...SQUAD_PHRASES, ...ACCOUNT_GATE_PHRASES, ...PAYWALL_PHRASES, ...SERVER_UPDATE_PHRASES, ...SUPPORT_PHRASES].sort((a, b) => b[0].length - a[0].length)
const EXACT = new Map(ORDERED)
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** English for a whole interface phrase, when the dictionary has it exactly. */
export function exactUiText(value: string) {
  return EXACT.get(value.trim())
}

export function translateUiText(value: string) {
  if (!/[А-Яа-яЁё]/.test(value)) return value
  const exact = EXACT.get(value.trim())
  if (exact) return value.replace(value.trim(), exact)
  let output = value
  // Templates first, while their Russian words are still intact.
  for (const [pattern, replacement] of MAP_RULES) output = output.replace(pattern, replacement)
  // Never replace part of a word (the old DOM translator turned Russian words into hybrids).
  for (const [source, target] of ORDERED) output = output.replace(new RegExp(`(?<![А-Яа-яЁё])${escapeRegex(source)}(?![А-Яа-яЁё])`, 'gu'), () => target)
  output = output
    .replace(/(\d+)\s+задани(?:е|я|й)/gi, '$1 tasks')
    .replace(/(\d+)\s+на\s+/gi, '$1 on ')
    .replace(/выполнено из/gi, 'completed of')
    .replace(/Выполнено\s+(\d+)\s+из/gi, 'Completed $1 of')
    .replace(/ур\.\s*(\d+)/gi, 'lvl. $1')
    .replace(/(\d+)\s+мин(?:ут[аы]?)?/gi, '$1 min')
    .replace(/(\d+)\s+игрок(?:а|ов)?/gi, '$1 players')
    .replace(/автообновление\s+1\s+мин\./gi, 'auto refresh every minute')
    .replace(/квестов:\s*(\d+)/gi, 'tasks: $1')
    .replace(/и ещё\s+(\d+)/gi, 'and $1 more')
    .replace(/(\d+)\s+этапов?/gi, '$1 stages')
    .replace(/глава\s+(\d+)/gi, 'chapter $1')
    .replace(/(\d+)\s*этаж/gi, 'Floor $1')
  return output
}
