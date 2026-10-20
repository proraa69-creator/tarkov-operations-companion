/** English for «Админ панель» of the owner app (src/pages/AdminPanelPage.tsx, src/admin/*). */
export const ADMIN_PANEL_PHRASES: Array<[string, string]> = [
  // The page and its sections
  ['Админ панель', 'Admin panel'], ['Только для владельца', 'Owner only'], ['Разделы админ панели', 'Admin panel sections'],
  ['Всё, что вы меняете здесь, сохраняется на сервере и само появляется у всех игроков — без обновления приложения и сервера.', 'Everything you change here is saved on the server and reaches every player by itself — no app or server update needed.'],
  ['аккаунт владельца', 'owner account'], ['вход не выполнен', 'not signed in'], ['проверка доступа…', 'checking access…'],
  ['Админ панель доступна только в приложении владельца, вошедшем в аккаунт владельца.', 'The admin panel is available only in the owner app signed in to the owner account.'],
  ['Войдите в аккаунт владельца на странице «Профиль» — без него сервер не примет изменения.', 'Sign in to the owner account on the “Profile” page — without it the server will not accept changes.'],
  ['Открыть профиль', 'Open profile'],
  ['Объявления', 'Announcements'], ['Всем или по регионам', 'To everybody or by region'],
  ['Создать, результаты', 'Create, results'],
  ['Баннер', 'Banner'], ['Сверху у всех игроков', 'At the top for every player'],
  ['Включить или выключить у всех', 'Turn on or off for everybody'],
  ['Ивент-квесты и конструктор', 'Event quests and the constructor'],
  ['Блоки', 'Blocks'], ['«Обзор» для всех', '“Overview” for everybody'],
  ['Всем игрокам или по регионам (Россия, СНГ, Мир), с платной подпиской или без. Окно появится при входе или в течение минуты, если приложение открыто; во время рейда ждёт его конца. Текст переводится на английский автоматически.', 'To every player or by region (Russia, CIS, World), with a paid subscription or without. The window appears at sign-in or within a minute if the app is open; during a raid it waits for the raid to end. The text is translated into English automatically.'],
  ['Опрос для всех или по регионам. Результаты — здесь, подробная таблица с почтами — на сайте.', 'A survey for everybody or by region. Results are here; the detailed table with e-mails is on the website.'],
  ['Баннер для всех, объявления и опросы', 'Banner for everybody, announcements and surveys'], ['перенесено в Админ панель', 'moved to the Admin panel'],
  // «Опросы» → «Результаты»
  ['Результаты', 'Results'], ['Результаты опроса', 'Survey results'], ['Ответов', 'Answers'], ['Ответов пока нет.', 'No answers yet.'],
  // «Функции»
  ['Для всех игроков сразу', 'For every player at once'],
  ['Позиция игрока по скриншотам игры на «Картах» и в телефоне. Выключено — ни у кого нет позиции, приложение не следит за папкой скриншотов.', 'The player’s position from the game’s screenshots on “Maps” and on the phone. Off — nobody has a position and the app does not watch the screenshots folder.'],
  ['Включено у всех', 'On for everybody'], ['Выключено у всех', 'Off for everybody'], ['Последнее изменение', 'Last change'],
  ['Приложения игроков узнают о переключении в течение нескольких минут или сразу, когда окно снова в фокусе.', 'Players’ apps learn about the switch within a few minutes, or at once when their window gets the focus back.'],
  // «Квесты»
  ['Точки, тексты и требования квестов', 'Quest points, texts and requirements'],
  ['Изменения в конструкторе сохраняются сразу и видны всем игрокам — обновлять приложение или сервер не нужно.', 'Constructor changes are saved at once and every player sees them — no app or server update needed.'],
  ['Открыть конструктор на карте', 'Open the constructor on the map'], ['Найденные квесты', 'Quests found'],
  ['Квесты с вашими правками', 'Quests with your corrections'], ['Правок пока нет.', 'No corrections yet.'],
  ['точек', 'points'], ['текстов', 'texts'], ['требований', 'requirements'],
  ['Появляются у всех игроков сразу', 'Every player gets them at once'], ['Открыть ивент-квесты', 'Open event quests'],
  // «Блоки»
  ['«Обзор» для всех игроков', '“Overview” for every player'],
  ['Какие блоки видны, их порядок и названия. Игрок, который сам настроил блоки, сохраняет свой порядок; скрытые блоки скрыты у всех.', 'Which blocks show, their order and titles. A player who arranged the blocks keeps their own order; hidden blocks are hidden for everybody.'],
  ['Видимость и названия', 'Visibility and titles'], ['Блок', 'Block'], ['Показывать', 'Show'], ['показывать', 'show'],
  ['Название (RU)', 'Title (RU)'], ['название (RU)', 'title (RU)'], ['название (EN)', 'title (EN)'],
  ['виден', 'shown'], ['скрыт', 'hidden'],
  ['Пустое название — стандартное. Английское видят игроки с английским интерфейсом.', 'An empty title keeps the standard one. Players with the English interface see the English title.'],
  ['Порядок по умолчанию', 'Default order'], ['ПК', 'PC'],
  ['Карточки сверху', 'Cards at the top'], ['Строки страницы', 'Page rows'], ['Левая (широкая) колонка', 'Left (wide) column'], ['Правая колонка', 'Right column'], ['Две колонки', 'Two columns'],
  ['выше', 'up'], ['ниже', 'down'],
  ['Сохранить для всех', 'Save for everybody'], ['Отменить правки', 'Discard changes'], ['Стандартный «Обзор» для всех', 'Standard “Overview” for everybody'],
  ['Сохранено. Игроки увидят новый «Обзор» в течение нескольких минут.', 'Saved. Players will see the new “Overview” within a few minutes.'],
  ['Всем возвращён стандартный «Обзор».', 'Everybody has the standard “Overview” again.'],
  ['Вернуть всем стандартный «Обзор»? Ваши названия, порядок блоков и боссы на картах удалятся.', 'Give everybody the standard “Overview” again? Your titles, block order and map bosses will be deleted.'],
  // «Боссы в блоке «План рейда»» (src/admin/AdminMapBosses.tsx)
  ['Боссы в блоке «План рейда»', 'Bosses in the “Raid plan” block'],
  ['Какие боссы стоят на карте рейда в «Обзоре», в каких режимах и в каком порядке: сверху вниз — слева направо в карточке.', 'Which bosses stand on the raid map in the “Overview”, in which modes and in which order: top to bottom is left to right on the card.'],
  ['изменено', 'changed'],
  ['Стандартные боссы этой карты', 'Standard bosses of this map'],
  ['убрать с карты', 'remove from the map'], ['Убрать с карты', 'Remove from the map'],
  ['На этой карте боссов не будет.', 'No bosses on this map.'],
  ['Какого босса добавить', 'Boss to add'],
  ['Выберите босса', 'Choose a boss'],
  ['Все боссы уже на карте', 'Every boss is on the map already'],
  ['Добавить на карту', 'Add to the map'],

]

/** Server answers with a variable part. */
export const ADMIN_PANEL_RULES: Array<[RegExp, string]> = [
  [/^Некорректные настройки блоков \(([^)]*)\): проверьте блоки(?:, боссов)? и длину названий \(до (\d+) символов\)$/g, 'Invalid block settings ($1): check the blocks, the bosses and the title length (up to $2 characters)'],
  [/^Некорректные настройки блоков: проверьте блоки(?:, боссов)? и длину названий \(до (\d+) символов\)$/g, 'Invalid block settings: check the blocks, the bosses and the title length (up to $1 characters)'],
]
