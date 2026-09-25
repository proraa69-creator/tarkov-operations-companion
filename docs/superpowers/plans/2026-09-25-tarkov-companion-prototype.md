# План реализации Tarkov Operations Companion

Дата: 25 сентября 2026 года  
Основание: `docs/superpowers/specs/2026-09-25-tarkov-companion-prototype-design.md`  
Цель: локальный браузерный прототип, готовый к последующей упаковке в Windows-приложение

## Общий подход

Работа выполняется вертикальными срезами. После каждого среза приложение остаётся запускаемым, тесты проходят, а изменение фиксируется отдельным коммитом. Сначала создаётся стабильная оболочка и слой данных, затем эталонный сценарий Customs, после чего добавляются остальные справочные разделы и офлайн-поведение.

Основной стек:

- React + TypeScript + Vite;
- React Router;
- TanStack Query и сохраняемый кэш;
- Leaflet с `CRS.Simple`;
- Vitest + Testing Library;
- Playwright для сквозных сценариев;
- CSS Modules или обычные модульные CSS-файлы с общими токенами без тяжёлого UI-фреймворка.

## Этап 1. Каркас проекта и контроль качества

### Результат

Локальное приложение запускается, показывает пустую оболочку Field Command и имеет работающие команды проверки.

### Файлы

- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.app.json`
- `index.html`
- `src/main.tsx`
- `src/app/App.tsx`
- `src/app/App.test.tsx`
- `src/test/setup.ts`
- `playwright.config.ts`
- `tests/smoke.spec.ts`
- `README.md`

### Шаги

1. Создать Vite-проект React + TypeScript в корне репозитория.
2. Установить React Router, TanStack Query, Leaflet и типы Leaflet.
3. Подключить Vitest, Testing Library, jsdom и Playwright.
4. Написать падающий тест: приложение показывает название `Tarkov Operations`.
5. Реализовать минимальный `App` и добиться прохождения теста.
6. Добавить скрипты `dev`, `build`, `typecheck`, `test`, `test:e2e`, `lint`.
7. Проверить запуск, сборку, типы и smoke-тест.
8. Коммит: `chore: scaffold Tarkov companion prototype`.

## Этап 2. Дизайн-токены и оболочка командного центра

### Результат

Появляется визуально завершённая адаптивная оболочка с постоянной навигацией и верхней панелью.

### Файлы

- `src/styles/tokens.css`
- `src/styles/global.css`
- `src/app/routes.tsx`
- `src/app/layout/AppShell.tsx`
- `src/app/layout/AppShell.module.css`
- `src/app/layout/Sidebar.tsx`
- `src/app/layout/Topbar.tsx`
- `src/app/layout/AppShell.test.tsx`
- `src/shared/ui/Icon.tsx`
- `src/shared/ui/StatusPill.tsx`
- `src/pages/PlaceholderPage.tsx`

### Шаги

1. Написать тест навигации: присутствуют «Обзор», «Мои задания», «Карты», «Предметы», «Экономика», «Ключи», «Боеприпасы», «Убежище», «Торговцы».
2. Описать цвета Field Command, типографику, интервалы, радиусы, тени и семантические статусы в CSS-переменных.
3. Реализовать боковую навигацию, верхний поиск, PvP/PvE, RU/EN и индикатор свежести данных.
4. Добавить маршруты-заглушки для всех разделов.
5. Добавить сворачивание панели при ширине меньше 1180 пикселей.
6. Проверить клавиатурный фокус и `prefers-reduced-motion`.
7. Коммит: `feat: add Field Command application shell`.

## Этап 3. Доменные модели и демонстрационные данные

### Результат

Все экраны используют единые типизированные сущности. Приложение может работать без сети на небольшом демонстрационном наборе.

### Файлы

- `src/domain/maps.ts`
- `src/domain/quests.ts`
- `src/domain/items.ts`
- `src/domain/economy.ts`
- `src/domain/hideout.ts`
- `src/domain/index.ts`
- `src/data/demo/maps.ts`
- `src/data/demo/quests.ts`
- `src/data/demo/items.ts`
- `src/data/demo/hideout.ts`
- `src/data/demo/relations.ts`
- `src/data/demo/demoData.test.ts`

### Шаги

1. Написать тест целостности: каждый демонстрационный маркер ссылается на существующую карту и связанные сущности.
2. Описать типы `MapLocation`, `MapMarker`, `Quest`, `QuestProgress`, `Item`, `PriceQuote`, `KeyUsage`, `Extraction`, `HideoutStation`.
3. Подготовить компактный согласованный набор Customs: задания, ключи, выходы, предметы и цены.
4. Добавить данные для карточек остальных карт.
5. Проверить отсутствие сломанных связей и дублирующихся идентификаторов.
6. Коммит: `feat: define domain models and demo dataset`.

## Этап 4. Tarkov.dev API, адаптеры и сохраняемый кэш

### Результат

Приложение загружает реальные данные, преобразует их в доменные модели и корректно откатывается к кэшу или демонстрационным данным.

### Файлы

- `src/data/api/graphqlClient.ts`
- `src/data/api/queries.ts`
- `src/data/api/types.ts`
- `src/data/api/adapters/questAdapter.ts`
- `src/data/api/adapters/itemAdapter.ts`
- `src/data/api/adapters/mapAdapter.ts`
- `src/data/api/adapters/hideoutAdapter.ts`
- `src/data/cache/queryPersister.ts`
- `src/data/cache/cacheMeta.ts`
- `src/data/repositories/tarkovRepository.ts`
- `src/data/repositories/tarkovRepository.test.ts`
- `src/app/providers/DataProvider.tsx`

### Шаги

1. Сохранить минимальные реальные ответы API как тестовые фикстуры.
2. Написать падающие тесты адаптеров для отсутствующих полей и разных типов целей задания.
3. Реализовать GraphQL-клиент с таймаутом, отменой запроса и диагностируемыми ошибками.
4. Реализовать адаптеры, которые не пропускают поля API напрямую в интерфейс.
5. Настроить сохраняемый кэш запросов и метаданные времени обновления.
6. Реализовать цепочку `live → cache → demo`.
7. Проверить режимы API недоступен/кэш есть и API недоступен/кэша нет.
8. Коммит: `feat: integrate Tarkov data with offline fallback`.

## Этап 5. Локальное состояние игрока

### Результат

Прогресс заданий, избранное, список подготовки, настройки и слои карт переживают перезагрузку.

### Файлы

- `src/state/userState.ts`
- `src/state/userStateStorage.ts`
- `src/state/userStateMigrations.ts`
- `src/state/userState.test.ts`
- `src/features/settings/SettingsPanel.tsx`
- `src/features/settings/SettingsPanel.test.tsx`

### Шаги

1. Написать тест восстановления состояния и миграции неизвестной старой версии.
2. Реализовать версионированную схему пользовательского состояния.
3. Добавить операции прогресса задания, избранного, списка подготовки и настроек.
4. Не смешивать пользовательское состояние с API-кэшем.
5. Добавить безопасную очистку только пользовательских данных и отдельную очистку кэша.
6. Коммит: `feat: persist local player progress and preferences`.

## Этап 6. Командный центр

### Результат

Главная страница планирует следующий рейд и связывает задачи, карту, ключи, предметы и экономику.

### Файлы

- `src/pages/DashboardPage.tsx`
- `src/pages/DashboardPage.module.css`
- `src/features/dashboard/NextRaidCard.tsx`
- `src/features/dashboard/ActiveQuestList.tsx`
- `src/features/dashboard/LoadoutChecklist.tsx`
- `src/features/dashboard/MarketWatch.tsx`
- `src/features/dashboard/dashboardSelectors.ts`
- `src/features/dashboard/dashboardSelectors.test.ts`
- `src/pages/DashboardPage.test.tsx`

### Шаги

1. Написать тест селектора: для Customs возвращаются связанные активные задания и нужные ключи.
2. Реализовать выбор следующей карты и сохранение выбора.
3. Собрать карточки заданий, подготовки и избранной экономики.
4. Добавить переход «Открыть карту» с параметрами выбранных заданий.
5. Добавить состояния загрузки, кэша и демонстрационных данных.
6. Проверить компоновку на 1024, 1440 и 1920 пикселей.
7. Коммит: `feat: build raid planning command center`.

## Этап 7. Движок интерактивной карты

### Результат

Карта поддерживает масштабирование, перемещение, этажи, категории маркеров и контекстную панель.

### Файлы

- `src/pages/MapsPage.tsx`
- `src/features/maps/MapWorkspace.tsx`
- `src/features/maps/MapWorkspace.module.css`
- `src/features/maps/MapCanvas.tsx`
- `src/features/maps/MapToolbar.tsx`
- `src/features/maps/LayerPanel.tsx`
- `src/features/maps/MarkerLayer.tsx`
- `src/features/maps/MarkerDetails.tsx`
- `src/features/maps/FloorSwitcher.tsx`
- `src/features/maps/mapProjection.ts`
- `src/features/maps/mapProjection.test.ts`
- `src/features/maps/mapFilters.ts`
- `src/features/maps/mapFilters.test.ts`

### Шаги

1. Написать тесты преобразования мировых координат в координаты карты и обратно.
2. Настроить Leaflet `CRS.Simple` и границы карт.
3. Подключить SVG/тайловый слой Customs с обязательной атрибуцией.
4. Реализовать этажи и сохранение выбранного этажа.
5. Реализовать категории маркеров и фильтры.
6. Реализовать выбор маркера и боковую карточку без сброса масштаба.
7. Добавить глубокую ссылку на карту, маркер и набор активных заданий.
8. Коммит: `feat: add interactive map workspace`.

## Этап 8. Эталонная Customs

### Результат

Customs демонстрирует полный продуктовый сценарий: задания, выходы, транзиты, ключи, боссы, спавны, тайники, опасности и ориентиры.

### Файлы

- `src/data/maps/customs/config.ts`
- `src/data/maps/customs/markers.ts`
- `src/data/maps/customs/attribution.ts`
- `src/data/maps/customs/customsData.test.ts`
- `src/features/maps/QuestMarker.tsx`
- `src/features/maps/ExtractionMarker.tsx`
- `src/features/maps/KeyMarker.tsx`
- `src/features/maps/ClusterMarker.tsx`
- `tests/customs-map.spec.ts`

### Шаги

1. Написать тест данных: обязательные типы маркеров присутствуют, координаты находятся в границах карты.
2. Подключить актуальную конфигурацию Customs и слои этажей.
3. Добавить доступные из открытых источников маркеры и связи.
4. Добавить стили и легенду категорий.
5. Реализовать автоматический фокус на маркер по глубокой ссылке.
6. Написать Playwright-сценарий: открыть Customs → включить квесты → выбрать маркер → открыть связанную сущность.
7. Коммит: `feat: complete Customs interactive map slice`.

## Этап 9. Каталог и трекер заданий

### Результат

Пользователь ищет задания, фильтрует их, видит зависимости и отмечает локальный прогресс.

### Файлы

- `src/pages/QuestsPage.tsx`
- `src/pages/QuestDetailsPage.tsx`
- `src/features/quests/QuestFilters.tsx`
- `src/features/quests/QuestList.tsx`
- `src/features/quests/QuestCard.tsx`
- `src/features/quests/QuestObjectives.tsx`
- `src/features/quests/QuestDependencyList.tsx`
- `src/features/quests/QuestProgressControl.tsx`
- `src/features/quests/questSelectors.ts`
- `src/features/quests/questSelectors.test.ts`

### Шаги

1. Написать тесты фильтров и вычисления доступности задания.
2. Реализовать список и фильтры по торговцу, карте, уровню, фракции и Kappa.
3. Реализовать детальную страницу и локальный прогресс.
4. Связать цели с картой, ключами и предметами.
5. Добавить понятное отображение неполных данных.
6. Коммит: `feat: add quest catalog and progress tracking`.

## Этап 10. Предметы, ключи и экономика

### Результат

Пользователь находит предмет, сравнивает цены и переходит между ключом, заданием и местом на карте.

### Файлы

- `src/pages/ItemsPage.tsx`
- `src/pages/ItemDetailsPage.tsx`
- `src/pages/EconomyPage.tsx`
- `src/pages/KeysPage.tsx`
- `src/features/items/ItemSearch.tsx`
- `src/features/items/ItemGrid.tsx`
- `src/features/items/ItemDetails.tsx`
- `src/features/economy/PriceComparison.tsx`
- `src/features/economy/MarketModeToggle.tsx`
- `src/features/economy/bestPrice.ts`
- `src/features/economy/bestPrice.test.ts`
- `src/features/keys/KeyUsageCard.tsx`

### Шаги

1. Написать тест расчёта лучшей цены с отсутствующими и устаревшими предложениями.
2. Реализовать поиск и каталог предметов.
3. Реализовать карточку предмета и переключение PvP/PvE.
4. Реализовать таблицу экономики с источником и временем обновления.
5. Реализовать каталог ключей и переход к карте.
6. Добавить избранное и список подготовки.
7. Коммит: `feat: add item economy and key workflows`.

## Этап 11. Боеприпасы, оружие и броня

### Результат

Справочные таблицы используют единый поиск и реальные характеристики без перегрузки главного сценария.

### Файлы

- `src/pages/AmmoPage.tsx`
- `src/features/ammo/AmmoTable.tsx`
- `src/features/ammo/AmmoFilters.tsx`
- `src/features/items/WeaponStats.tsx`
- `src/features/items/ArmorStats.tsx`
- `src/features/ammo/ammoSelectors.ts`
- `src/features/ammo/ammoSelectors.test.ts`

### Шаги

1. Написать тест сортировки боеприпасов по пробитию, урону и цене.
2. Реализовать компактную таблицу с закреплённым заголовком.
3. Добавить фильтры калибра и режима рынка.
4. Добавить специализированные блоки оружия и брони в карточку предмета.
5. Коммит: `feat: add ammunition weapon and armor reference`.

## Этап 12. Остальные карты

### Результат

Все доступные локации открываются, показывают корректные базовые слои, этажи и доступные маркеры.

### Файлы

- `src/data/maps/index.ts`
- `src/data/maps/*/config.ts`
- `src/data/maps/*/attribution.ts`
- `src/data/maps/mapRegistry.test.ts`
- `src/features/maps/MapSelector.tsx`

### Шаги

1. Написать тест реестра: идентификаторы уникальны, ресурсы и атрибуция указаны.
2. Добавить конфигурации всех поддерживаемых SVG-карт.
3. Подключить этажи и доступные выходы/маркеры из открытых источников.
4. Показывать честный статус для неполного покрытия, не создавая фиктивных данных.
5. Проверить загрузку каждой карты.
6. Коммит: `feat: register remaining Tarkov map layers`.

## Этап 13. Убежище и торговцы

### Результат

Навигация полностью замкнута: станции убежища, основные требования, крафты, бартеры и карточки торговцев доступны из связанных сущностей.

### Файлы

- `src/pages/HideoutPage.tsx`
- `src/pages/TradersPage.tsx`
- `src/features/hideout/StationGrid.tsx`
- `src/features/hideout/StationDetails.tsx`
- `src/features/hideout/RequirementList.tsx`
- `src/features/traders/TraderCard.tsx`
- `src/features/traders/BarterList.tsx`
- `src/features/hideout/hideoutSelectors.test.ts`

### Шаги

1. Написать тест агрегации требований станции.
2. Реализовать список станций и уровней.
3. Реализовать требования, крафты и переходы к предметам.
4. Реализовать торговцев и бартеры.
5. Не добавлять полный калькулятор прибыли на этом этапе.
6. Коммит: `feat: add hideout and trader reference`.

## Этап 14. Глобальный поиск и связанные переходы

### Результат

Поиск одновременно находит задания, предметы, ключи и карты; переходы сохраняют контекст.

### Файлы

- `src/features/search/searchIndex.ts`
- `src/features/search/searchIndex.test.ts`
- `src/features/search/GlobalSearch.tsx`
- `src/features/search/SearchResults.tsx`
- `src/shared/navigation/entityLinks.ts`
- `src/shared/navigation/entityLinks.test.ts`

### Шаги

1. Написать тест нормализации русских/английских названий и частичного совпадения.
2. Создать лёгкий локальный индекс без серверного поиска.
3. Добавить клавиатурную навигацию результатов.
4. Реализовать переходы с параметрами возврата и сохранением положения карты.
5. Коммит: `feat: connect entities with global search`.

## Этап 15. Ошибки, доступность и финальная полировка

### Результат

Прототип устойчив к сбоям, понятен с клавиатуры и визуально соответствует утверждённому направлению.

### Файлы

- `src/shared/errors/AppErrorBoundary.tsx`
- `src/shared/errors/SectionError.tsx`
- `src/shared/ui/EmptyState.tsx`
- `src/shared/ui/Skeleton.tsx`
- `src/shared/ui/OfflineBanner.tsx`
- `src/shared/a11y/LiveRegion.tsx`
- `src/app/App.integration.test.tsx`
- `tests/core-flow.spec.ts`
- `tests/offline.spec.ts`

### Шаги

1. Написать интеграционный тест цепочки `live → cache → demo`.
2. Добавить границы ошибок по разделам.
3. Добавить пустые состояния, повтор запроса и метки свежести.
4. Проверить контраст, фокус, подписи кнопок и управление картой с клавиатуры настолько, насколько позволяет Leaflet.
5. Завершить визуальную полировку Field Command без неонового свечения и декоративной перегрузки.
6. Коммит: `feat: harden offline and accessible experience`.

## Этап 16. Финальная проверка и передача

### Результат

Пользователь получает запускаемый локальный прототип и краткую инструкцию.

### Шаги

1. Выполнить `typecheck`, полный набор тестов и production-сборку.
2. Запустить Playwright-сценарии на Chromium.
3. Вручную проверить размеры 1024×768, 1440×900 и 1920×1080.
4. Проверить отсутствие секретов, закрытых карт и неразрешённых материалов.
5. Проверить наличие атрибуции карт и источников.
6. Обновить `README.md`: установка, запуск, данные, лицензии, ограничения прототипа.
7. Запустить локальный preview и открыть его пользователю.
8. Коммит: `docs: finalize prototype handoff`.

## Порядок демонстрации

Первую осмысленную демонстрацию проводить после этапа 8: оболочка, реальные данные, командный центр и глубокая Customs уже образуют полноценный сквозной сценарий. Этапы 9–15 расширяют покрытие до согласованного объёма.

## Условия остановки

Нужно остановиться и запросить решение пользователя, если:

- открытый источник запрещает выбранное использование или меняет лицензию;
- карта или данные доступны только через закрытый/платный сервис;
- Tarkov.dev меняет схему так, что невозможно сохранить согласованный сценарий без нового источника;
- упаковка в EXE потребуется до завершения оценки браузерного прототипа;
- предлагается чтение памяти игры, внедрение, ESP или другая функциональность, противоречащая безопасному справочнику.

