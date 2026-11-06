/**
 * What each setting is for, in the window of its question mark (components/SettingHelp.tsx). Short and plain (owner: no long
 * texts in the interface), written from what the code does. One table, so all of them can be read and checked at once:
 * a new setting adds its line here and `<SettingHelp id="…" />` beside its name (components/SettingHelp.test.tsx).
 */
export const SETTING_HELP = {
  // «Клавиши»
  itemKey: {
    ru: 'Наведите курсор на предмет в игре и нажмите эту клавишу. На «Картах» и в телефоне появится карточка: цена и для чего он нужен.',
    en: 'Hover over an item in the game and press this key. A card appears on Maps and on your phone: its price and what it is for.',
  },
  collectorKey: {
    ru: 'Откройте схрон в игре и нажмите эту клавишу: приложение прочитает предметы на экране и отметит найденные для «Коллекционера».',
    en: 'Open your stash in the game and press this key: the app reads the items on screen and ticks the ones found for the Collector.',
  },
  presetToggle: {
    ru: 'Прямо из игры включает и выключает выбранный пресет экрана. Пресеты выбираются на странице «Настройка экрана».',
    en: 'Turns the chosen screen preset on and off right from the game. Presets are chosen on the Screen settings page.',
  },
  presetCycle: {
    ru: 'Прямо из игры включает следующий пресет экрана из списка.',
    en: 'Turns on the next screen preset in the list, right from the game.',
  },
  // «Местоположение на карте»
  playerMarker: {
    ru: 'Как выглядит ваша метка на «Картах»: стрелка, шеврон или точка.',
    en: 'What your mark looks like on Maps: an arrow, a chevron or a dot.',
  },
  screenshotsFolder: {
    ru: 'Отсюда приложение берёт скриншоты игры, чтобы показать вашу позицию. Обычно папка находится сама; выбирайте вручную, если скриншоты лежат в другом месте.',
    en: 'The app takes the game\'s screenshots from here to show your position. The folder is usually found by itself; choose it by hand if they are kept elsewhere.',
  },
  // «Интерфейс»
  raidSmoke: {
    ru: 'Украшение: зелёный дым за фигурами боссов в карточке рейда на «Обзоре». Выключите, чтобы снизить нагрузку.',
    en: 'A decoration: green smoke behind the boss figures on the Overview raid card. Turn it off to reduce the load.',
  },
  floorWheel: {
    ru: 'На карте зажмите Alt и крутите колесо мыши: вверх этаж выше, вниз этаж ниже. Выключено: этажи переключаются только кнопками.',
    en: 'On a map, hold Alt and turn the mouse wheel: up for the floor above, down for the floor below. Off: floors change by the buttons only.',
  },
  theme: {
    ru: 'Оформление всего приложения. Нажмите на схему: она сразу применится и сохранится.',
    en: 'The look of the whole app. Tap a scheme: it applies and saves at once.',
  },
  stitch: {
    ru: 'Цвет ниток на швах. Есть только в схеме «Алькантара».',
    en: 'The colour of the thread on the seams. Only in the Alcantara scheme.',
  },
  language: {
    ru: 'На каком языке приложение показывает надписи: русский или английский.',
    en: 'The language of the app\'s labels: Russian or English.',
  },
  clickVolume: {
    ru: 'Громкость звука при нажатии на кнопки. В крайнем левом положении щелчков нет.',
    en: 'How loud buttons click when pressed. At the far left there are no clicks.',
  },
  tabTips: {
    ru: 'Короткие подсказки о главном на вкладках. Нажмите «Показать снова», и каждая вкладка покажет их ещё раз, когда вы её откроете.',
    en: 'Short tips about the main things on the tabs. Press «Show again» and each tab shows them once more when you open it.',
  },
  backButton: {
    ru: 'В каком углу экрана стоит кнопка «Назад». Выберите тот, до которого удобно дотянуться.',
    en: 'Which corner of the screen the Back button stands in. Choose the one that is easy to reach.',
  },
  // «Поддержка»
  support: {
    ru: 'Сообщить об ошибке: что сломалось, можно со скриншотами. Чат: вопрос поддержке прямо в приложении. Предложения: ваша идея для приложения.',
    en: 'Report a bug: what broke, screenshots welcome. Chat: ask support right in the app. Suggestions: your idea for the app.',
  },
  // «Данные»
  appUpdate: {
    ru: 'Ваша версия приложения. Кнопка проверяет, вышла ли новая, и предлагает её поставить.',
    en: 'Your version of the app. The button checks for a new one and offers to install it.',
  },
  updateNotify: {
    ru: 'Приложение само проверяет новую версию и сообщает, когда она вышла.',
    en: 'The app checks for a new version by itself and tells you when one is out.',
  },
  autoUpdate: {
    ru: 'Новая версия скачивается сама. Небольшая применится, пока приложением не пользуются, остальные при следующем запуске. Во время рейда ничего не скачивается.',
    en: 'A new version downloads by itself. A small one applies while the app is not in use, others at the next start. Nothing downloads during a raid.',
  },
  androidUpdate: {
    ru: 'Ваша версия приложения. Кнопка проверяет, вышла ли новая. Установку подтверждаете вы.',
    en: 'Your version of the app. The button checks for a new one. You confirm the install.',
  },
  androidAutoDownload: {
    ru: 'Новая версия скачивается сама, но только по Wi-Fi. Установка начнётся, когда вы нажмёте «Установить».',
    en: 'A new version downloads by itself, on Wi-Fi only. The install starts when you press Install.',
  },
  // «Ресток торговцев»
  restockNotify: {
    ru: 'Напоминает незадолго до того, как у выбранных торговцев обновится товар.',
    en: 'Reminds you shortly before the chosen traders restock.',
  },
  restockLead: {
    ru: 'За сколько минут до рестока придёт напоминание.',
    en: 'How many minutes before a restock the reminder comes.',
  },
  restockTraders: {
    ru: 'Напоминания придут только по отмеченным торговцам.',
    en: 'Reminders come only for the traders ticked here.',
  },
  // Аккаунт (телефон и сайт)
  account: {
    ru: 'Аккаунт, в который вы вошли. Прогресс хранится на сервере отдельно для PvP, PvE и Сезона.',
    en: 'The account you are signed in to. Progress is kept on the server separately for PvP, PvE and Season.',
  },
  accountCabinet: {
    ru: 'Откроет страницу вашего аккаунта на сайте.',
    en: 'Opens your account\'s page on the website.',
  },
  accountApproveWeb: {
    ru: 'Вход на сайт без пароля: на сайте нажмите «Войти по QR-коду» и введите здесь код под QR-кодом.',
    en: 'Sign in on the website without a password: press «Sign in with a QR code» there and enter the code under the QR code here.',
  },
  accountCheck: {
    ru: 'Проверяет связь с сервером и обновляет данные аккаунта.',
    en: 'Checks the connection to the server and refreshes the account\'s data.',
  },
  accountSignOut: {
    ru: 'Выход из аккаунта на этом устройстве. Прогресс остаётся на сервере.',
    en: 'Signs out on this device. Your progress stays on the server.',
  },
  accountDelete: {
    ru: 'Аккаунт удалится через 10 дней: почта, никнеймы, прогресс, друзья и настройки. До этого срока удаление можно отменить.',
    en: 'The account goes in 10 days: e-mail, nicknames, progress, friends and settings. Until then the deletion can be cancelled.',
  },
} as const satisfies Record<string, { ru: string; en: string }>

export type SettingHelpId = keyof typeof SETTING_HELP
