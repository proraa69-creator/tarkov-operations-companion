/** English strings for the reworked «Мини-карта» page (ExperimentalPage.tsx). */
export const MINIMAP_PAGE_PHRASES: Array<[string, string]> = [
  ['Функции мини-карты и информация о предмете во время рейда', 'Mini map and item info during a raid'],
  ['Мини-карта и карточка предмета показываются поверх игры. Для этого в настройках графики поставьте режим экрана «Безрамочный».', 'The mini map and the item card are shown over the game. For this, set the screen mode to “Borderless” in the graphics settings.'],
  ['Сейчас игра в эксклюзивном полноэкранном режиме — окна поверх неё не видны.', 'The game is in exclusive full screen now — windows over it are not visible.'],
  ['Функции', 'Features'],
  ['Размер мини-карты', 'Mini map size'],
  ['Показывает цену на барахолке и у выгодного торговца, а также нужен ли предмет для Каппы.', 'Shows the flea market price, the best trader price, and whether the item is needed for Kappa.'],
  ['Показывает и скрывает мини-карту в рейде.', 'Shows and hides the mini map in a raid.'],
  ['Клавиша сканирования предметов для коллекционера', 'Collector item scan key'],
  ['Поместите все предметы для квеста «Коллекционер» в один контейнер.', 'Put all items for the “Collector” quest into one container.'],
  ['не назначена', 'not set'],
  ['Определить автоматически', 'Detect automatically'],
  ['Определяю клавишу скриншота…', 'Detecting the screenshot key…'],
  
  
  
  
  ['Папка со скриншотами', 'Screenshots folder'],
  ['Выбрать папку со скриншотами', 'Choose screenshots folder'],
  ['(найдена автоматически)', '(detected automatically)'],
  ['(выбрана вручную)', '(chosen manually)'],
  ['(в выбранной вручную папке нет скриншотов игры — использую папку игры)', '(the chosen folder has no game screenshots — using the game folder)'],
  // «Точка на мини-карте» (overlay/positionReadiness.ts, overlay/PositionSetupCard.tsx)
  ['Точка на мини-карте', 'Dot on the mini map'],
  
  ['В игре не назначена клавиша скриншота', 'The game has no screenshot key'],
  
  
  
  
  ['Игра запущена от имени администратора', 'The game runs as administrator'],
  ['нет позиции: перезапустите Raid OS от имени администратора', 'no position: restart Raid OS as administrator'],
  
  
  
  
  ['Мини-карта включена', 'The mini map is on'],
  ['Мини-карта отключена', 'The mini map is off'],
  ['Включить мини-карту', 'Turn the mini map on'],
  ['Отключить мини-карту', 'Turn the mini map off'],
  
  ['Лаунчер BSG запускает игру от имени администратора. Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре: мини-карта и карточка предмета по клавише не срабатывают. Скриншот, который вы делаете сами, мини-карта покажет и так.', 'The BSG launcher starts the game as administrator. While Raid OS runs without those rights, Windows hides the keys pressed in the game from it: the mini map and the item card do not open by their keys. A screenshot you take yourself still shows on the mini map.'],
  ['Raid OS сам ничего не нажимает в игре: позицию даёт скриншот, который игра делает по этой клавише. Поставьте её в игре (Настройки → Управление → «Скриншот») на клавишу мини-карты — одно нажатие откроет мини-карту и обновит точку, а в папке останется только последний такой скриншот.', 'Raid OS never presses anything in the game: the position comes from the screenshot the game takes with this key. Bind it in the game (Settings → Controls → “Screenshot”) to the mini map key — one press then opens the mini map and moves the dot, and only the newest such screenshot stays in the folder.'],
  ['Клавиша карты открывает мини-карту поверх игры. Позицию даёт скриншот, который делает сама игра по той же клавише, — она видна здесь и в телефоне.', 'The map key opens the mini map over the game. The position comes from the screenshot the game itself takes with the same key — you see it here and on your phone.'],
  ['Клавиша карты ничего не делает: приложение не открывает мини-карту и не следит за папкой скриншотов, поэтому вашей позиции нет ни на картах, ни в телефоне. Информация о предмете работает как раньше.', 'The map key does nothing: the app does not open the mini map or watch the screenshots folder, so your position is not shown on the maps or on your phone. Item info works as before.'],
  ['В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот») на клавишу мини-карты.', 'No screenshot key is bound in the game. Bind it in the game (Settings → Controls → “Screenshot”) to the mini map key.'],
  ['По настройкам игры:', 'From the game settings:'],
  ['По журналу игры:', 'From the game log:'],
  ['В настройках игры не найдена, по умолчанию:', 'Not found in the game settings, default:'],
  ['Клавиша скриншота в игре', 'Screenshot key in the game'],
  ['Мини-карта не видит клавиши', 'The mini map does not see the keys'],
  ['Не загрузился модуль Windows, который видит нажатия клавиш в игре: мини-карта не откроется по клавише. Переустановите Raid OS.', 'The Windows module that sees the keys pressed in the game did not load: the mini map will not open by its key. Reinstall Raid OS.'],
  ['мини-карта не видит клавиши: переустановите Raid OS', 'the mini map does not see the keys: reinstall Raid OS'],
  ['Позиция берётся из скриншота, который делает игра. Назначьте в игре «Скриншот» (Настройки → Управление) на клавишу мини-карты — тогда одно нажатие откроет мини-карту и обновит точку.', 'The position comes from the screenshot the game takes. Bind “Screenshot” in the game (Settings → Controls) to the mini map key — one press then opens the mini map and moves the dot.'],
  ['нет позиции: в игре не назначен «Скриншот» — поставьте его на клавишу мини-карты', 'no position: “Screenshot” is not bound in the game — bind it to the mini map key'],
  ['Поставьте скриншот на клавишу мини-карты', 'Bind the screenshot to the mini map key'],
  ['Позиция берётся из скриншота, который делает игра по вашей клавише, — Raid OS сам ничего не нажимает. Назначьте в игре «Скриншот» (Настройки → Управление) на ту же клавишу, что открывает мини-карту: одно нажатие откроет мини-карту и обновит точку.', 'The position comes from the screenshot the game takes with your key — Raid OS presses nothing itself. Bind “Screenshot” in the game (Settings → Controls) to the same key that opens the mini map: one press then opens the mini map and moves the dot.'],
  ['точка не обновится: в игре «Скриншот» не на клавише мини-карты', 'the dot will not move: the game’s “Screenshot” is not on the mini map key'],
  ['Пока Raid OS работает без этих прав, Windows скрывает от него клавиши, нажатые в игре, — мини-карта не откроется по клавише. Перезапустите приложение от имени администратора.', 'While Raid OS runs without these rights, Windows hides the keys pressed in the game from it — the mini map will not open by its key. Restart the app as administrator.'],
  ['мини-карта не видит клавиши: перезапустите Raid OS от имени администратора', 'the mini map does not see the keys: restart Raid OS as administrator'],
  ['не назначен', 'not bound'],
  ['Сейчас «Скриншот» в игре:', 'Now the game’s “Screenshot”:'],
  ['мини-карта:', 'mini map:'],
  ['Открывать мини-карту клавишей', 'Open the mini map with'],
  ['Готово: мини-карта открывается клавишей', 'Done: the mini map opens with'],
  ['— той же, что делает скриншот в игре.', '— the same key that takes the screenshot in the game.'],
  ['Не получилось. Попробуйте ещё раз.', 'That did not work. Try again.'],
  // The owner's minimap switch for every app and the one-time notice while it is off (14.10.2026).
  ['Функция мини-карты временно выключена — для спокойствия пользователей. Ожидаем официального ответа от BSG! Спасибо за понимание. Если возникли вопросы, задайте их в нашем Telegram.', 'The minimap feature is temporarily turned off, for our users\' peace of mind. We are waiting for an official answer from BSG. Thank you for understanding! If you have questions, ask us on Telegram.'],
  ['Функции мини-карты (окно поверх игры и отслеживание)', 'Mini map features (the window over the game and tracking)'],
  ['Функции мини-карты', 'Mini map features'],
  ['Мини-карта и отслеживание:', 'Mini map and tracking:'],
  ['включены у всех', 'on for everyone'],
  ['выключены у всех', 'off for everyone'],
  ['Окно мини-карты поверх игры:', 'Mini map window over the game:'],
  ['включено у всех', 'on for everyone'],
  ['выключено у всех', 'off for everyone'],
  ['Выключить окно для всех', 'Turn the window off for everyone'],
  ['Включить окно для всех', 'Turn the window on for everyone'],
  ['Окно мини-карты поверх игры временно выключено — позиция показывается на карте в приложении.', 'The minimap window over the game is temporarily turned off; your position is shown on the map in the app.'],
  ['Позицию даёт скриншот, который делает сама игра по клавише «Скриншот», — она видна на карте в приложении и в телефоне.', 'The position comes from the screenshot the game itself takes with its “Screenshot” key — you see it on the map in the app and on your phone.'],
  ['Raid OS сам ничего не нажимает в игре: позицию даёт скриншот, который игра делает по этой клавише. Сделайте скриншот в рейде — точка на карте в приложении обновится.', 'Raid OS never presses anything in the game: the position comes from the screenshot the game takes with this key. Take a screenshot in a raid and the dot on the map in the app moves.'],
  ['В игре клавиша скриншота не назначена. Назначьте её в игре (Настройки → Управление → «Скриншот»).', 'The screenshot key is not bound in the game. Bind it in the game (Settings → Controls → “Screenshot”).'],
  ['Позиция берётся из скриншота, который делает игра, — Raid OS сам ничего не нажимает. Назначьте в игре «Скриншот» (Настройки → Управление) на удобную клавишу: после каждого скриншота в рейде точка на карте в приложении обновится.', 'The position comes from the screenshot the game takes — Raid OS presses nothing itself. Bind “Screenshot” in the game (Settings → Controls) to any key you like: after each screenshot in a raid the dot on the map in the app moves.'],
  ['Сейчас включены у всех игроков', 'Now on for all players'],
  ['Сейчас выключены у всех игроков', 'Now off for all players'],
  ['Эту карточку видит только владелец.', 'Only the owner sees this card.'],
  ['Выключить для всех', 'Turn off for everyone'],
  ['Включить для всех', 'Turn on for everyone'],
  ['Не удалось переключить. Проверьте вход в аккаунт владельца и попробуйте ещё раз.', 'Could not switch. Check the owner account sign-in and try again.'],
]
