# Выпуск правок Claude от 08.10.2026 (сюжетный OCR, «Кочевники», тема «Олива»)

Для интегратора (Codex) на VPS. Claude из cloud до сервера не достаёт: SSH и HTTPS к 129.101.117.231 закрыты прокси.
Поэтому выпуск делает тот, у кого есть SSH владельца. Используются ТОЛЬКО существующие скрипты из этой папки.
Секреты, `.env`, ключи, платежи и подписки не меняются. Базу никто не перезаписывает; единственное изменение схемы —
API при старте один раз добавляет в `goon_sightings` пустую колонку `nickname`, существующие строки не трогаются.
Перед этим шаг 5 делает бэкап `VACUUM INTO`.

Владелец разрешил выпуск этих правок 08.10.2026. Правку «Legend» со скриншота владелец отменил — она НЕ входит,
тарифы и кабинет не меняются.

- Код: ветка `sync/codex-claude-context` = снимок `de80c83` + коммиты Claude `7b49bc6`, `53de28e`, `2abe1d7`
  (плюс записи work log и этот файл).
- Файлы: `claude-2026-10-08-files.json` — 28 путей. `before` = sha256 в снимке `de80c83` (`null` = новый файл),
  `after` = sha256 после правок.
- Что меняется:
  - API (`server/`);
  - клиент Windows (EXE из `src/`);
  - `docs/mobile.md` — только текст.
- Что не меняется:
  - сайт `website/` не правился и не пересобирается — из `src/` он берёт только звук клика;
  - телефонное приложение (Capacitor) собирается отдельно, на VPS его нет.

## Порядок

```bash
# 0. Исходники ветки в отдельную папку (репозиторий публичный).
git clone --depth 50 --branch sync/codex-claude-context https://github.com/proraa69-creator/tarkov-operations-companion /tmp/claude-src
cd /tmp/claude-src && git log --oneline -1          # ожидается коммит не старше 2abe1d7 с этими правками

# 1. Production не правили после снимка: каждый файл = before (или отсутствует, если before = null). Иначе СТОП.
node -e '
const fs=require("fs"),c=require("crypto"),rows=require("/tmp/claude-src/docs/coordination/ops-reference/claude-2026-10-08-files.json");
let bad=0;for(const r of rows){let h=null;try{h=c.createHash("sha256").update(fs.readFileSync("/opt/tarkov-operations-companion/"+r.file)).digest("hex")}catch{}
if(h!==r.before){bad++;console.log("CHANGED IN PRODUCTION:",r.file)}}
for(const r of rows){const h=c.createHash("sha256").update(fs.readFileSync("/tmp/claude-src/"+r.file)).digest("hex");if(h!==r.after){bad++;console.log("SOURCE MISMATCH:",r.file)}}
console.log(bad?"STOP":"OK");process.exit(bad?1:0)'

# 2. Staging: те же файлы в /opt/raidos-repair-20261008 (staging должен совпадать с production по остальным файлам).
node -e 'console.log(JSON.stringify(require("/tmp/claude-src/docs/coordination/ops-reference/claude-2026-10-08-files.json").map(r=>r.file)))' > /tmp/claude-files.json
node -e 'for(const f of require("/tmp/claude-files.json"))console.log(f)' | while read -r f; do install -D -m 644 "/tmp/claude-src/$f" "/opt/raidos-repair-20261008/$f"; done

# 3. Снимок хэшей production для этих путей (защита от параллельной правки).
PATCH_LIST=/tmp/claude-files.json PATCH_BASELINE=/tmp/claude-baseline.json node deploy-weapon-story.mjs --snapshot

# 4. Проверки и сборка обеих редакций в staging (tsc, server tests, client+owner EXE, подписанный release.json).
REPAIR_RELEASE_SUFFIX=story-goons-olive node build-repair-release.mjs

# 5. Исходники в production: VACUUM INTO-бэкап базы, атомарная замена, restart raidos-api, health, откат при ошибке.
PATCH_LIST=/tmp/claude-files.json PATCH_BASELINE=/tmp/claude-baseline.json node deploy-weapon-story.mjs

# 6. Публикация EXE (подпись, размер/SHA-256, 200 + attachment, 206/MZ, owner EXE приватно, откат при ошибке).
REPAIR_RELEASE_SUFFIX=story-goons-olive node publish-recognition-release.mjs
```

## Проверки после выпуска

- `curl -s https://raidos.app/api/health` → `ok: true, database: true`.
- `curl -s https://raidos.app/v1/goons/pvp` → в ответе есть поле `recent` (новый API «Кочевников»).
- `sqlite3 /var/lib/raidos/companion.sqlite "PRAGMA table_info(goon_sightings)"` → есть колонка `nickname`
  (добавляется самим API при старте, `ALTER TABLE … ADD COLUMN`, существующие строки не меняются).
- `curl -s https://raidos.app/download/version.json` → новый `build`, подпись проверена скриптом шага 6.
- Ручная проверка на ПК владельца: 4 главы (Тур / Небеса в огне / Батя / Борей) из `src/import/__fixtures__/storyPanesPvp.ts`;
  «Кочевники» с двух аккаунтов с никами: у второго обновляется без перезапуска; стартовая тема «Олива» в чистом профиле.

## Совместимость

Анонимные отметки «Кочевников» новый сервер отклоняет (`accepted: false, reason: signin|nickname`). Старый клиент
`1791457737377` на такой отказ покажет «Отметка отправлена», поэтому сервер (шаг 5) и клиент (шаг 6) выпускать вместе.
Вошедший в аккаунт старый клиент с указанным ником отправляет отметки и на новом сервере (токен прикладывается).
