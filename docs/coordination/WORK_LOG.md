# Общий рабочий лог

## 2026-10-08: Codex, выпуск по поручению владельца

- Статус: completed; интегратор Codex, исходная ветка cc1506f. Итоговые build/тесты указаны в записи завершения ниже.
- Owned files: release ops-reference scripts, coordination docs/evidence; продуктовый код Claude проходит review без параллельных правок.
- Проверены before/after 28 путей и 765 остальных исходников staging; production пока не изменён.
- Владелец отдельно выбрал автоматические будущие выпуски после тестов. GitHub Actions setup требует доступа к настройкам; старый локальный 15-минутный агент не возвращается.
- Добавляется общий rollback кода и релизов на случай сбоя между рестартом API и публикацией EXE. База не восстанавливается старым снимком поверх новых данных.

## 2026-10-08: Codex, снимок для совместной работы

- Статус: контекст собран, подпись релиза и 104 source hashes проверены; native проверка в EFT ещё не завершена.
- Production baseline: ec0af4fdf3390fe3789a2c6e8af630ea7011240d.
- Published client build: 1791457737377; owner build: 1791457822912.
- Source overlay: 104 изменённых/новых файлов, включая curated данные story, точные hashes в manifest.
- Production код, база и настройки сервера при подготовке пакета не изменялись.
- Новая ветка контекста не является выпуском новой версии приложения.
- Credentials, account data, private keys и environment values не переданы.
- Claude ещё не запущен и не получил активную задачу через подключённый канал.
- Следующая запись агента: цель, base/branch, ownedFiles, статус, test evidence, review request.
- Automation `raidos-context-sync` создана в приложении и ACTIVE: проверяет контекст раз в час, без deploy, без сообщений при отсутствии изменений; первый scheduled run ещё не наблюдался.
- Source snapshot и shared context опубликованы в `sync/codex-claude-context`, commit `ae89f5a3041c6aaa8e77612780884863249a8e24`. GitHub main и VPS baseline не менялись.
- Повторный read-only probe после публикации дал тот же fingerprint: монитор не зацикливается на собственных docs commits.
- Whitespace check для source/docs прошёл; raw tracked-changes.patch исключается из такой проверки, потому что пробельные context lines являются частью формата diff и должны сохраняться.

## 2026-10-08: Claude, P0 «Сюжетный OCR и неправильное опережение целей»

- Статус: in_progress (анализ и тесты; без сборки, без деплоя, без изменений VPS).
- Agent: Claude (cloud). Branch: `claude/vibrant-ritchie-vy7uh2`, fast-forward на общий снимок `de80c831` (поверх baseline `ec0af4fdf3390fe3789a2c6e8af630ea7011240d`).
- Проверка контекста: LATEST.json ветки и ZIP совпадают (fingerprint `92f6c041…`, build `1791457737377`); 104/104 source hashes из `source-manifest.json` совпали с веткой; sha256 `source-overlay.tar.gz` совпал; сверх манифеста в ветке только `CLAUDE.md` (документация).
- ownedFiles: `src/import/storyScan.ts`, `src/import/storyObjectives.ts`, `src/import/storyStageOcr.ts`, `src/components/StoryScreenScanner.tsx` и их тесты (`src/import/storyScan*.test.ts`, `src/import/storyObjectives.test.ts`, `src/import/storyStage*.test.ts`, новые `src/import/storyAdvance*.test.ts`).
- Не трогаю: `electron/*` (OCR capture/updater/native — Codex), `App.tsx`, auth, сборку, релизы, VPS.
- Обновление ownedFiles (новые поручения владельца 08.10.2026: сюжетные квесты по 4 PvP-скриншотам, «Кочевники», стартовая тема): `src/data/storyChapterSeeds.ts` (только ocr-формулировки из игры), `src/domain/types.ts` (поле `hint` у StoryObjectiveReading), `src/components/StoryObjectivesPanel.tsx`, `src/import/__fixtures__/storyPanesPvp.ts`; «Кочевники»: `src/components/GoonCard.tsx`, `src/data/goonTracker.ts`, `server/src/services/goonStore.ts`, `server/src/routes/goons.ts`, `src/i18n/uiEnglishGoons.ts` и их тесты; тема: `src/theme/theme.ts`, `src/i18n/uiEnglishThemes.ts`, `docs/mobile.md`. По-прежнему не трогаю `electron/*`, `App.tsx`, auth, сборку и VPS.
- ownedFiles +: `src/progression/questSections.ts` (+тест) — сюжетная глава видна и без номера этапа, если из игры прочитаны её цели; `src/pages/storyObjectives.css` (подсказка под целью).
- ownedFiles +: `server/src/app.ts` (подключение «Кочевников»: ник из аккаунта, мгновенное оповещение через /v1/map-updates), `src/sync/webAccount.ts` (только 2 маршрута /v1/goons в allowlist веб/телефона + токен для отметки), `src/data/mapUpdates.ts` (событие обновления для карточки «Кочевники»).
- ownedFiles +: `src/platform.test.ts` (только ожидание стартовой темы), `src/components/goonCard.css`, `src/components/GoonCard.test.tsx`.

## 2026-10-08: Claude, handoff (сюжетный OCR, «Кочевники», стартовая тема)

- Статус: **implemented + tests passed**. НЕ опубликовано, НЕ задеплоено, НЕ проверено в нативном EFT. VPS, сборки, релизы, база, секреты не трогались.
- Base: общий снимок `de80c83` (baseline `ec0af4fdf3390fe3789a2c6e8af630ea7011240d`). Branch: `claude/vibrant-ritchie-vy7uh2`.
- Commits: `7b49bc6` (сюжет), `53de28e` («Кочевники»), `2abe1d7` (тема); остальные — записи этого лога.

### Что исправлено

1. Сюжетный OCR (P0 «опережение/перескакивание»), проверено на 4 PvP-экранах владельца (EFT 1.2.0.0.47888; тексты перенесены в `src/import/__fixtures__/storyPanesPvp.ts`):
   - Повторяющиеся цели («Поговорить с Лыжником» — этап 6 и 12 «Тура»; «Построить Солнечную электростанцию» — 24/66/91 «Билета»; «Вернуться к Водителю БТР» ×5 «Борея») всегда читались как первая копия → один кадр откатывал главу назад (12→6, 28→0, 69→15) и вёл на чужую карту. Теперь копия выбирается относительно сохранённого этапа (прогресс не идёт назад); при первом чтении — по опциональным целям; иначе этап не ставится.
   - Короткое название внутри длинного («Узнать больше о жертве» ⊂ «…жертве культистов из пыточной») больше не читается как ранний этап.
   - 186 из 353 целей каталога не начинали строку (глаголы «Добыть», «Забрать», «Ликвидировать»…), «…поручение выполнено» теряло слово как статус. Теперь читаются все 353; серая подсказка под целью хранится отдельно (`hint`) и показывается в панели.
   - Мусор правой панели/версии/нижнего меню больше не приклеивается к цели.
   - Глава берётся из заголовка «ИСТОРИЯ + название» со статусом «АКТИВНО»: активная глава с неизвестной каталогу формулировкой всё равно показывает свои цели (без выдуманного этапа/точки) и видна в «Сюжетных».
   - Каталог (только OCR-алиасы, без новых точек): реальные формулировки «Небеса в огне» №0, «Борей» №2/3, 4 опциональные находки «Бати» → этапы 3/7/9/18 (точки 3/7/9 уже были в каталоге).
2. «Кочевники»: кнопка «Видел»; отметка только от аккаунта с ником для режима, ник берётся сервером из аккаунта (не из запроса), хранится в SQLite (колонка `nickname` добавляется при старте), в ответе `recent` с никами; без входа/ника — понятные сообщения; после отметки сервер поднимает `/v1/map-updates` → все приложения обновляют карточку сразу; телефон/сайт впервые отправляют отметки на сервер (маршруты в web transport); лимиты per account + per address.
3. Стартовая тема: `tarkov` для всех без выбора, название «Олива» (EN Olive).

### Тесты и реальный результат

- `npm run typecheck`: OK. Приложение (vitest): 839/839. Сервер (`npm --prefix server test`): 230/230 (вкл. сквозной тест API: регистрация → ник → отметка → ник в ответе → версия /v1/map-updates выросла).
- Новые: `src/import/storyPanesPvp.test.ts` (24: 4 главы × чистый/шумный OCR, повторы и вложенные названия, весь каталог 353/353), `src/components/GoonCard.test.tsx`, расширены `goonTracker.test.ts`, `goons.test.ts`, `questSections.test.ts`.
- Реальные игровые кадры как файлы недоступны в cloud: Tesseract на настоящих скриншотах НЕ прогонялся (фикстуры — текст со скриншотов + типичные OCR-искажения).

### Не проверено / риски

- Нативный EFT + Tesseract на ПК владельца: распознавание строки «ИСТОРИЯ», порядок колонок, вид чекбоксов. Без заголовка работает только путь с известной формулировкой.
- Задержка ≤10 с не замерена на целевой машине: видимые цели публикуются с первого точного кадра (≤1.2 с опрос + 1 проход OCR), смена этапа — после 2 свежих кадров.
- Ранее сохранённый неверный этап (из старой ошибки, напр. «Тур» 6 вместо 12) вперёд сам не исправляется (строгое правило); цели и ссылки на карту при этом верные.
- Соответствие 4 опциональных находок «Бати» этапам 3/7/9/18 выведено по смыслу RU/EN-текстов каталога — проверить точки в игре. Формулировки других глав тоже могут отличаться от каталога (3 из 4 экранов отличались) — новые скриншоты = новые алиасы.
- Логи EFT по сюжету не изучены на реальных файлах (нет доступа из cloud); tarkov.dev не содержит сюжетных глав; парсер читает только type 10/11/12 + templateId.
- «Кочевники»: анонимные отметки теперь отклоняются. Старый опубликованный клиент при отказе (reason `signin`/`nickname`) покажет «Отметка отправлена» — выпускать сервер и клиент вместе. Проверить, что в production путь `/v1/goons/*` доходит до API (сайт ходит через `/api`).
- `deploy/linux/*` и `scripts/build-linux-server.mjs` (ранняя работа этой ветки) НЕ соответствуют текущему VPS (nginx, `/opt/tarkov-operations-companion`) — не запускать на нём.
- До меня в снимке: vitest подхватывает `scripts/cache-item-images.test.mjs` (node:test; нативно 2/2) — добавить в exclude; lint `stageLooksComplete` (неиспользуемые параметры).

### Просьба к Codex

Review `7b49bc6`, `53de28e`, `2abe1d7`; при интеграции — сервер и клиент одним выпуском; нативная проверка на ПК владельца: 4 главы (Тур/Небеса в огне/Батя/Борей), отметка «Кочевники» с ником с двух аккаунтов, обновление у второго без перезапуска.

## 2026-10-08T13:54:35.948Z: Codex, часовая синхронизация

- Прочитан published handoff Claude из 6616c74; 29 changed files, три code commits ждут review. Авторство указано по Git/log, а не по сообщению из закрытого чата.
- Первый scheduled heartbeat наблюдался. Удалённый probe и новый неизменяемый снимок: 104 hashes и подпись релиза проверены, код VPS/build не изменились.
- Новые результаты тестов Claude сохранены как reported, Codex их не повторял. Review/интеграция/native EFT/<=10 секунд не завершены.
- Owned files: docs/coordination only в общей ветке; локальный пакет, evidence и ZIP. Код Claude не слит, main/production/DB/services не изменялись.

## 2026-10-08: Claude, выпуск на VPS — runbook для Codex

- Статус: **runbook готов, НЕ задеплоено**. Код тот же (`7b49bc6`, `53de28e`, `2abe1d7`); VPS, база, секреты, сборки и релизы Claude не трогал.
- Решение владельца: разрешил обновить приложение на сервере и актуальную версию на сайте. Правку со своего скриншота (убрать «Legend 50 — Premium навсегда» в кабинете) владелец отменил — она НЕ делается и в выпуск не входит.
- Почему не сам: из cloud до 129.101.117.231 не достать (TCP 22 — таймаут, HTTPS через прокси — нет ответа). Выпуск делает тот, у кого SSH владельца, по `docs/coordination/ops-reference/deploy-claude-2026-10-08.md`.
- Runbook построен только на существующих скриптах Codex: `deploy-weapon-story.mjs --snapshot` → `build-repair-release.mjs` (`REPAIR_RELEASE_SUFFIX=story-goons-olive`) → `deploy-weapon-story.mjs` → `publish-recognition-release.mjs`.
- Манифест `claude-2026-10-08-files.json`: 28 путей, `before` = sha256 в `de80c83`, `after` = sha256 в этой ветке. Шаг 1 останавливает выпуск, если production разошёлся со снимком.
- Проверено локально на копии дерева (не на VPS):
  - шаг 1: OK на чистом снимке; STOP с именем файла, если файл в production правили;
  - шаги 2–3: staging совпадает с `after`, baseline реального `deploy-weapon-story.mjs --snapshot` (с заменёнными путями) совпадает с `before`.
- Только на VPS: шаги 4–6 (tsc/тесты/EXE/подпись, `systemctl restart raidos-api`, публикация `/download/windows`).
- Снят риск из handoff: по `nginx-raidos-reference.conf` путь `/v1/` проксируется на API `127.0.0.1:8787`, значит `/v1/goons/*` и `/v1/map-updates` из клиента доходят. Post-check runbook проверяет это на живом сервере.
- Ветка: `claude/vibrant-ritchie-vy7uh2`, fast-forward в `sync/codex-claude-context`; разрешение владельца: «разрешаю».
- Слита часовая синхронизация Codex `4100af3` (только docs/coordination; хэши production те же, что в `de80c83`, поэтому манифест `before` остаётся верным).
- Тесты на `cb817ea` (cloud, не нативный EFT):
  - `npm run typecheck`: OK;
  - `npx vitest run --exclude '.claude/**'`: 865/865 тестов, 157 из 158 файлов. Не собирается только `scripts/cache-item-images.test.mjs` — это node:test-файл, так было и до правок; `node --test` даёт 2/2;
  - сервер `npm test`: 230/230.
  - Прежнее «839/839» в handoff было на другом наборе папок. Актуальны эти числа. `.claude/**` исключён: это локальные копии других сессий, в репозитории их нет.

### Ответ на замечание Codex: сохранённый ошибочный высокий этап

Замечание: правило «не назад» не должно закреплять ошибочно высокий этап (владелец видел 10 вместо 1).

Новый тест в `src/import/storyPanesPvp.test.ts` берёт 4 экрана владельца и прогоняет каждый сохранённый этап выше показанного. Результат — всегда этап с экрана:
- «Батя»: сохранено 2…37 → 1;
- «Небеса в огне»: 1…19 → 0;
- «Борей»: 3…76 → 2;
- «Тур»: 13…21 → 12.

Уникальная цель на экране всегда опускает этап. Правило «не назад» работает только между копиями одной повторяющейся цели.

Осталось без изменений (на решение review):
- Этап ниже показанного сам вперёд не поднимается. Нужны выполненные этапы или соседний шаг, подтверждённый двумя кадрами:
  - «Тур»: 0…4 и 6…10 не меняются, 5 → 6 (первая копия «Поговорить с Лыжником»), 11 → 12;
  - «Борей»: 0 не меняется, 1 → 2.
- Где завышенный этап может остаться: на экране повторяющаяся цель, а игрок на её более ранней копии.
  - Выбирается первая копия не раньше сохранённого этапа, или последняя, если сохранённый этап дальше всех копий.
  - Пример «Тур», копии 6 и 12, игрок на 6: сохранено 7…10 — этап не меняется; сохранено 13 и дальше — 12.
  - Этап держится, пока на экране не появится уникальная цель.
  - Без выполненных этапов или другой улики копии не различить.

## 2026-10-08T15:18:55.156Z: Codex, выпуск завершён

- Claude source cc1506f reviewed/released; final signed build 1791472046174, label 254f2898c0a8ec1a121db04f77d4fe963493eda7-production. Owner 1791472137832.
- Gate run 37796500169; full VPS smoke passed; timer enabled. Release branch 254f2898c0a8ec1a121db04f77d4fe963493eda7. No GitHub secrets and no extra SSH access.
- Checks: frontend 865/865, server 230/230, root/electron/server typecheck, cache node:test 2+1, release policy 6/6 (initial CI 5/5, follow-up artifact guard separately), signed metadata/direct HEAD/206 MZ, health/database, nickname column. Source hashes/archive signature verified separately in snapshot.
- Backups preserved; no DB replacement. Native EFT and Windows updater installation remain unverified. Mobile not shipped.

## 2026-10-08: Claude, переход на автоматические выпуски

- Прочитаны `AUTOMATIC_RELEASES.md`, `CLAUDE_START.md`, `.github/workflows/production.yml`, `ops-reference/release-policy.mjs`, `evidence/release-20261008.json`.
- Подтверждено по Git: `release/production` (`af8a900`) содержит `cc1506f`. Выпуск по evidence: client `1791472046174`, owner `1791472137832`, gate `37796500169`.
- `ops-reference/deploy-claude-2026-10-08.md` помечен как выполненный и устаревший (только история).
- Порядок выпусков Claude дальше:
  - готовые изменения переносятся в `release/production` обычным merge, чужие коммиты не перетираются;
  - перед push — локально те же проверки, что в gate;
  - выпуск только после зелёного `RaidOS Production Gate`.
  - `sync/codex-claude-context` — только обмен контекстом, не триггер.
  - Не отправлять в `release/production` правки workflow, release-скриптов и пути, которых нет в `release-policy.mjs`.
- Без изменений кода; `release/production` не трогал. Pending по-прежнему: нативный EFT, задержка ≤10 с, живой UI с двух аккаунтов, автоустановка Windows, мобильная сборка.

## 2026-10-08: Claude, поручения владельца 08.10 вечер (сюжет, карта, предметы, «Обзор», счётчики)

- Статус: in_progress. Branch: `claude/vibrant-ritchie-vy7uh2` (от `6323332`); выпуск — через `release/production` после зелёного gate.
- Поручения: сюжетные задачи без мусора («= [1]», «№8») и с настоящим счётчиком (1/3, а не 1/5); автосинхронизация глав при листании в игре; галочки-заметки у текущих задач на карте со сбросом при входе в следующий рейд; этаж по высоте из скриншота и автопереключение мини-карты; поиск предметов с длинными названиями и запасной поиск по картинке; «Обзор» (сворачиваемые «Текущие задания», блок «Требования рейда», «Любая пачка патронов 7.62x51» для «Сорвать сделку», заметный бейдж карты); неверные счётчики («Капа 3 из 13», Егерь 11 вместо 2); варианты против накрутки рефералов (только предложение, без изменений).
- Причина сбоя сюжета, воспроизведена настоящим Tesseract (rus+eng, PSM 6) на кадре владельца 1920×1080: весь экран одним проходом даёт «= [1] Поговорить с Лыжником», «[С] Посетить Лес №8 1/5», заголовок «“yp» вместо «Тур», без «АКТИВНО». Те же части экрана по отдельности: «Typ», «АКТИВНО», «1/3».
- ownedFiles (сюжет): `src/import/storyPaneLayout.ts` (новый), `electron/screenOcr.ts` (только чтение сюжетной панели: `captureQuestFrame`/`captureQuestScreenshot`; подсказки предметов и склад — отдельной записью), `electron/preload.ts`, `electron/preload.cjs`, `src/electron.d.ts` (тип кадра), `src/components/StoryScreenScanner.tsx`, `src/import/storyScan.ts`, `src/import/storyObjectives.ts`, `src/import/questOcr.ts`, их тесты и `src/import/__fixtures__/*`.
- Остальные файлы допишу сюда до их правки. Не трогаю: updater/selfUpdate, workflow и release-скрипты, сервер платежей.
- ownedFiles + (счётчики «Капа»/Егерь): `src/progression/requirementEngine.ts` (+тест), `src/import/screenScanSync.ts` (только запасная цепочка требований), `src/components/TraderQuestBoard.tsx` (счётчик «Выполнено»). Причина «Егерь 11 вместо 2»: у квестов tarkov.dev с пустыми требованиями (296 из 515 в снимке) вывод «выполнено по цепочке» брал «предыдущий квест» из русской вики; активный «Всей этой швали...» (у tarkov.dev требований нет) тянул вики-цепочку Егеря. Теперь список требований tarkov.dev окончательный, вики — только для квестов, которых в tarkov.dev нет.
- ownedFiles + (поиск предметов): `src/overlay/tooltipMatch.ts` (+тест).
- Решение владельца по рефералам (08.10, 23:56): вариант А — 7 дней через 14 дней, любой возврат (полный или частичный) отменяет награду и бонус ранга, которого больше не хватает; привязка аккаунта EFT из логов, один аккаунт игры — к одному аккаунту Raid OS («этот аккаунт уже используется»); убрать «Оплата временно недоступна» везде (кнопки оплаты остаются выключенными).
- ownedFiles + (рефералы/EFT): `server/src/services/invites.ts` (+тест), `server/src/services/accountStore.ts` (таблица `eft_accounts`, привязка, вид аккаунта, удаление), `server/src/services/paymentStore.ts` (частичный возврат → слушатели), `server/src/routes/accounts.ts` (`POST /me/eft-account`), новый `src/account/eftAccountBinding.ts` и уведомление, `src/app/AppShell.tsx` (вызов после чтения логов), `website/src/pages/CabinetPage.tsx`, `website/src/components/InviteFriendsPanel.tsx`, `website/src/components/inviteProgram.ts`, `website/src/components/admin/AdminInvites.tsx`, `website/src/legal/documents.ts` (оферта §9 и политика: хеш AccountId).
- Влито в `claude/vibrant-ritchie-vy7uh2` (implemented + unit tests; в игре не проверено):
  - `6a45784`, `2bb4ad6`, `81fea1e` — сюжетная панель читается по частям (название, статус, задачи), мусор «= [1]», «№8» убран, знаменатель-двойник исправляется по каталогу, сохранённые задачи чистятся при показе. Проверено на настоящем Tesseract по кадру владельца («Тур»).
  - `93c11b8` — требования tarkov.dev окончательные (без вики-цепочек), «Выполнено» у торговца без проваленных.
  - `fa66f8a` (+merge `2b0e4b3`) — галочки «Сделал в этом рейде» в «Квестах на карте», сброс при начале следующего рейда (локация в логе или 5 мин), файлы `src/progression/questChecks.ts`, `src/components/QuestRaidCheck.tsx`, `QuestChecksRaidReset.tsx`, `MapsPage.tsx`, `App.tsx`, `AppState.tsx`.
  - `d21d213` (+merge `e85979b`) — этаж по высоте скриншота (`playerFloor`, `useAutoFloor`, `MapFloorLayers`), кнопки этажей в мини-карте.
  - `6910a31` (+merge `6b5329b`) — мини-карта помнит вид по карте; кнопка квеста перебирает «комнаты» точек (12 м / 2,5 м), затем вся карта; кнопка «Снять выбор задания».
  - `9c07717`, `093da9e` — привязка аккаунта EFT (`POST /v1/accounts/me/eft-account`, `eft_accounts`, `invite_eft_counted`), вариант А, «Ожидает привязку», тексты оферты/политики (версия 2026-10-08.2), без «Оплата временно недоступна».
- Тесты на этой голове: приложение (vitest без `.claude/**`) — затронутые папки зелёные; сервер 232/232; сайт собирается.
- Риски: распознавание сюжета и предметов не проверено в нативной игре; привязка EFT защищает от массовых аккаунтов, но не от подделанного запроса; частичный возврат отменяет награду, но дни друга владелец правит вручную; возвраты Lava.top и chargeback по-прежнему не приходят автоматически («Отметить возврат» у владельца работает).

## 2026-10-08T16:26:29.079Z: Codex, часовая синхронизация

- Обнаружен новый Claude head `a1269a0`: только декларация новой работы и историческая отметка старого runbook; продуктовый код после выпуска пока не менялся.
- Новый read-only production snapshot: fingerprint `3cc018401995c3c17f5a03d0db595f6ba346c8518895898b37a96b63f55b3613`, 121/121 source hashes и подпись build `1791472046174` проверены; API/database healthy.
- `release/production` = `af8a900`, Actions run `37799484458` success. VPS gate принял docs/release-script-only commit без новой публикации: published source остаётся `254f289`, build не изменился, failure отсутствует.
- Claude task остаётся `in_progress`; review, тестовый handoff и выпуск новых вечерних правок отсутствуют. Native EFT/<=10 секунд/Windows auto-install остаются pending.
- Секреты, база, аккаунты, подписки, платежи и службы этим монитором не менялись.

## 2026-10-08T17:31:36.845Z: Codex, часовая синхронизация

- Claude branch advanced from `a1269a0` to `eced738` with 16 commits and substantial product-code changes (80 files). The branch log still marks the evening task `in_progress`; there is no reviewed release handoff yet.
- Captured a new read-only production snapshot: fingerprint `37ce9a22415bcf5a7d28caacf7f4bdb9edc1e11a818331a504c1f0d3c4bc8cdb`, 121/121 source hashes and signed build `1791472046174` verified; API/database and raidos-api are healthy.
- `main` remains `c6500a2`, `release/production` remains `af8a900`, and the public build remains `254f289...-production`. No production code, service, database, account or scheduler was changed.
- Claude-reported checks are recorded as reported only: affected frontend tests green, server `232/232`, website build. Independent review, complete test run and native EFT/Tesseract verification remain pending.

## 2026-10-08T18:27:13.092Z: Codex, часовая синхронизация

- Claude branch advanced from `eced738` to `822a44a` with two additional unpublished Overview commits (`ec67577`, `822a44a`): Kappa task dialog and a scrollable full-width map-priority strip.
- New read-only production snapshot verified: fingerprint `e5d2e504d85d502c233656440f51c04a7dbebd2c757cd7fa8f26da90bf253bf9`, 121 source hashes, signed build `1791472046174`, API/database healthy.
- `main`, `release/production` and the public build are unchanged. No deployment, database, service, account, payment or scheduler changes were made.

## 2026-10-08: Claude, выпуск вечерних правок (`cb617c9`)

- Влито дальше (08.10, поздний вечер; implemented + unit tests, в игре не проверено):
  - `ec67577`, `822a44a` — «Обзор»: на карточке «Задания для Капы» кнопка «Квесты» открывает окно с условиями Скупщика (лояльность 4, репутация +3,0) и 4 ключевыми заданиями по `normalizedName` (Реагент 4 или «Большой заказчик»/«Простое любопытство», Стрелок от бога, Тарковский стрелок 4, Шить — не тужить 4); счётчик «N из 4» и на странице «Задания»; «Приоритет карт» — тонкая полоса во всю ширину под карточками, все карты, колесо мыши листает вбок. `kappaBreakdown.ts` удалён, новый `collectorKeyTasks.ts`.
  - `2cb8b88`, этот коммит — сайт под проверку Robokassa: кнопка «Подписка» в шапке (окно: что входит, цены, оплата/доступ/возврат; «Оформить подписку» → кабинет или регистрация); `/legal` = «Тарифы, оплата и возврат» (услуга, цены, заказ, оплата Robokassa, получение доступа, пошаговый возврат без удержания комиссий, контакты raidosapp@gmail.com и Telegram @shauuuurma, ФИО и ИНН); оферта/политика/согласие без черновиков и [заготовок], Robokassa вместо ЮKassa/Lava.top, разовые платежи; `LEGAL_VERSION` 2026-10-08.3 на сайте и в приложении. Серверный код оплаты не менялся, кнопки «Оплатить» в кабинете по-прежнему выключены.
  - `def8fab`, `ba16aaf` — поиск предметов (агент): длинные названия снова находятся (лишняя/потерянная цифра — штраф, а не отказ), второй заход: повторный OCR и сравнение картинки под курсором с иконками кандидатов, запоминание; скачивание иконок только с assets.tarkov.dev и raidos.app.
- Локальный gate на `ba16aaf`+: typecheck, electron tsc, vitest 175 файлов / 1005 тестов, cache node:test 2/2, server typecheck и 232/232, сборка сайта, release-policy 6/6; все 127 путей проходят `deployPath`.
- Владелец (08.10): уведомления в Роскомнадзор (оператор ПД и трансграничная передача Resend, США) не поданы — тексты этого не утверждают; сервер Timeweb Cloud в России. Автосписание: включать, только если Robokassa одобрит рекуррентные платежи для самозанятого — тогда отдельная галочка согласия (376-ФЗ), раздел оферты и серверная интеграция.
- Риски: интеграции Robokassa на сервере ещё нет; распознавание предметов по картинке откалибровано только на синтетике.
- Выпуск: `release/production` перемотан `af8a900` → `cb617c9` обычным fast-forward; RaidOS Production Gate run `37826769579` — success. Публикацию собирает VPS сам; живой сайт из среды Claude недоступен (403 прокси), проверку raidos.app делает владелец.

## 2026-10-08T19:28:22.781Z: Codex, подтверждение автоматического выпуска

- Remote refs now converge at `466c246` for Claude and `release/production`; shared context had already integrated the evening batch at `6069c1b`.
- GitHub Actions exact-SHA run `37828480619` for `466c246` completed successfully. Public signed client advanced to build `1791486430113`, commit label `466c246...-production`, size 203582154.
- New read-only production snapshot verified: fingerprint `ee7fc9e813de4e6eeccb70fc8976d39a74183a35f0329704ad53fcad9a2b419a`, 188/188 source hashes, archive signature, API/database and raidos-api healthy.
- No manual deployment or production mutation was performed by the context monitor. Native EFT/item-image calibration/story latency/Windows auto-install remain unverified.

## 2026-10-08T20:32:46.160Z: Codex, последовательные выпуски и pending gate

- Public production advanced to signed build `1791491244691` from `dde17f6`; exact-SHA gate `37838619993` succeeded. Read-only snapshot verified 224 source files, signature, API/database and active service.
- Included since `466c246`: nickname refresh/rename, removal of visible Tarkov.dev mentions, map/bug-report fixes, guarded backup cleanup, interchangeable raid-requirement grouping and admin payout-tab move.
- Remote Claude/release head is `550e893`, but gate `37839923518` was still `in_progress` at capture. Commits `f219401`/`550e893` are therefore pending, not published evidence.
- Shared source remains at the reviewed/synchronized `466c246` state plus docs; it does not match the larger `dde17f6` production delta. No unreviewed source was merged by this monitor; exact production is preserved in snapshot `2026-10-08T203000Z`.
- Follow-up at 20:35Z: gate `37839923518` for `550e893` completed successfully, while public `version.json` still pointed to `dde17f6`. Publication was therefore still pending at the end of this monitor run.

## 2026-10-09T04:52+07: Codex, iOS IPA pipeline completed

- Owner requested the simplest private iPhone build installed from Windows through Sideloadly. Added `.github/workflows/ios-ipa.yml` without changing the trusted production workflow or using Apple/server secrets.
- `release/production` contains commits `587e8b1` and `1639e8f`; later release merge `acc3fda` retained the workflow and became the first successful artifact source.
- Run `37848814226` succeeded: Ubuntu renderer gate 179/179 files and 1040/1040 tests; macOS 26 unsigned device build succeeded in 2m19s.
- Artifact `Raid-OS-iOS-0.5.4-acc3fda2`, 52.7 MB, artifact id `11581960559`, Actions digest `sha256:20d7f5038a38b412ee14b99f7b106885480cc85d02f1b2df376fda6e6b28a9f4`; retained for 14 days.
- The IPA uses the same release React renderer and `https://raidos.app`. Windows-only EFT log/OCR/hotkey/overlay/update functionality remains desktop-only; synchronized server data is available on iOS.
- Fixed case-insensitive module resolution for Windows/macOS by renaming logic modules to `eftAccountLink.ts` and `raidPlanEngine.ts`; targeted checks passed. Real installation, QR deep link and runtime behavior on the owner's iPhone remain unverified until Sideloadly installation.

## 2026-10-09T09:47+07: Codex, iPhone installation and production CORS repair

- Windows initially exposed the connected iPhone only through Microsoft's `wpdmtp.inf`; Sideloadly showed no device. Installed official Apple Mobile Device Support 14.5.0.7 and `usbaapl64.inf` (`oem47.inf`, Apple driver 6.0.9999.69). Apple Mobile Device Service is running and the pairing record was refreshed.
- Sideloadly detected the iPhone and installed `Raid-OS-iOS-0.5.4-acc3fda2.ipa`; the owner trusted the developer profile on the phone. The IPA embeds `https://raidos.app` as its default server.
- First launch showed «Сервер недоступен». Root cause: production `/etc/raidos/raidos-api.env` allowed only `https://raidos.app`, overriding the source default that already includes Capacitor origins.
- Backed up the environment file, set `WEB_ORIGIN=https://raidos.app,capacitor://localhost,https://localhost`, restarted only `raidos-api`, and verified active service, healthy database, `Access-Control-Allow-Origin: capacitor://localhost` on GET `/v1/accounts/auth-config`, plus a 204 login preflight with POST/content-type allowed.
- No database, account, subscription, payment, nginx, source-code or scheduled-task changes were made. Post-fix successful sign-in on the phone remains unverified until the owner reports the result.

## 2026-10-09T10:36+07: Codex, безопасная очистка диска VPS

- По прямому поручению владельца выполнен штатный `scripts/server-disk-cleanup.sh --clean` на Timeweb VPS. Использование корневого диска снизилось с 81% (9,2 GB свободно) до 54% (22 GB свободно), освобождено около 13 GB.
- Удалены 9 устаревших `auto-release-*`, разовые repair-backup 08.10 и `/opt/raidos-repair-20261008`. Сохранены три последние release-копии; 12 копий базы находятся в `/var/backups/raidos-db`.
- Действующая `/var/lib/raidos/companion.sqlite*`, текущие client/owner EXE, release mirror и item-image cache не удалялись. После очистки сайт и `/api/health` отвечают 200, API сообщает `database: true`, `raidos-api` и `raidos-release.timer` активны.
- Read-only probe после операции: исходники по-прежнему 246 файлов, base `ec0af4f`, signed build `1791498472811` из `f577ef0`, API/database healthy. Новый snapshot исходников не создан: production code/build/refs не изменились; отличие сырого fingerprint вызвано новой версией collector, которая перестала включать `release/production` в `remoteRefs`.

## 2026-10-09T21:10+07: Codex, ЮKassa и автосписание включены

- `release/production` выпущен из `b3c57d5`; Production Gate run `37937170973` завершён успешно (180 test files, 1046 tests). Публичный signed build `1791553060296` соответствует `b3c57d5...-production`; API и база здоровы.
- Robokassa удалена из пользовательского потока. ЮKassa использует ShopID `1481580`, HTTP webhook ранее настроен на `/v1/payments/yookassa/webhook`; секретный API-ключ создан владельцем и установлен только в `/etc/raidos/raidos-api.env`, без публикации в Git или общий контекст.
- В production включены `YOOKASSA_PAYMENT_METHODS=sbp` и `YOOKASSA_AUTOPAY=1` после сообщения владельца об одобрении автосписаний ЮKassa. SberPay и T-Pay кодом поддерживаются, но не включены в env без отдельного подтверждения их активации у провайдера.
- Публичный `/v1/payments/plans` подтверждает YooKassa и autopay enabled, методы `sbp`, тарифы 1/3/6/12 месяцев: 300/900/1500/2400 RUB, скидки 0/0/17/33%. Read-only запрос к API ЮKassa с серверными credentials вернул HTTP 200; реальный платёж и списание не создавались.
- Для приглашения друга или стримера действует скидка 20% только на первый месячный платёж. Автосписание требует отдельной явной галочки пользователя и не выбирается заранее.
- Коррекция после живой проверки: попытка оплаты с сохранением метода получила от ЮKassa `This store can't make recurring payments`; `YOOKASSA_AUTOPAY` возвращён в `0`, чтобы не блокировать разовые платежи. После подтверждения владельцем трёх методов production env обновлён на `sbp,sberbank,tinkoff_bank`; публичный plans API подтверждает все три метода, YooKassa enabled и autopay disabled.
