# Автообновление сервера Raid OS: «помощник обновления не запустился»

Документ для разработчика или ИИ-ассистента, который будет чинить проблему. Здесь всё, что известно на 04.10.2026:
как устроено обновление, что именно ломается, что уже проверено и исключено, гипотезы, что нужно сделать и как проверить.

## 1. Как устроено автообновление

Приложение — Electron (Windows, portable-сборка electron-builder). На ноутбуке-сервере оно работает в режиме
`--server-mode --enable-tunnel` и раздаёт API + сайт через Cloudflare Tunnel.

1. Раз в 15 минут приложение читает `latest.json` из приватного GitHub-репозитория релизов, скачивает части новой
   сборки, проверяет подпись Ed25519 манифеста, размеры и SHA-256 каждой части, собирает новый exe
   (`electron/serverSelfUpdate.ts`, класс обновлятеля, `fetchRelease` / `verifyStagedRelease`).
   **Эта часть работает**: в админке все 14 частей «проверен», статус «скачано и проверено».
2. При установке (`electron/selfUpdate.ts`, функция `handOver`) приложение:
   - пишет `state.json` (id перезапуска), скрипт `update-helper.ps1` (UTF-8 с BOM) в
     `%APPDATA%\Tarkov Operator\server\self-update\`;
   - запускает **PowerShell-помощник** (`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass
     -WindowStyle Hidden -File update-helper.ps1`), передавая пути через переменные окружения `RAIDOS_*`
     (`helperEnvironment` в `electron/serverSelfUpdate.ts`);
   - ждёт, пока помощник запишет `helper.pid` с тем же id (рукопожатие), и только тогда закрывается;
   - помощник ждёт выхода приложения, подменяет exe-обёртку
     (`%LOCALAPPDATA%\TarkovOperatorServer\Tarkov Operator Server.exe`), запускает новую версию, 2 минуты проверяет
     `/health` и сайт, при сбое откатывает.
3. Если `helper.pid` не появился, перезапуск отменяется (`state.json` удаляется — запоздавший помощник ничего не
   делает), в историю пишется `helper-not-started`, сервер остаётся на старой версии. Это безопасно, но обновление
   не происходит.

Запущенное приложение — внутренний exe, который portable-обёртка распаковывает в
`%TEMP%\nsXXXX.tmp\app\Raid OS.exe`. Обёртка лежит в `%LOCALAPPDATA%\TarkovOperatorServer\`. Приложение на ноутбук
ставится скриптом `Server-Laptop-Setup.cmd`, который в конце делает `start "" "%TARGET%" --server-mode --enable-tunnel`.

## 2. Симптом

Админ-панель → «Обновление»: «Ошибка автообновления — помощник обновления не запустился (PowerShell заблокирован?) —
обновление отменено, сервер остался в прежней версии». Сборки: установлена 1791046622092 (коммит c70e4f6), новая
1791047337965 (1b650b9) скачана и проверена.

Журнал `%APPDATA%\Tarkov Operator\server\self-update\update-helper.log` (путь пользователя заменён на `%USERPROFILE%`):

```text
2026-10-04 03:37:14.041 [app] update 0.5.4 (1791046622092) -> 0.5.4 (1791047337965), restart 1791049034038: starting the helper; app pid 8608 (%USERPROFILE%\AppData\Local\Temp\nshC414.tmp\app\Raid OS.exe), wrapper %USERPROFILE%\AppData\Local\TarkovOperatorServer\Tarkov Operator Server.exe; PowerShell found at C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
2026-10-04 03:37:14.045 [app] attempt "direct": PowerShell spawned, pid 12372
2026-10-04 03:37:29.211 [app] attempt "direct" failed; PowerShell printed nothing
2026-10-04 03:37:29.216 [app] attempt "launcher": PowerShell spawned, pid 10384
2026-10-04 03:37:44.283 [app] attempt "launcher" failed; PowerShell printed nothing
2026-10-04 03:37:44.285 [app] the helper did not start: restart cancelled, this copy keeps running
```

- Ни одной строки `[helper]` или `[launcher]` — скрипт не выполнил даже первую строку `Log(...)`.
- `update-helper.out.log` (туда шли stdout/stderr PowerShell в этой версии) — **пустой**.
- В Диспетчере задач через ~12 минут **нет ни одного powershell.exe** — процессы не висят, они завершились.
- Код выхода не записан: тогдашний код записывал только ненулевой код (`if (code)`), значит, вероятно, **выход с кодом 0**
  (или процесс убит так, что событие не пришло).

## 3. История (что работало, что нет)

| Сборка приложения (коммит) | Как запускался помощник | Результат |
|---|---|---|
| 1790894662860 (4098384) | `spawn(powershell, [... '-File', helper], { detached: true, windowsHide: true, stdio: 'ignore', env: короткий список })`, без рукопожатия: приложение закрывалось через 1,5 с | **Помощник работал**: подменил exe, новая версия не стартовала («start-failed»), откат сработал |
| 1791041802664 (bdbaeea, код d178329) | через «launcher» (`-EncodedCommand`, внутри `Start-Process` помощника), env — короткий список, ожидание `helper.pid` 20 с | «helper-not-started», ни строки `[launcher]` |
| 1791046622092 (c70e4f6) | попытка 1: `-File` напрямую, **весь** `process.env`, stdout/stderr в файл; попытка 2: launcher; по 15 с | «helper-not-started» (журнал выше), вывод пустой |

Короткий список env первой версии: `SystemRoot, windir, PATH, Path, TEMP, TMP, USERPROFILE, LOCALAPPDATA, APPDATA,
ComSpec, PSModulePath, ProgramFiles, ProgramData` + переменные `RAIDOS_*`.

## 4. Что уже проверено и исключено

- **Скрипт помощника корректен.** `update-helper.ps1` и launcher разобраны парсером PowerShell
  (`[System.Management.Automation.Language.Parser]::ParseFile`) — 0 ошибок. Помощник запущен в PowerShell 7.4 (Linux)
  с подставными `RAIDOS_*`: сразу пишет `helper.pid`, журнал, transcript и корректно выходит
  («state.json no longer has this restart»). На Windows PowerShell 5.1 так не проверялся.
- **PowerShell на ноутбуке есть и запускается вручную**: `$PSVersionTable` = 5.1.19041.6456; `Get-ExecutionPolicy -List`
  — везде `Undefined`; файл `powershell.exe` найден по ожидаемому пути (`PowerShell found` в журнале).
- **Релиз цел**: подпись, размеры и SHA-256 всех частей проверены тем же кодом, что на ноутбуке.
- **Antivirus**: пользователь добавлял папку в исключения Defender; позже Windows показывала «Защита от вирусов
  отключена». В Диспетчере задач работают `MsMpEng.exe` и `MpDefenderCoreService.exe`.
- **Процессы не висят** (п. 2).

## 5. Гипотезы (по убыванию вероятности)

1. **Переменные `RAIDOS_*` не доходят до PowerShell.** Тогда помощник молча выходит с кодом 0: все записи в журнал
   и в `helper.pid` обёрнуты в `try {} catch {}`, путь пустой → исключение проглатывается; затем `Test-Cancelled`
   не находит `state.json` и выходит. Launcher без `RAIDOS_LOG` тоже не пишет журнал. Это объясняет всё: нет строк,
   нет вывода, нет висящих процессов, код 0. Непонятно, почему в первой версии env доходил.
2. **PowerShell в режиме Constrained Language Mode** (WDAC/AppLocker/`__PSLockdownPolicy`). Вызовы
   `[System.IO.File]::...` и `New-Object System.Text.UTF8Encoding` запрещены → исключения проглатываются → тишина.
   Но тогда launcher упал бы с кодом 1 и выводом в stderr, а вывод пустой — менее вероятно.
3. **Защитное ПО (Defender ASR / сторонний антивирус) завершает дочерний PowerShell**, запущенный из Electron-приложения
   из `%TEMP%`. Обычно при этом ненулевой код и событие в журнале Защитника.
4. **Медленный холодный старт PowerShell 5.1** (>15 с, например при сломанных ngen-образах .NET после обновления Windows).
   Но тогда запоздавший помощник дописал бы строки `[helper] started…` после отмены — их нет.

## 6. Что уже добавлено для диагностики (коммиты 4a06708, a8a4c4a, ещё не установлены на ноутбук)

`electron/selfUpdate.ts`:
- **Проба перед попытками**: `powershell -Command "if ($env:RAIDOS_ID) { exit 7 } else { exit 8 }"` с тем же env и
  флагами. В журнале: `probe: PowerShell works and sees the helper's settings (exit 7 …)` /
  `… does NOT see the helper's environment variables (exit 8 …)` / другой код / «hangs at start».
- Каждая попытка ждёт 40 с; в журнал пишется, как закончился процесс (любой код, включая 0, и время) или что он
  ещё висел (тогда его останавливаем).
- Попытка 1 — тот же короткий env, что у первой рабочей версии, `stdio: 'ignore'`; попытка 2 — launcher;
  попытка 3 — `cmd.exe /d /c start "" /min powershell … -File …` с полным env.

`electron/serverSelfUpdate.ts` (`helperScript`): первая строка помощника, не зависящая от `RAIDOS_*`, дописывает в
`%TEMP%\raidos-helper-start.log` время, pid и значения `RAIDOS_ID` и `RAIDOS_LOG`. Если файл появился с пустыми
значениями — подтверждена гипотеза 1; если файла нет — скрипт вообще не исполняется (гипотезы 2–3).

## 7. Что нужно сделать (план починки)

1. Установить на ноутбук сборку с диагностикой (вручную, через `Server-Laptop-Setup.cmd`), дождаться попытки
   обновления и прочитать: `update-helper.log` (строки `probe:` и `attempt …`) и `%TEMP%\raidos-helper-start.log`.
2. По результату:
   - **exit 8 / пустые значения в raidos-helper-start.log** (env не доходит): передавать параметры помощнику **не через
     env**, а через файл — приложение пишет `plan.json` рядом с `update-helper.ps1`, помощник получает только путь к
     нему аргументом (`-File update-helper.ps1 -PlanFile "...\plan.json"` + `param($PlanFile)`) и читает
     `Get-Content -Raw | ConvertFrom-Json`. Это надёжнее любой схемы с env.
   - **CLM** (`$ExecutionContext.SessionState.LanguageMode` ≠ `FullLanguage`): переписать помощник без .NET-вызовов
     (`Add-Content`/`Set-Content -Encoding UTF8`, `Invoke-WebRequest`, `Start-Process`, `Move-Item`) или сделать
     помощник не на PowerShell (см. ниже).
   - **Процесс убивают / скрипт не исполняется**: заменить PowerShell-помощник на **.cmd + отдельный маленький exe**
     или запустить помощника самим Electron-exe в режиме Node (`ELECTRON_RUN_AS_NODE=1`) из **копии** exe вне
     `%TEMP%` (portable-обёртка удаляет `%TEMP%\nsXXXX.tmp` при выходе — копировать нужно весь каталог `app`, либо
     использовать уже скачанный новый exe). Внимание: в `package.json` (electronFuses) стоит `"runAsNode": false`, то
     есть этот путь сейчас закрыт; включать фьюз обратно нельзя без пересмотра защиты подписки
     (`docs/subscription-protection.md`). Безопаснее — специальный аргумент запуска приложения
     (`--update-helper <plan.json>`), при котором exe работает как помощник без окна.
3. Не ломать безопасность: помощник ставит только сборку, прошедшую проверку подписи; отменённый перезапуск
   (нет `state.json` с тем же id) ничего не меняет; откат при неуспешном health-check сохраняется.
4. Не трогать системные настройки Windows (планировщик задач, службы, реестр, политики) без явного согласия владельца.

## 8. Как протестировать

### На ноутбуке, без обновления (безопасно)

T1. PowerShell из «Выполнить» (Win+R), окно остаётся открытым:

```bat
cmd /k powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "Set-Content $env:TEMP\raidos-ps-test.txt ok" & type %TEMP%\raidos-ps-test.txt
```

Ожидается `ok`.

T2. Режим языка PowerShell (в окне PowerShell):

```powershell
$ExecutionContext.SessionState.LanguageMode
```

Ожидается `FullLanguage`.

T3. Сам помощник на Windows PowerShell 5.1 вручную, с переменными, но **без** `state.json` — он запишет журнал и
выйдет, ничего не меняя (в cmd, открытом через Win+R → `cmd`):

```bat
set RAIDOS_ID=test1
set RAIDOS_LOG=%TEMP%\raidos-helper-test.log
set RAIDOS_HELPER_PID=%TEMP%\raidos-helper-test.pid
set RAIDOS_PENDING=%TEMP%\raidos-no-such-state.json
powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%APPDATA%\Tarkov Operator\server\self-update\update-helper.ps1"
type %TEMP%\raidos-helper-test.log
type %TEMP%\raidos-helper-test.pid
```

Ожидается: строки `[helper] started: …` и `state.json no longer has this restart: the app cancelled it, nothing is
changed`, а также `{"id":"test1","pid":…}`. Если это работает вручную, а из приложения нет — проблема в способе
запуска (env, родительский процесс), а не в скрипте.

### После починки — полный цикл

1. Поставить исправленную сборку вручную (`Server-Laptop-Setup.cmd` в новой пустой папке).
2. Опубликовать в репозиторий релизов сборку с бо́льшим номером build (`scripts/publish-release.sh`).
3. В приложении на ноутбуке: «Автообновление сервера» → «Проверить сейчас» → дождаться «скачано и проверено» →
   «Установить сейчас» (или режим «сразу»).
4. Ожидается в `update-helper.log`: `probe: … exit 7`, `attempt "direct": the helper runs`, затем строки `[helper]`:
   ожидание выхода приложения, подмена exe, запуск, `result: ok`. В админке: «Установлена» = новый build, в истории
   «успешно».
5. Отказоустойчивость: опубликовать заведомо «плохую» сборку (например, падающую при старте) — должен сработать откат
   на предыдущую за ~2 минуты, история «откачено», сервер снова отвечает.
6. Автотесты: `npm test` (в т.ч. `electron/selfUpdate.test.ts`, `electron/serverSelfUpdate.test.ts`), `npm run typecheck`,
   `npm run lint`.

## 9. Ключевые файлы

- `electron/selfUpdate.ts` — `handOver`, `probe`, `launchAndWait`, `waitForHelper`, состояние в `self-update\`.
- `electron/serverSelfUpdate.ts` — `helperScript()` (PowerShell-помощник), `launcherScript()`, `helperEnvironment()`,
  `HEALTH_RULES`, `HEALTH_REASON_TEXT`, класс проверки/скачивания релиза.
- `electron/serverUpdateManifest.ts`, `electron/updateSigningKey.ts` — подпись релиза.
- `scripts/split-exe-for-chat.sh`, `scripts/publish-release.sh` — сборка частей и публикация релиза.
- `docs/laptop-server.md` — раздел «Автообновление сервера».

Секреты (ключ подписи, токены GitHub) в этом документе не приводятся и в чат передаваться не должны.
