# Общий рабочий лог

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
