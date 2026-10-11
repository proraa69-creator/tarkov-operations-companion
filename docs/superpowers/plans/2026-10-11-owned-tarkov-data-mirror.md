# План реализации собственного зеркала данных Tarkov

Спецификация: `docs/superpowers/specs/2026-10-11-owned-tarkov-data-mirror-design.md`

## Этап 1. Хранилище поколений и проверка RaidNVMe

Файлы:

- создать `server/src/services/mirrorStorage.ts`;
- создать `server/src/services/mirrorStorage.test.ts`;
- обновить `server/package.json`.

Шаги:

1. Описать `MirrorManifest`, `MirrorGeneration`, `MirrorState` и безопасные идентификаторы наборов.
2. Реализовать запись только через уникальный `staging/<uuid>`.
3. Проверять размер и SHA-256 записанного файла до публикации.
4. Публиковать поколение одной атомарной заменой `snapshots/active.json`.
5. Сохранять ровно два поколения: `current` и `previous`.
6. Удалять только staging и поколения, которые не указаны в активном манифесте.
7. Реализовать проверку отдельной точки монтирования через `/proc/self/mountinfo`; для тестов принимать инъекцию результата проверки.
8. Проверять минимум 3 ГБ свободного места через `statfs`.

Тесты:

- прерванная запись не меняет `current`;
- новое поколение сдвигает старое в `previous`;
- третье поколение удаляет только самое старое;
- поврежденный manifest отвергается;
- `RAIDOS_MIRROR_REQUIRE_MOUNT=1` запрещает запись без mountpoint;
- обход пути через `../` невозможен;
- `disk-full` не повреждает активный снимок.

Проверка:

```powershell
npm --prefix server test -- --test-name-pattern="mirror storage"
npm --prefix server run typecheck
```

## Этап 2. Суточное зеркало JSON-наборов

Файлы:

- создать `server/src/services/tarkovDataMirror.ts`;
- создать `server/src/services/tarkovDataMirror.test.ts`;
- обновить `server/src/services/dataGateway.ts`;
- обновить `server/src/routes/data.test.ts`;
- обновить `server/package.json`.

Шаги:

1. Задать явный allowlist режимов `regular`, `pve`, `pvp-season` и используемых endpoint.
2. Загружать `items`, `tasks`, `maps`, `traders`, `hideout`, `barters`, `crafts`, `mobs`, `handbook` и `pvp-season/season`.
3. Загружать только поддерживаемые upstream словари `ru` и `en`.
4. Отправлять `If-None-Match` и `If-Modified-Since`; при `304` связывать файл с предыдущим содержимым без повторной передачи.
5. Проверять JSON, режим и минимальные размеры ключевых коллекций; отклонять резкое падение количества записей.
6. Публиковать режимы независимо, но считать суточный проход полностью готовым только после обязательных наборов всех режимов.
7. Запускать первый проход после старта, следующие через 24 часа после успешного завершения; не допускать параллельных запусков.
8. Научить `DataGateway.json()` сначала читать активное поколение и только при отсутствии первичного снимка использовать прежний upstream-путь с сохранением ответа.

Тесты:

- все три режима хранятся раздельно;
- `304` повторно использует проверенный файл;
- пустой `items`, неверный режим и обрезанный JSON не публикуются;
- ошибка одного режима не заменяет его старый снимок;
- при выключенном upstream обслуживается текущий снимок;
- старый gateway fallback работает до завершения bootstrap.

## Этап 3. Минутное зеркало цен трех режимов

Файлы:

- создать `server/src/services/priceMirror.ts`;
- создать `server/src/services/priceMirror.test.ts`;
- обновить `server/src/services/tarkovDataMirror.ts`;
- обновить `server/src/services/dataGateway.ts`.

Шаги:

1. Создать минимальный GraphQL-запрос цен и параметров барахолки для `regular` и `pve` без переводов, изображений, бартеров и крафтов.
2. Для `pvp-season` читать сжатый `items`, извлекать только id, `lastLowPrice`, `avg24hPrice`, `low24hPrice`, запрет барахолки и параметры `fleaMarket`.
3. Хранить `prices/current` и `prices/previous` логически внутри поколений с отдельной атомарной публикацией на режим.
4. Запускать цикл раз в `RAIDOS_PRICE_SYNC_MS`, по умолчанию 60 секунд, только если предыдущий завершился.
5. Реализовать backoff 1/2/5/15 минут для `429`, `5xx` и сети; учитывать `Retry-After`.
6. Считать полученные сжатые/несжатые байты и время ответа.
7. Сохранять историю цены отдельного предмета на диск при первом запросе, не запускать массовый обход истории.

Тесты:

- цены одного id различаются между PvP, PvE и Season;
- сезонный JSON превращается в компактный снимок;
- невалидная цена не заменяет текущую;
- два минутных запуска не перекрываются;
- backoff и `Retry-After` соблюдаются;
- счетчики трафика обновляются;
- история после первого запроса доступна без upstream.

## Этап 4. Изображения и карты на одном диске

Файлы:

- обновить `server/src/services/mapMirror.ts` и тест;
- создать `server/src/services/itemImageMirror.ts` и тест;
- создать `server/src/routes/itemImages.ts` и тест;
- обновить `server/src/routes/mapTiles.ts`;
- перенести общую проверку изображений из `scripts/cache-item-images.mjs` либо использовать единый модуль;
- обновить `server/package.json`.

Шаги:

1. Перенести корень карт в `${RAIDOS_MIRROR_DIR}/maps`, сохранив чтение уже скачанных файлов.
2. Изменить период проверки карт с недели на сутки.
3. Собирать задания на item icon/grid из суточных каталогов всех режимов с дедупликацией по URL.
4. Хранить URL, ETag, Last-Modified, SHA-256, размер и время проверки в image manifest.
5. Не скачивать корректный неизменившийся файл; при ошибке сохранять прежний.
6. Раздавать только имена из manifest через `/v1/item-images/:file`, запретить dotfiles и traversal.
7. Переписывать ссылки каталога на `raidos.app` только после подтверждения файла manifest.

Тесты:

- PNG/JPEG/WebP/SVG проверяются по сигнатуре и лимиту размера;
- неизвестный файл и traversal дают 404;
- поврежденное обновление не удаляет прежнюю картинку;
- существующие карты не скачиваются повторно;
- новый `maps.json` докачивает только новые наборы.

## Этап 5. Статус зеркала и подключение к API

Файлы:

- создать `server/src/routes/dataMirror.ts` и тест;
- обновить `server/src/app.ts`;
- обновить `server/src/index.ts`;
- обновить `server/src/routes/data.ts`;
- обновить `server/src/api.test.ts`;
- обновить `server/package.json`.

Шаги:

1. Создать один экземпляр mirror storage, data mirror, price mirror, map mirror и image mirror в `index.ts`.
2. Передать disk backend в `DataGateway` и роуты.
3. Добавить публичный read-only `GET /v1/data/mirror/status` с `Cache-Control: no-store`.
4. Возвращать mount, свободное место, стадии, свежесть по режимам, размеры, прогресс и счетчики трафика.
5. Не возвращать токены, upstream URL с секретами, абсолютные пути и внутренние stack traces.
6. Сохранить совместимость `/v1/map-tiles/status`.
7. Корректно останавливать таймеры при SIGTERM/SIGINT.

Тесты:

- API стартует без зеркала в тестовом/owner режиме;
- status отражает `running`, `done`, `degraded`, `mount-missing`, `disk-full`, `error`;
- публичный JSON не содержит секретов и путей;
- shutdown останавливает новые циклы.

## Этап 6. Клиент: наше зеркало первым и сезонная экономика

Файлы:

- обновить `src/data/mapMirror.ts` и тест;
- обновить `src/data/mapConfigClient.ts` и тест;
- обновить компоненты Leaflet, использующие `retryTileFromMirror`;
- обновить `src/data/economyApi.ts` и тест;
- обновить `src/data/useEconomy.ts` и тест;
- обновить `src/data/catalogSource.ts` при необходимости;
- обновить связанные тексты Season.

Шаги:

1. Генерировать основную ссылку карты сразу на `/v1/map-tiles`; оставить upstream fallback только внутри серверной синхронизации.
2. Загружать `maps.json` с нашего сервера первым.
3. Удалить `SeasonPricesUnavailable` из пользовательского пути.
4. Для Season собирать `EconomySnapshot` из сезонного каталога цен, бартеров и крафтов.
5. Гарантировать, что query keys содержат режим и сезонный снимок не попадает в PvP/PvE.
6. Сохранить клиентский IndexedDB-кэш как последний локальный уровень отказоустойчивости.

Тесты:

- map URL всегда начинается с выбранного Raid OS server;
- ни один рабочий клиентский запрос карты/картинки не идет напрямую на tarkov.dev;
- Season поддерживается и показывает отличающуюся цену;
- переключение режимов не переиспользует чужой кэш.

## Этап 7. Linux-конфигурация и безопасная миграция

Файлы:

- обновить `deploy/linux/install.sh`;
- обновить `docs/linux-server.md`;
- обновить `docs/subscription-protection.md`;
- обновить `docs/coordination/WORK_LOG.md`.

Шаги:

1. Добавить в создаваемый `raidos.env` `RAIDOS_MIRROR_DIR`, `RAIDOS_MIRROR_REQUIRE_MOUNT` и `RAIDOS_PRICE_SYNC_MS`, не перезаписывая существующие настройки.
2. В `--check` показать `findmnt`, файловую систему, объем, владельца каталога и статус зеркала.
3. Добавить systemd `RequiresMountsFor` и оставить runtime mount-check как обязательную вторую защиту.
4. Подготовить команды безопасного переноса существующего map-mirror через временную точку монтирования и `rsync`; не форматировать и не монтировать неизвестное устройство автоматически.
5. После ручного подтверждения устройства закрепить UUID в `/etc/fstab`, проверить `findmnt --mountpoint`, владельца `raidos:raidos` и запись от пользователя `raidos`.
6. Включить обязательный mount-check только после успешной проверки.

Проверка:

```bash
findmnt --mountpoint /var/lib/raidos/map-mirror
df -h /var/lib/raidos/map-mirror
sudo -u raidos test -w /var/lib/raidos/map-mirror
systemctl restart raidos-api
curl -fsS https://raidos.app/v1/data/mirror/status
```

## Этап 8. Полная проверка и выпуск

1. Выполнить `npm --prefix server test` и `npm --prefix server run typecheck`.
2. Выполнить корневые `npm test`, `npm run typecheck` и сборку.
3. Проверить локальный API с fake-upstream, затем с временным реальным bootstrap без публикации файлов в git.
4. Проверить, что код не содержит новых прямых клиентских обращений к доменам tarkov.dev.
5. Проверить diff и отсутствие ключей, токенов, скачанных баз и изображений в коммите.
6. Выпустить через существующий production pipeline.
7. На VPS проверить mount до включения записи, затем наблюдать bootstrap по status и journal.
8. После `done` проверить JSON каждого режима, различающиеся цены одного предмета, карту, SVG и локальную картинку.
9. Заблокировать upstream на короткий smoke-тест и убедиться, что Raid OS продолжает отдавать текущие снимки.
10. Проверить публичную версию и не удалять предыдущий серверный релиз до завершения smoke-теста.

## Порядок коммитов

1. `Add atomic mirror storage`
2. `Mirror Tarkov datasets and per-mode prices`
3. `Serve mirrored maps and item images`
4. `Use Raid OS data mirror in all game modes`
5. `Configure RaidNVMe mirror deployment`

Каждый коммит должен проходить относящиеся к нему тесты. Загруженные базы, карты и изображения являются runtime-данными и никогда не добавляются в Git.
