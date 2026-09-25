# План реализации: точные карты и синхронизация журналов

Дата: 26 сентября 2026 года  
Основание: `docs/superpowers/specs/2026-09-25-tarkov-accurate-maps-sync-design.md`

## Результат

Новая portable-сборка `Tarkov Operations Companion Beta.exe` на рабочем столе и в `outputs`, где раздел синхронизации показывает desktop-функции, а карты используют реальные координаты Tarkov.dev вместо демонстрационных или сгенерированных маркеров.

## Принципы

- Сначала чинится packaged desktop bridge, потому что без него пользователь не видит автопоиск журналов.
- Демо-координаты удаляются из live-каталога до подключения новых слоёв, чтобы ошибка не маскировалась.
- Обычный лут выключен по умолчанию и подключается отдельными слоями.
- Если у upstream нет координаты, маркер не создаётся.
- Каждый этап завершается проверкой, подходящей его риску.

## Этап 1. Починить desktop bridge в packaged EXE

Файлы:

- `electron/preload.ts`
- `electron/main.ts`
- `tsconfig.electron.json`
- `package.json`
- `src/electron.d.ts`
- `src/pages/ImportProgressPage.tsx`

Работы:

1. Собрать preload в CommonJS `.cjs` или другим надёжным способом, который работает при `"type": "module"`.
2. Указать правильный preload path в `BrowserWindow`.
3. Сохранить `contextIsolation: true` и `nodeIntegration: false`.
4. Проверить, что renderer видит `window.tarkovDesktop`.
5. Убедиться, что в разделе синхронизации видны `Найти прогресс автоматически` и `Выбрать папку Logs вручную`.
6. Проверить, что ручной выбор использует системный folder picker с текстом `Выберите папку Logs`.

Проверка:

- unit-тесты log discovery;
- production build;
- запуск packaged EXE;
- smoke-проверка desktop API.

## Этап 2. Расширить доменную модель карт и слоёв

Файлы:

- `src/domain/types.ts`
- `src/state/AppState.tsx`
- `src/data/demo.ts`
- новые тесты рядом с доменной моделью.

Работы:

1. Добавить marker layer ids: extracts по фракциям, transits, quest zones/items, keys, bosses, hazards, loot-категории.
2. Добавить `floorId`, `heightRange`, `outline`, `source`, `extractFaction` и флаги условий выхода.
3. Задать default visible layers: PMC/Scav/co-op extracts, transits, quest zones, quest items.
4. Задать default hidden loot layers: valuable, weapon/ammo, medical, provision, technical, containers/caches.
5. Мигрировать старые `hiddenMarkerTypes` в новую модель без сброса приложения.

Проверка:

- тест дефолтных слоёв;
- тест, что loot выключен при новом профиле/состоянии.

## Этап 3. Загрузить map rendering config Tarkov.dev

Файлы:

- `src/data/tarkovJsonClient.ts`
- новый `src/data/mapConfigClient.ts`
- новый `src/data/mapProjection.ts`
- тесты адаптеров.

Работы:

1. Получить `maps.json` из Tarkov.dev source или использовать встроенный fallback-снимок.
2. Нормализовать `tilePath`, `bounds`, `transform`, `coordinateRotation`, этажи и zoom.
3. Связать live maps из `json.tarkov.dev` с rendering config по `normalizedName`/id.
4. Удалить live-путь `remapDemoMarkers(...)`.
5. Удалить live fallback на `generatedMarkers(...)`.

Проверка:

- тест на Customs или другой карте: config содержит tile URL, bounds и transform;
- тест запрета demo markers в live-каталоге.

## Этап 4. Построить реальные маркеры из Tarkov.dev

Файлы:

- `src/data/tarkovJsonClient.ts`
- новый `src/data/mapMarkerAdapter.ts`
- `src/data/demo.test.ts`
- новые fixture-тесты.

Работы:

1. Адаптировать extracts в отдельные слои PMC, Scav и co-op.
2. Адаптировать transits.
3. Адаптировать quest objective zones из tasks.
4. Адаптировать quest items, если они опубликованы в endpoint.
5. Адаптировать hazards, bosses, spawns.
6. Адаптировать loose loot и loot containers в выключенные loot-слои.
7. Для `outline` вычислять центр маркера и сохранять polygon.
8. Для `top/bottom` вычислять floor membership.

Проверка:

- fixture-тесты по каждому типу маркера;
- тест, что объект без `position` и `outline` не создаёт маркер;
- тест, что ordinary loot попадает только в выключенные слои.

## Этап 5. Перестроить UI карты

Файлы:

- `src/pages/MapsPage.tsx`
- `src/styles/pages.css`
- возможно `src/components/maps/*`.

Работы:

1. Заменить список старых marker types на слои.
2. Добавить разные иконки, цвета и формы через lucide icons и CSS.
3. Показывать счётчики по слоям активной карты.
4. Фильтровать маркеры по слою, поиску и этажу до рендера.
5. Использовать корректный `bounds` и `TileLayer`.
6. Обновить карточку маркера: extract условия, quest, item, source.
7. Добавить лёгкое объединение плотных маркеров или ограничение рендера для тяжёлых loot-слоёв.

Проверка:

- Playwright: карта открывается, default layers включены, loot выключен;
- Playwright: включение loot-слоя добавляет маркеры;
- Playwright: клик открывает карточку.

## Этап 6. Сборка и приёмка EXE

Файлы:

- `package.json`
- `README.md`, если меняется инструкция запуска;
- `outputs/Tarkov Operations Companion Beta.exe`.

Работы:

1. Прогнать typecheck, lint, unit tests и e2e.
2. Собрать production renderer и Electron.
3. Собрать portable EXE.
4. Скопировать EXE на рабочий стол и в `outputs`.
5. Проверить SHA256 desktop/output копий.
6. Запустить EXE и пройти smoke-сценарий:
   - desktop buttons visible;
   - auto log discovery works or shows clear result;
   - manual Logs folder picker is available;
   - Customs/карта открывается целиком;
   - default map layers are correct;
   - loot is initially off.

## Контрольные коммиты

1. `fix: restore desktop preload bridge in packaged app`
2. `feat: add real Tarkov map layer model`
3. `feat: load Tarkov map configs and project coordinates`
4. `feat: build live Tarkov map markers`
5. `feat: render layered Tarkov maps`
6. `build: ship updated Tarkov companion beta exe`

## Риски

- Tarkov.dev данные могут быть временно недоступны. Решение: кэш и fallback-снимок config.
- Некоторые upstream карты могут быть частично устаревшими. Решение: не придумывать координаты, показывать источник.
- Loot-слой может быть тяжёлым. Решение: выключен по умолчанию, фильтрация до рендера, кластеризация/ограничение.
- Electron packaging на Windows уже давал ошибку переименования. Решение: сначала стандартная сборка, затем использовать проверенный fallback electronDist, если ошибка повторится.
