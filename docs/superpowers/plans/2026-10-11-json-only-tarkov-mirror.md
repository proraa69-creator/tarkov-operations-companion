# План перехода Raid OS на JSON-only зеркало Tarkov

Спецификация: `docs/superpowers/specs/2026-10-11-owned-tarkov-data-mirror-design.md`  
Базовый коммит: `7be54b3`  
Цель: исключить GraphQL tarkov.dev из production, сохранить совместимость установленных клиентов и только после офлайн-проверки включить строгую выдачу данных с RaidNVMe.

## Правила выполнения

- Выполнять этапы по порядку; после каждого этапа запускать указанные тесты и делать отдельный коммит.
- Не добавлять в Git данные RaidNVMe, runtime-манифесты, секреты и содержимое `.tmp-linux-build/`.
- Не включать `RAIDOS_DATA_STRICT=1`, пока не построены все совместимые снимки и не пройден тест с заблокированными upstream-host.
- Не смешивать `regular`, `pve` и `pvp-season`; язык также является частью снимка.
- Пользовательский HTTP-запрос никогда не должен обращаться к tarkov.dev.

## Этап 1. Зафиксировать JSON-контракты и общие адаптеры

Файлы:

- новый `src/data/tarkovJsonAdapters.ts`;
- новый `src/data/tarkovJsonAdapters.test.ts`;
- новые компактные fixtures в `src/test/fixtures/tarkov-json/`;
- `src/arsenal/gunQueries.ts`;
- `src/data/economyApi.ts`.

Работы:

1. Записать минимальные fixtures реальных форм `items`, `traders`, `barters`, `crafts`, `maps` и минутного `prices.json`; убрать персональные и нестабильные поля.
2. Реализовать чистые функции нормализации envelope `data`, словарей и массивов JSON.
3. Реализовать преобразования JSON в прежние формы GraphQL для:
   - оружия, модулей и боеприпасов;
   - торговцев и предложений `buyFor`/`sellFor`;
   - экономики, бартеров и крафтов;
   - боссов из `maps`;
   - истории цен из сохранённого файла.
4. Накладывать минутные цены только после проверки совпадения режима; сезон не должен использовать PvP или PvE.
5. Сохранить существующие публичные типы и функции адаптации клиента; перевести их внутренности на общие JSON-адаптеры без изменения UI-контрактов.

Тесты сначала должны падать, затем проходить:

- каждый адаптер выдаёт существующую форму `Weapon`, `GunPart`, `AmmoStats` и `EconomySnapshot`;
- предложения торговцев, ограничения уровня и задания разбираются корректно;
- минутная цена заменяет только ценовые поля своего режима;
- `regular`, `pve`, `pvp-season`, `ru` и `en` не пересекаются;
- повреждённая или неполная запись пропускается без падения всего набора.

Проверка:

```powershell
npx vitest run src/data/tarkovJsonAdapters.test.ts src/domain/economy.test.ts src/arsenal/ammoSource.test.ts src/arsenal/gunBuilder.test.ts
npm run typecheck
```

Коммит: `Add shared Tarkov JSON adapters`

## Этап 2. Перевести минутные цены на компактный REST

Файлы:

- `server/src/services/priceMirror.ts`;
- `server/src/services/priceMirror.test.ts`;
- `server/src/routes/data.ts`;
- `server/src/routes/data.test.ts`.

Работы:

1. Для `regular` и `pve` сначала загружать `https://api.tarkov.dev/api/v1/<mode>/items`.
2. Для `pvp-season` читать `https://json.tarkov.dev/pvp-season/items`.
3. При ошибке компактного REST для PvP/PvE один раз использовать полный JSON соответствующего режима; GraphQL не вызывать вообще.
4. Расширить `PriceSnapshot.source` значениями `compact-rest` и `json-fallback`; записывать фактический источник, байты и время.
5. Получать настройки барахолки из активного суточного набора своего режима либо сохранять последние корректные значения.
6. Сохранить неперекрывающийся запуск, существующий backoff, атомарную публикацию и `current/previous`.

Тесты:

- PvP/PvE используют компактный REST и не вызывают GraphQL;
- 5xx компактного REST вызывает ровно один JSON fallback;
- Season никогда не обращается к regular endpoint;
- ошибка одного режима не мешает публикации двух других;
- неполный ответ не заменяет активное поколение;
- `GET /v1/data/prices/:mode` возвращает только соответствующий слот.

Проверка:

```powershell
npm --prefix server test
npm --prefix server run typecheck
```

Коммит: `Use compact REST for minute prices`

## Этап 3. Построить совместимые снимки старого GraphQL API локально

Файлы:

- новый `server/src/services/legacyGraphqlRegistry.ts`;
- новый `server/src/services/legacyGraphqlBuilder.ts`;
- новые тесты `server/src/services/legacyGraphqlRegistry.test.ts` и `server/src/services/legacyGraphqlBuilder.test.ts`;
- `server/src/services/dataGateway.ts`;
- `server/src/routes/data.test.ts`;
- удалить `server/src/services/graphqlPrewarm.ts` и его тест после переноса реестра.

Работы:

1. Вынести канонизацию, сортировку переменных и вычисление `graphql-<sha256>` в экспортируемую чистую функцию `graphqlSnapshotKey()`; чтение старых слотов должно остаться совместимым побайтно.
2. Перенести перечень известных запросов из `applicationGraphqlRequests()` в реестр операций. Включить текущие и ещё используемые выпущенными версиями варианты:
   - `RaidOsGuns`, `RaidOsMods`, `RaidOsAmmo`;
   - подробные боеприпасы и торговцев;
   - цены, бартеры и крафты;
   - `RaidOsBosses`;
   - допустимые запросы истории цены.
3. `LegacyGraphqlBuilder` читает только активные `dataset-*`, `prices-*` и `price-history-*`, вызывает общие адаптеры и публикует `response.json` через `MirrorStorage`.
4. Строить снимки для двух языков и всех применимых режимов. Сезонные ответы строить только там, где существует отдельная экономика; не подставлять regular.
5. После суточной публикации данных перестраивать статические совместимые ответы; после минутной публикации цен обновлять только зависящие от цены ответы.
6. При частичном сбое сохранять прежний `current`; в статусе отражать число готовых/ожидаемых/ошибочных снимков и время последнего прохода.
7. `DataGateway` в strict-режиме только читает построенный слот. Неизвестная операция возвращает `503` и не вызывает fetch.

Тесты:

- ключи существующих запросов совпадают с ключами старого `DataGateway`;
- все операции реестра строятся при полностью запрещённом сетевом fetch;
- полученные ответы проходят существующие клиентские адаптеры;
- изменение минутной цены обновляет цену, но не смешивает режимы;
- повреждённый источник не публикует новый снимок;
- неизвестный запрос и cache miss дают `503`, `upstreamInFlight` остаётся нулём;
- повторный проход с тем же содержимым не создаёт лишнее поколение.

Проверка:

```powershell
npm --prefix server test
npm --prefix server run typecheck
```

Коммит: `Build legacy GraphQL snapshots from JSON`

## Этап 4. Добавить отложенную историю цен

Файлы:

- новый `server/src/services/priceHistoryMirror.ts`;
- новый `server/src/services/priceHistoryMirror.test.ts`;
- `server/src/routes/data.ts`;
- `server/src/routes/data.test.ts`;
- `server/src/index.ts`;
- `src/sync/webAccount.ts`.

Работы:

1. Добавить проверяемый маршрут `GET /v1/data/price-history/:mode/:itemId?days=30`.
2. Если история уже сохранена, отдать её с признаком свежести. Если её нет, атомарно записать пару `режим + itemId` в очередь и вернуть пустой массив с `pending: true`.
3. Суточный worker обрабатывает только очередь через JSON endpoint истории конкретного предмета, ограничивает параллелизм, валидирует item id и не удаляет прежнюю корректную историю при ошибке.
4. Хранить историю раздельно по режимам; для неподдерживаемого сезонного endpoint возвращать явное `pending/unavailable`, не данные другого режима.
5. Старый совместимый запрос `historicalItemPrices` строить из того же локального файла и никогда не выполнять синхронный upstream.

Тесты:

- первый запрос только ставит запись в очередь;
- повторные запросы не дублируют запись;
- worker публикует проверенную историю и сохраняет previous;
- HTTP handler не вызывает внешний fetch;
- режимы и некорректные item id изолированы;
- upstream-ошибка оставляет предыдущую историю доступной.

Проверка:

```powershell
npm --prefix server test
npm --prefix server run typecheck
```

Коммит: `Mirror requested price history daily`

## Этап 5. Перевести новые клиенты на JSON-маршруты

Файлы:

- `src/arsenal/gunCatalog.ts` и тесты;
- `src/data/economyApi.ts` и тесты;
- `src/data/bosses.ts` и тесты;
- `src/data/objectiveDetails.ts` и тесты;
- `src/data/tarkovApi.ts` и тесты;
- `src/sync/webAccount.ts`;
- новый `src/data/tarkovDataset.ts` и `src/data/tarkovDataset.test.ts`.

Работы:

1. Добавить один клиентский загрузчик набора, который всегда вызывает `/v1/data/json/<mode>/<name>` через `tarkovJson()` и накладывает `/v1/data/prices/<mode>`.
2. Перевести оружие, модули, патроны, торговцев, экономику и боссов на общие JSON-адаптеры.
3. Перевести график истории на новый серверный маршрут; `pending` отображать как отсутствие накопленной истории, не как отсутствие текущей цены.
4. Сохранить локальный кэш и текущие UI-типы, чтобы миграция не затронула компоненты.
5. Оставить `POST /v1/data/graphql` только для старых установленных клиентов; новый код приложения его не вызывает.
6. Обновить fetch guard: packaged-сборка блокирует прямые `api.tarkov.dev`, `json.tarkov.dev`, `assets.tarkov.dev` и `players.tarkov.dev`; явная локальная разработка сохраняет direct mode.

Тесты:

- новые клиентские потоки не вызывают `tarkovGraphql`;
- PvP/PvE/Season получают отдельные цены;
- приложение работает с полностью отклонёнными запросами ко всем tarkov.dev host;
- старые GraphQL API-тесты сервера продолжают проходить;
- кэш используется при временной недоступности `raidos.app` в пределах текущего TTL.

Проверка:

```powershell
npx vitest run src/data src/arsenal
npm run typecheck
npm run lint
```

Коммит: `Read Tarkov data from Raid OS JSON mirror`

## Этап 6. Подключить lifecycle, статус и поставляемую systemd-конфигурацию

Файлы:

- `server/src/index.ts`;
- `server/src/routes/dataMirror.ts` и тест;
- `server/src/app.ts`;
- `deploy/linux/install.sh`;
- systemd-шаблоны в `deploy/linux/`;
- `docs/linux-server.md`;
- `docs/subscription-protection.md`;
- `server/package.json`.

Работы:

1. Удалить запуск `GraphqlPrewarm`; запускать локальный builder после готовности datasets и prices, а также по расписанию восстановления.
2. Добавить builder и price-history worker в штатные `start/stop`, не допуская перекрывающихся проходов.
3. Расширить `/v1/data/mirror/status`: совместимые снимки, очередь истории, возраст, ошибки, трафик за проход; не раскрывать URL, пути и секреты.
4. Поставлять `RAIDOS_MIRROR_DIR=/var/lib/raidos/map-mirror`, `RAIDOS_MIRROR_REQUIRE_MOUNT=1`, минутный интервал цен и `RequiresMountsFor=/var/lib/raidos/map-mirror`.
5. Включить ежедневный image sync в поставляемые unit/timer, сохранив уже работающие пути RaidNVMe.
6. Добавить CLI-команду bootstrap совместимых снимков и документировать проверку/откат.

Тесты:

- повторный `start()` не создаёт второй timer;
- graceful shutdown останавливает все workers;
- публичный статус не содержит внутренних путей и upstream URL;
- installer check обнаруживает отсутствующий mount и неполные поколения;
- server bundle содержит CLI и systemd-файлы.

Проверка:

```powershell
npm --prefix server test
npm --prefix server run typecheck
npm run build:local-server
```

Коммит: `Operate JSON-only mirror workers`

## Этап 7. Полная локальная проверка и выпуск переходного сервера

Работы:

1. Запустить полный набор проверок:

```powershell
npm --prefix server test
npm --prefix server run typecheck
npm test
npm run typecheck
npm run lint
npm run build
```

2. Выполнить статический поиск прямых production-обращений к внешним данным. Допустимы только URL внутри серверных workers и явного dev-кода:

```powershell
rg -n "api\.tarkov\.dev|json\.tarkov\.dev|assets\.tarkov\.dev|players\.tarkov\.dev" src electron server
```

3. Поднять API с временным mirror root, выполнить bootstrap, затем запретить fake-upstream и проверить:
   - JSON routes;
   - цены трёх режимов;
   - все операции legacy registry;
   - карты и изображения;
   - контролируемый `503` неизвестной операции.
4. Проверить, что `active.json` имеет `current/previous` для datasets, prices и совместимых снимков.
5. Зафиксировать переходный серверный коммит, не включая strict по умолчанию.

Коммит: `Prepare JSON-only mirror rollout`

## Этап 8. Миграция VPS и включение strict

Порядок команд выполняется только после зелёного CI:

1. Проверить `/var/lib/raidos-release/state.json`, текущий commit и отсутствие активной публикации.
2. Проверить RaidNVMe:

```bash
findmnt /var/lib/raidos/map-mirror
df -h /var/lib/raidos/map-mirror
```

3. Создать резервные копии текущих unit/drop-in и `snapshots/active.json`; данные поколений не копировать и не удалять.
4. Дождаться автоматической публикации переходного сервера и проверить journal без GraphQL upstream ошибок.
5. Запустить bootstrap builder; проверить готовность всех обязательных legacy-снимков и наличие `previous`.
6. Проверить публичные routes авторизованным smoke-клиентом, включая PvP/PvE/Season.
7. Временно запретить серверу соединения с `api.tarkov.dev` и `json.tarkov.dev`; повторить пользовательские сценарии и убедиться, что пользовательские запросы не создают исходящий трафик.
8. Добавить `RAIDOS_DATA_STRICT=1`, выполнить `systemctl daemon-reload` и перезапустить `raidos-api`.
9. Повторить health/status/smoke и проверить журналы минимум один минутный и один принудительно запущенный суточный проход.
10. При ошибке убрать strict-флаг, вернуть предыдущую серверную сборку и/или выполнить `mirror:rollback`; не удалять неудачные поколения до диагностики.

## Этап 9. Выпуск нового клиента

1. Повысить версию только после стабильной работы переходного сервера в strict-режиме.
2. Собрать обе Windows-редакции, проверить подписи/хеши и Production Gate.
3. Дождаться автоматической публикации VPS; проверить `sourceCommit`, публичную версию и обновление из установленной предыдущей версии.
4. Проверить основные сценарии с внешними Tarkov-host, заблокированными на тестовой машине.
5. Сохранить предыдущий release и поколения до завершения наблюдения; затем оставить ровно `current/previous` согласно политике хранения.

Коммит: `Release Raid OS with server-owned Tarkov data`

## Критерии готовности

- GraphQL tarkov.dev не вызывается ни одним production worker или клиентом.
- Пользовательские запросы обслуживаются с RaidNVMe при полном отключении upstream.
- Старые клиенты получают известные GraphQL-ответы через `raidos.app`.
- Новые клиенты читают JSON и минутные цены через `raidos.app`.
- PvP, PvE и Season имеют раздельные цены и кэши.
- Суточные данные, карты и изображения обновляются автоматически; цены обновляются раз в минуту.
- Каждая заменяемая группа данных имеет проверенные `current/previous` и рабочий rollback.
- `RAIDOS_DATA_STRICT=1` включён только после офлайн smoke-test.
