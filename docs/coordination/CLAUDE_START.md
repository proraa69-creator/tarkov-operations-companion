# Начальный запрос для Claude

Работаем вместе с Codex над Raid OS. Прочитай `docs/coordination/PROJECT_STATE.md`, `WORK_QUEUE.md`, `COORDINATION.md` и `source-manifest.json` из ветки `sync/codex-claude-context` репозитория `proraa69-creator/tarkov-operations-companion`. Если тебе передан ZIP, документы лежат в его папке snapshot.

Перед изменениями подтверди: продукт Raid OS, baseline `ec0af4fdf3390fe3789a2c6e8af630ea7011240d`, published client build `1791457737377`, Windows download `/download/windows`. Проверь `LATEST.json`: если есть более новый снимок, используй его вместо чисел из этого начального сообщения.

Не начинай со старого main или старой локальной папки: действующий код был изменён на VPS вне коммита. В shared branch эти изменения сохранены отдельным snapshot commit. Архив source-overlay восстановит их поверх точного baseline в чистой копии.

Первая задача: независимо проверить актуальность контекста и выбрать одну P0 задачу из WORK_QUEUE. Запиши в work log свои ownedFiles и branch до редактирования. Особый интерес: story OCR/current objectives и задержка <=10 секунд без ошибочного перескакивания. Codex ведёт native updater/интеграцию/релизы; не меняй одновременно его файлы и не деплой на VPS параллельно.

После работы дай короткий structured handoff: commit/base, changed files, что исправлено, тесты и реальный результат, что не проверено, remaining risks, просьба к Codex на review. Коммит и сообщение сохрани в репозитории, чтобы Codex смог их прочитать при следующем поручении владельца.

Не выдавай подписки, не включай платежи, не перезапускай 15-минутный deploy-agent, не публикуй новый Overview UI без решения владельца. Не трогай live database, .env, секреты и ключи. Старые пароли из чата в этом пакете отсутствуют и не нужны.

Сохраняй различие: implemented/published, tests passed, native EFT verified, pending. Не обещай «всё работает», если есть только mock IPC/unit-тесты.

# Обновление 08.10.2026: автономные выпуски

Правки Claude cc1506f уже выпущены. Client build 1791472046174, Actions run 37796500169; API и база здоровы. Для следующих выпусков читать AUTOMATIC_RELEASES.md: готовый код переносится в release/production, после успешного exact-SHA GitHub gate VPS собирает и публикует Windows/site/API сам. Общая ветка sync/codex-claude-context не является триггером деплоя. Root SSH не нужен и не передаётся. Native EFT/Windows и <=10 секунд не подтверждены.
