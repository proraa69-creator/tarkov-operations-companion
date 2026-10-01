---
name: build-exe
description: Собрать Windows exe приложения (portable) и доставить пользователю — на его ПК сразу на рабочий стол, из облачной сессии частями в чат плюс cmd, который одной кнопкой собирает exe на рабочем столе. Используй, когда пользователь просит собрать/забилдить/упаковать exe, сделать сборку для теста, положить exe на рабочий стол или отправить exe сюда.
---

# Сборка exe на рабочий стол

Приложение называется **Raid OS** (раньше Tarkov Operator). Данные пользователей по-прежнему лежат в
`%APPDATA%\Tarkov Operator` (`electron/main.ts`), поэтому после обновления прогресс и настройки сохраняются.

## Две версии (обязательно прочитать)

С появлением входа в аккаунт есть два exe (`electron/buildEdition.ts`, флаг ставит `scripts/write-build-info.mjs`):

- **Версия владельца** — `OWNER_BUILD=1`. «Аккаунт сервера», кнопка «Сервер», сервер/туннель/оплата/стримеры.
  Для игрового ПК владельца и для ноутбука-сервера (`Server-Laptop-Setup.cmd`).
- **Версия для игроков** — без `OWNER_BUILD` (по умолчанию). Окно входа в аккаунт при первом запуске, «Личный кабинет»,
  сервер `https://raidos.app` вшит (`TARKOV_DEFAULT_SERVER_URL` меняет адрес, пустое значение убирает). Именно её
  сайт отдаёт по кнопке «Скачать для Windows».

Если пользователь не сказал, какую версию, собирай **обе** (облако) или версию владельца (его ПК, `-Client` для игроков).

Два режима:
- **Windows (ПК пользователя)** — «Шаги на Windows» ниже, exe сразу на рабочий стол.
- **Облако / Linux** — «Сборка в облаке и отправка в чат»: собрать exe, разрезать на части, отправить сюда, пользователь одним двойным кликом собирает exe на рабочем столе.

## Шаги на Windows

1. Проверь, что это Windows (`$env:OS` = `Windows_NT` или `process.platform === 'win32'`). Если нет — переходи к разделу «Сборка в облаке и отправка в чат».
2. Посмотри `git status` и текущую ветку и сообщи пользователю, из какой ветки собирается exe. Ничего не коммить, не переключай ветки и не откатывай изменения без явной просьбы.
3. Запусти из корня репозитория (сборка идёт несколько минут, таймаут ставь с запасом, до 10 минут):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/build-exe-to-desktop.ps1           # версия владельца
   powershell -ExecutionPolicy Bypass -File scripts/build-exe-to-desktop.ps1 -Client   # версия для игроков
   ```

   - Другая папка: добавь `-Desktop "D:\путь"`.
   - Если `node_modules` уже есть, скрипт не запускает `npm install`. Если сборка падает из-за отсутствующих зависимостей — запусти `npm install` и повтори.
4. Скрипт заменяет на рабочем столе только exe с тем же именем (`Raid OS <версия>.exe`; сборки до переименования назывались `Tarkov Operator <версия>.exe` — их скрипт не трогает). Больше ничего на рабочем столе не трогай и не удаляй.
5. Сообщи пользователю итог: полный путь к exe на рабочем столе, размер и ветку/коммит (`git log --oneline -1`). Если сборка упала — покажи последние строки ошибки и не выдавай сборку за успешную.

## Сборка в облаке и отправка в чат

Лимит отправки файла в чат — 30 МБ, exe весит ~130 МБ, поэтому он уходит частями по 25 МБ.

1. `git status` / `git log --oneline -1` — сообщи, из какой ветки и коммита сборка.
2. koffi для Windows нет в Linux-`node_modules`. Если нет `node_modules/@koromix/koffi-win32-x64`, скачай его (версию возьми из `node_modules/koffi/package.json` → `optionalDependencies`) во временную папку scratchpad и распакуй:
   ```bash
   npm pack @koromix/koffi-win32-x64@<версия> --pack-destination "$SP"
   mkdir -p node_modules/@koromix/koffi-win32-x64
   tar -xzf "$SP"/koromix-koffi-win32-x64-<версия>.tgz -C node_modules/@koromix/koffi-win32-x64 --strip-components=1
   ```
   Это только локальная папка сборки, в `package.json` не добавляй.
3. Сборка обеих версий (каждая до 10 минут). Сначала версия для игроков, её `build-info.json` сохраняется сразу после
   сборки (следующая сборка его перезапишет):
   ```bash
   npm run build
   cp dist-electron/build-info.json "$SP/client-build-info.json"
   npx electron-builder --win portable --x64 -c.win.signAndEditExecutable=false -c.npmRebuild=false
   # → release/Raid OS <версия>.exe  (игроки)
   OWNER_BUILD=1 npm run build
   npx electron-builder --win portable --x64 -c.win.signAndEditExecutable=false -c.npmRebuild=false -c.win.artifactName='Raid OS Owner ${version}.exe'
   # → release/Raid OS Owner <версия>.exe  (владелец)
   ```
   Сборка печатает `Build <версия> <коммит> · client · server https://raidos.app` / `· owner` — проверь строку.
   Проверь, что в `release/win-unpacked/resources/app.asar.unpacked` есть `.node` koffi для `win32_x64`, prebuild `uiohook-napi` для `win32-x64` и `tessdata`.
4. Разрежь exe в **новую** папку scratchpad (скрипт сам откажется писать в непустую; `rm` для очистки не используй — бери новое имя папки):
   ```bash
   scripts/split-exe-for-chat.sh "release/Raid OS Owner <версия>.exe" "$SP/exe-parts-<метка>" \
     "release/Raid OS <версия>.exe" "$SP/client-build-info.json"
   ```
   Получатся `RaidOS.part0..N` (владелец), `RaidOSClient.part0..N` (игроки), `Join-Raid-OS.cmd`
   (владелец на рабочий стол + запуск), `Join-Raid-OS-Client.cmd` (игроки на рабочий стол, без запуска) и
   `Server-Laptop-Setup.cmd` (ноутбук: сервер + публикация версии для игроков на сайт). Все ASCII, CRLF, со вшитыми SHA256.
   Скрипт откажется, если `client-build-info.json` не от версии для игроков. Только одна версия — только первые два аргумента.
5. Отправь через `SendUserFile` (`display: "attach"`) сначала `Join-Raid-OS.cmd`, затем все части — по 1 файлу за вызов (каждый ≤ 30 МБ).
6. Инструкция пользователю: скачать все файлы в одну папку (например «Загрузки») и дважды кликнуть `Join-Raid-OS.cmd`. Он проверит, что все части на месте, соберёт `Raid OS Owner <версия>.exe` на рабочем столе (сначала `C:\Users\BANGKOK PC\Desktop`, иначе рабочий стол из Windows, работает и с OneDrive), сверит SHA256, напишет `OK` и сам запустит приложение (окно cmd закроется через 5 секунд — это нормально). После этого части и cmd можно удалить.
7. Если SmartScreen ругается на неподписанный exe — «Подробнее» → «Выполнить в любом случае».

## Частые ошибки

- **Файл занят** при копировании — запущена старая версия приложения. Попроси закрыть её и повтори шаг 3 с `-SkipInstall`.
- **Скрипты PowerShell запрещены** — флаг `-ExecutionPolicy Bypass` действует только на этот запуск; системную политику не меняй.
- Готовый exe и его части никогда не коммить в git (`release/` в `.gitignore`, части лежат только в scratchpad).
- **HASH MISMATCH** при склейке — какая-то часть скачалась не полностью или браузер переименовал её (например `RaidOS (1).part2`). Скачать части заново в пустую папку.
