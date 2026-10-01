/** English for Settings (theme chooser, app update, smoke preview), the sidebar foot and the Kappa congratulation. */
export const SETTINGS_AREA_PHRASES: Array<[string, string]> = [
  // «Цветовая схема» (ThemePicker)
  ['Выбрать', 'Choose'], ['ОК', 'OK'],
  ['Схема включена для просмотра. Нажмите «ОК», чтобы оставить её.', 'The scheme is on for a preview. Press “OK” to keep it.'],
  ['Нажмите на схему — она сразу применится.', 'Click a scheme and it is applied at once.'],
  // Данные → app update (AppUpdateSettings)
  ['Обновление приложения', 'App update'], ['Версия', 'Version'], ['Проверить обновление приложения', 'Check for app update'],
  ['Повторить', 'Retry'], ['уже загружена', 'already downloaded'],
  ['Найдена новая версия', 'A new version is available'], ['Установлена последняя версия', 'You have the latest version'],
  ['Сервер обновлений недоступен, попробуйте позже', 'The update server is unreachable, try again later'],
  ['Версия на сервере без действительной подписи, обновление не предлагается', 'The version on the server has no valid signature, so it is not offered'],
  ['Не задан сервер обновлений (адрес сервера другого компьютера)', 'No update server is set (the server address of another computer)'],
  ['Обновление работает только в собранной portable-версии', 'Updating works only in the built portable version'],
  ['В этой сборке обновление выключено', 'Updating is turned off in this build'], ['Обновление уже загружается', 'The update is already downloading'],
  ['Обновления приложения приходят в версии для Windows', 'App updates come with the Windows version'],
  ['Автообновление', 'Auto update'], ['Проверять новую версию при запуске и каждые 6 часов', 'Check for a new version at start and every 6 hours'],
  ['Автоустановка', 'Auto install'],
  ['Ставить найденную версию самому: сразу после запуска (не во время рейда) или при закрытии приложения', 'Install a found version by itself: right after start (never during a raid) or when the app is closed'],
  ['Файл обновления повреждён, попробуйте ещё раз', 'The update file is damaged, please try again'],
  ['Нет доступа к папке с приложением: переместите exe, например, на рабочий стол', 'No access to the app folder: move the exe, for example, to the desktop'],
  ['Обновление доступно только для portable-версии', 'Updating is available only for the portable version'],
  // smoke preview and readout (RaidSmokePreview)
  ['Предпросмотр дыма', 'Smoke preview'], ['Предпросмотр', 'Preview'], ['Текущие параметры дыма', 'Current smoke values'],
  ['Копировать', 'Copy'], ['Скопировано', 'Copied'], ['Оттенок (темнее — светлее)', 'Tone (darker — lighter)'],
  // sidebar foot (SidebarOperator)
  ['Оператор', 'Operator'],
  // Kappa items page and the congratulation (KappaCongrats)
  ['Откройте схрон и нажмите «Сканировать». Все предметы должны быть в одном контейнере.', 'Open your stash and press “Scan”. All items must be in one container.'],
  ['Поздравляем, Каппа ваша!', 'Congratulations, the Kappa is yours!'], ['Забрать контейнер', 'Claim the container'],
]
