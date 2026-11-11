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
  // «Управление» on the phone's Overview (owner, 11.11.2026): the PC's scans started from the phone
  controlScan: {
    ru: 'Находит в схроне предметы для «Коллекционера» (Каппа), для убежища и для квестов и отмечает их. Откройте схрон в игре на ПК и листайте его.',
    en: 'Finds items in your stash for the Collector (Kappa), the hideout and quests and ticks them. Open your stash in the game on the PC and scroll it.',
  },
  controlKeys: {
    ru: 'Находит ключи и добавляет их в «Ключи в схроне». Откройте в игре на ПК контейнер с ключами и листайте его.',
    en: 'Finds your keys and adds them to «Keys in stash». Open your key container in the game on the PC and scroll it.',
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
  currentTasksView: {
    ru: 'Как показывать длинный список на «Обзоре». Прокручивать: весь список в окне, крутите колесом мыши. Разворачивать: первые задания и кнопка «Ещё».',
    en: 'How the Overview shows a long list. Scroll: the whole list in a window, turn the mouse wheel. Expand: the first tasks and a «More» button.',
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
  accountSignOut: {
    ru: 'Выход из аккаунта на этом устройстве. Прогресс остаётся на сервере.',
    en: 'Signs out on this device. Your progress stays on the server.',
  },
  accountDelete: {
    ru: 'Аккаунт удалится через 10 дней: почта, никнеймы, прогресс, друзья и настройки. До этого срока удаление можно отменить.',
    en: 'The account goes in 10 days: e-mail, nicknames, progress, friends and settings. Until then the deletion can be cancelled.',
  },
  // «Настройка экрана»
  screenEnable: {
    ru: 'Включает выбранный пресет. Он работает только в рейде, пока окно игры на экране. В меню игры и на рабочем столе картинка обычная.',
    en: 'Turns on the chosen preset. It works only in a raid, while the game window is on screen. The game menus and the desktop stay as they are.',
  },
  screenMonitor: {
    ru: 'На каком мониторе менять картинку. «Тот, где игра» находит его сам. Другой выбирайте, если монитор определился неверно.',
    en: 'Which monitor\'s picture changes. «The one with the game» finds it by itself. Pick another if it finds the wrong one.',
  },
  screenFrame: {
    ru: 'Берёт кадр из окна игры, чтобы сравнить картинку до и после. Игра должна быть видна на экране.',
    en: 'Takes a frame from the game window to compare the picture before and after. The game must be visible on screen.',
  },
  screenPresets: {
    ru: 'Готовые настройки картинки: нажмите на строку, чтобы выбрать. Кнопки справа настраивают, переименовывают и убирают пресет.',
    en: 'Ready-made picture settings: click a row to choose one. The buttons on the right tune, rename and remove a preset.',
  },
  screenAddPreset: {
    ru: 'Создаёт ваш пресет из настроек выбранного. Таких можно сделать сколько угодно.',
    en: 'Makes a preset of your own from the chosen one\'s settings. You can make as many as you like.',
  },
  screenRestorePresets: {
    ru: 'Возвращает готовые пресеты: убранные снова в списке, изменения и новые названия сброшены. Ваши пресеты остаются.',
    en: 'Brings the ready-made presets back: removed ones return, changes and new names are dropped. Your own presets stay.',
  },
  screenCurve: {
    ru: 'График: слева направо тона от чёрного к белому. Линия выше диагонали делает тон светлее, ниже темнее. Игра меняется сразу, пока вы настраиваете.',
    en: 'The graph: tones from black to white, left to right. A line above the diagonal makes a tone lighter, below it darker. The game changes as you tune.',
  },
  screenScale: {
    ru: '«Тени крупно» растягивает тёмную часть графика: в игре почти всё в тёмных тонах, так их проще двигать. «Обычная шкала» делит график ровно.',
    en: '«Shadows large» stretches the dark part of the graph: the game is mostly dark tones, so they are easier to move. «Plain scale» divides it evenly.',
  },
  screenReset: {
    ru: 'Возвращает кривую, ползунки, зоны и фильтры к исходным: картинка как без настройки. Сохранённый пресет не изменится, пока вы не сохраните.',
    en: 'Puts the curve, sliders, zones and filters back: the picture as if untuned. The saved preset stays as it is until you save.',
  },
  zoneShadows: {
    ru: 'Двигает самые тёмные тона: почти чёрные углы и ночные тени. Вправо светлее, влево темнее.',
    en: 'Moves the darkest tones: nearly black corners and night shadows. Right is lighter, left is darker.',
  },
  zoneDarks: {
    ru: 'Двигает тёмные тона: коридоры, подвалы и ночные улицы. Вправо светлее, влево темнее.',
    en: 'Moves the dark tones: corridors, basements and streets at night. Right is lighter, left is darker.',
  },
  zoneLights: {
    ru: 'Двигает тона посветлее: то, что и так неплохо видно. Вправо светлее, влево темнее.',
    en: 'Moves the lighter tones: what is fairly easy to see already. Right is lighter, left is darker.',
  },
  zoneHighlights: {
    ru: 'Двигает самые светлые тона: лампы, окна и небо. Вправо светлее, влево темнее.',
    en: 'Moves the lightest tones: lamps, windows and the sky. Right is lighter, left is darker.',
  },
  screenGamma: {
    ru: 'Средние тона: вправо светлее, влево темнее. Чёрное и белое остаются на месте.',
    en: 'Mid-tones: right is lighter, left is darker. Black and white stay where they are.',
  },
  screenShadows: {
    ru: 'Поднимает тёмные участки, чтобы было видно, что в углах. Чёрное остаётся чёрным.',
    en: 'Lifts the dark areas so you can see into the corners. Black stays black.',
  },
  screenHighlights: {
    ru: 'Влево приглушает самые светлые участки: лампы и небо не выгорают, когда тени подняты. Вправо делает их ярче.',
    en: 'Left softens the brightest areas, so lamps and the sky do not burn out with the shadows raised. Right makes them brighter.',
  },
  screenContrast: {
    ru: 'Разница между тёмным и светлым: вправо резче, влево мягче.',
    en: 'The difference between dark and light: right is sharper, left is softer.',
  },
  screenBrightness: {
    ru: 'Сдвигает сразу все тона: вправо светлее, влево темнее. Чёрное тоже становится светлее.',
    en: 'Shifts every tone at once: right is lighter, left is darker. Black gets lighter too.',
  },
  screenTemperature: {
    ru: 'Основной цвет картинки: вправо теплее, влево холоднее.',
    en: 'The main colour of the picture: right is warmer, left is colder.',
  },
  screenTint: {
    ru: 'Оттенок картинки: вправо в пурпурный, влево в зелёный.',
    en: 'The tint of the picture: right towards magenta, left towards green.',
  },
  screenHaze: {
    ru: 'В тёмных комнатах самый тёмный тон не чёрный, а дымка. Фильтр убирает её, чтобы при осветлении на картинку не ложилась серая пелена.',
    en: 'In dark rooms the darkest tone is a haze, not black. The filter takes it off, so brightening does not lay a grey veil over the picture.',
  },
  screenNeutral: {
    ru: 'Убирает оттенок пресета: зелёный, синий, фиолетовый. На 100 % пресет меняет только яркость, а цвета остаются как в игре.',
    en: 'Removes the preset\'s tint: green, blue, purple. At 100 % the preset changes only the light, and the colours stay as in the game.',
  },
  screenCast: {
    ru: 'В тёмных сценах красного чуть больше других цветов, и при осветлении картинка буреет. Фильтр убирает этот налёт.',
    en: 'Dark scenes have a little more red than other colours, so brightening turns the picture brown. The filter removes this cast.',
  },
  screenVibrance: {
    ru: 'Добавляет в пресет цифровую интенсивность из драйвера NVIDIA: пока пресет работает, цвета насыщеннее. Потом драйвер возвращается к прежней.',
    en: 'Adds NVIDIA digital vibrance to the preset: colours are richer while the preset works. Then the driver goes back to its own value.',
  },
  screenSaturation: {
    ru: 'Насколько сочные цвета, пока работает этот пресет. 50% — обычное значение драйвера.',
    en: 'How rich the colours are while this preset works. 50% is the driver\'s usual value.',
  },
  screenAuto: {
    ru: 'Приложение смотрит на показанный кадр и само подбирает настройки: тёмной картинке поднимает тона, убирает дымку и красный налёт.',
    en: 'The app looks at the frame shown and picks the settings itself: it lifts a dark picture and removes the haze and the red cast.',
  },
  screenSave: {
    ru: 'Сохраняет настройки под выбранным названием. Если закрыть настройку крестиком, они пропадут.',
    en: 'Saves the settings under the name you give. If you close the tuning with the cross, they are lost.',
  },
  // «Оптимизировать компьютер»
  optimizeMode: {
    ru: 'Обычная меняет то, что применяется сразу. Продвинутая добавляет пункты, которые заработают после перезагрузки или повторного входа в Windows.',
    en: 'Normal changes what applies at once. Advanced adds steps that work after a restart or signing in to Windows again.',
  },
  optimizePower: {
    ru: 'Переключает схему питания Windows на «Высокую производительность». От батареи ноутбука схема не меняется.',
    en: 'Switches the Windows power plan to High performance. On a laptop\'s battery the plan stays as it is.',
  },
  optimizeGameMode: {
    ru: 'Включает «Игровой режим» в Windows: это тот же переключатель, что в параметрах Windows.',
    en: 'Turns on Game Mode in Windows: the same switch as in the Windows settings.',
  },
  optimizeRecording: {
    ru: 'Выключает запись игровой панели Windows (Xbox Game Bar). Скриншоты игры и запись в других программах продолжают работать.',
    en: 'Turns off recording by the Windows game panel (Xbox Game Bar). Game screenshots and recording in other programs keep working.',
  },
  optimizeWindowedGames: {
    ru: 'Включает параметр Windows «Оптимизации для оконных игр». Он действует, когда игра открыта в окне без рамки.',
    en: 'Turns on the Windows setting «Optimizations for windowed games». It works when the game runs in a borderless window.',
  },
  optimizeGameGpu: {
    ru: 'Указывает Windows запускать игру на мощной видеокарте, а не на встроенной. Другие программы это не затрагивает.',
    en: 'Tells Windows to run the game on the powerful video card, not the built-in one. Other programs are not affected.',
  },
  optimizeVisualEffects: {
    ru: 'Выключает анимации и тени окон Windows. Полностью заработает после повторного входа в Windows.',
    en: 'Turns off the animations and shadows of Windows windows. Works fully after signing in to Windows again.',
  },
  optimizePageFile: {
    ru: 'Отдаёт выбор размера файла подкачки самой Windows. Попросит права администратора, заработает после перезагрузки.',
    en: 'Lets Windows choose the page file size itself. Asks for administrator rights and works after a restart.',
  },
  optimizeGpuScheduling: {
    ru: 'Включает параметр Windows «Аппаратное ускорение планирования GPU». Попросит права администратора, заработает после перезагрузки.',
    en: 'Turns on the Windows setting «Hardware-accelerated GPU scheduling». Asks for administrator rights and works after a restart.',
  },
  optimizeConfirm: {
    ru: 'Применяет отмеченные пункты. Перед этим приложение спросит «Да» или «Нет».',
    en: 'Applies the ticked steps. The app asks «Yes» or «No» first.',
  },
  optimizeCancel: {
    ru: 'Возвращает отметки к рекомендованным и убирает отчёт. В Windows ничего не меняется.',
    en: 'Puts the ticks back to the recommended ones and clears the report. Nothing changes in Windows.',
  },
  optimizeRevert: {
    ru: 'Возвращает настройки Windows, которые изменило приложение, к прежним значениям. Часть заработает после перезагрузки.',
    en: 'Puts the Windows settings the app changed back to what they were. Some work only after a restart.',
  },
  optimizePc: {
    ru: 'Что Windows сообщает о вашем компьютере. Выделено то, что может мешать игре.',
    en: 'What Windows reports about your PC. Highlighted: what may hold the game back.',
  },
  optimizeTips: {
    ru: 'Что приложение не может сделать за вас: драйверы, настройки видеокарты, память и диск. Советы зависят от вашего компьютера.',
    en: 'What the app cannot do for you: drivers, video card settings, memory and disk. The tips depend on your PC.',
  },
  optimizeHeavy: {
    ru: 'Запущенные сейчас программы, которые заметно нагружают компьютер. Приложение их не закрывает.',
    en: 'Programs running now that load the PC noticeably. The app does not close them.',
  },
} as const satisfies Record<string, { ru: string; en: string }>

export type SettingHelpId = keyof typeof SETTING_HELP
