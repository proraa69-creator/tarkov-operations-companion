/**
 * English for the players' screens that had none (owner, 28.11.2026, from the phone: Russian or a word-by-word mix in every
 * language other than Russian). The nine other languages: the same English in src/i18n/locales/<language>.json.
 */
export const PLAYER_SCREEN_PHRASES: Array<[string, string]> = [
  // «Убежище» and «Квесты» → what to collect (pages/HideoutStashPage.tsx, pages/QuestItemsPage.tsx)
  ['Что собрать для убежища', 'What to collect for the hideout'],
  ['Все предметы на уровни, которые ещё не построены. Отметьте построенные уровни слева, найденное — кнопками «+» и «−».', 'Every item for the levels not built yet. Tick the built levels on the left and count what you find with «+» and «−».'],
  ['Все модули', 'All modules'],
  ['Только «найдено в рейде»', 'Found in raid only'],
  ['Ничего не нашлось', 'Nothing found'],
  ['Всё построено — убежищу больше ничего не нужно', 'Everything is built: the hideout needs nothing more'],
  ['Выберите предмет в тайнике — здесь будет, куда он нужен.', 'Pick an item in the stash to see where it is needed.'],
  ['Всё собрано', 'All collected'],
  ['Нужен найденный в рейде', 'Found in raid needed'],
  ['Найден ещё один', 'Found one more'],
  ['Собрано всё', 'Mark all found'],
  ['Куда нужен', 'Where it is needed'],
  // The phone's «Синхронизация по фото» (stashPhoto/PhotoSyncButton.tsx)
  ['Готовим фото…', 'Preparing the photo…'],
  ['Ищем сетку схрона…', 'Looking for the stash grid…'],
  ['Читаем подписи предметов…', 'Reading item labels…'],
  ['Сравниваем картинки…', 'Comparing pictures…'],
  ['Сетка схрона не найдена — снимите экран ровнее, весь схрон в кадре.', 'Stash grid not found: shoot the screen straighter, with the whole stash in the frame.'],
  ['Не удалось распознать фото. Попробуйте ещё раз.', 'Could not recognize the photo. Try again.'],
  ['Синхронизация по фото', 'Photo sync'],
  ['Нужных предметов на фото не найдено.', 'No needed items found in the photo.'],
  ['Подписи предметов прочитать не удалось — найдено только по картинкам, проверьте список.', 'The item labels could not be read: found by pictures only, check the list.'],
  ['Фото обработано на телефоне и никуда не отправлялось.', 'The photo was processed on the phone and sent nowhere.'],
  // The subscription chip and its reminder (account/SubscriptionExpiryNotice.tsx)
  ['Подписка навсегда', 'Lifetime subscription'],
  ['Открыть оплату подписки', 'Open subscription payment'],
  ['ПОДПИСКА', 'SUBSCRIPTION'],
  ['Срок подписки скоро закончится', 'Your subscription ends soon'],
  ['Продлить подписку', 'Renew subscription'],
  // The screens of a start that failed (app/App.tsx, main.tsx)
  ['Неизвестная ошибка', 'Unknown error'],
  ['Интерфейс не смог открыться', 'The interface could not open'],
  ['Ошибка больше не оставляет пустой экран. Восстановление очистит только интерфейсный кэш и откроет «Обзор», аккаунт и прогресс останутся на месте.', 'An error no longer leaves an empty screen. Recovery clears only the interface cache and opens «Overview»; your account and progress stay in place.'],
  ['Восстановить запуск', 'Recover start-up'],
  ['Перезагрузить', 'Reload app'],
  ['Приложение не смогло запуститься', 'The app could not start'],
  ['Мы поймали ошибку вместо пустого экрана. Нажмите восстановление запуска: приложение очистит повреждённый интерфейсный кэш и перезагрузится.', 'We caught an error instead of an empty screen. Press «Recover start-up»: the app clears the damaged interface cache and reloads.'],
  // «Баллистика» → «Падение пули» (arsenal/BulletDrop.tsx, pages/ReferencePages.tsx)
  ['Для расчёта падения нужны масса, диаметр пули и баллистический коэффициент — в этих данных их нет. Они появятся с живыми данными игры.', 'The drop needs the bullet’s mass, diameter and ballistic coefficient, and this data has none. They come with the game’s live data.'],
  ['Добавить патрон', 'Add a round'],
  ['+ Патрон для сравнения', '+ Round to compare'],
  ['Падение пули по дистанции', 'Bullet drop by distance'],
  ['Расчёт по модели игры: сопротивление G1 по массе, диаметру и баллистическому коэффициенту пули, шаг 0,01 с; линия прицеливания на 6,86 см выше ствола. Урон и пробитие падают до половины вместе со скоростью. Начальная скорость — из данных патрона; ствол и дульное устройство меняют её в «Сборке оружия».', 'Computed with the game’s model: G1 drag from the bullet’s mass, diameter and ballistic coefficient, a 0.01 s step; the line of sight 6.86 cm above the barrel. Damage and penetration fall to half along with the speed. The muzzle velocity is the round’s own; the barrel and the muzzle device change it in «Weapon build».'],
  ['Пробитие и урон всех патронов, падение пули по дистанции и шанс пробить броню 1–6 класса.', 'Penetration and damage of every round, bullet drop by distance and the chance to penetrate class 1–6 armor.'],
  ['до 600 м · сравнение до 4 патронов', 'up to 600 m · compare up to 4 rounds'],
  // «Карта и предметы в рейде» (pages/RaidToolsSettings.tsx)
  ['Не удалось загрузить настройки.', 'Could not load the settings.'],
  ['Не удалось загрузить модуль клавиатуры и захвата экрана:', 'Could not load the keyboard and screen capture module:'],
  // The scan for the Collector by its key (components/ExperimentalBridge.tsx)
  ['Список предметов не загружен. Обновите каталог в приложении.', 'The item list is not loaded. Refresh the catalog in the app.'],
  ['Распознавание предметов началось.', 'Item recognition has started.'],
  ['Окно игры не найдено. Откройте схрон и повторите сканирование.', 'Game window not found. Open your stash and scan again.'],
  ['Не удалось распознать предметы.', 'Could not recognize the items.'],
  // Single texts of other screens
  ['Ожидаем актуальные задачи из игры.', 'Waiting for the current goals from the game.'],
  ['ЧВК + дикие', 'PMC + Scavs'],
  ['Уровни торговцев', 'Trader levels'],
  ['Геопозиция', 'Location'],
  ['Кровавая луна', 'Blood Moon'],
  ['Тыква', 'Pumpkin'],
  ['Неизвестный запрос сервиса', 'Unknown service request'],
  ['задание из логов', 'a task from the logs'],
]

/** Whole texts only (src/i18n/uiEnglish.ts WHOLE_ONLY): short words that must never replace part of another sentence. */
export const PLAYER_SCREEN_WORDS: Array<[string, string]> = [
  ['Собрано', 'Collected'], ['собрано', 'collected'], ['Тайник', 'Stash'], ['за шт.', 'each'], ['сомнительно', 'unsure'], ['Пристрелка', 'Zeroing'],
  ['пристрелка', 'zero'], ['Единицы', 'Units'], ['см', 'cm'], ['дюймы', 'inches'], ['Падение', 'Drop'], ['Время, с', 'Time, s'],
  ['от', 'from'], ['Не удалось', 'Failed'],
]

export const PLAYER_SCREEN_RULES: Array<[RegExp, string]> = [
  // the subscription reminder after «Осталось 3 дня.»
  [/Доступ действует до (\d{1,2}\.\d{1,2}\.\d{4})\. Продлите подписку, чтобы приложение продолжило работать без перерыва\./g, 'Access lasts until $1. Renew the subscription to keep the app working without a break.'],
  // the Collector scan by its key
  [/^Найдено предметов: (\d+)\. Добавлено новых: (\d+)\.$/g, 'Items found: $1. Newly added: $2.'],
  // «Ваш компьютер»: the video card's driver and its date
  [/^драйвер (\S+) от (\d{2}\.\d{2}\.\d{4})$/g, 'driver $1 dated $2'],
  // the support chat's screenshots
  [/^Не больше (\d+) скриншотов\.$/g, 'At most $1 screenshots.'],
  [/^Не больше (\d+) скриншотов$/g, 'At most $1 screenshots'],
  // sign-in errors the server gave no text for (sync/webAccount.ts)
  [/^Не удалось войти: (\d+)$/g, 'Could not sign in: $1'],
  [/^Сервис недоступен: (\d+)$/g, 'Service unavailable: $1'],
  [/^Не удалось создать код: (\d+)$/g, 'Could not create a code: $1'],
  [/^Не удалось зарегистрироваться: (\d+)$/g, 'Could not sign up: $1'],
  [/^Не удалось подтвердить e-mail: (\d+)$/g, 'Could not confirm the e-mail: $1'],
]
