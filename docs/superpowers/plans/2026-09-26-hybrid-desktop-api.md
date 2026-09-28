# Гибрид: desktop + API

Дата: 26 сентября 2026

## Цель этапа

Подготовить application-owned API рядом с Electron-клиентом:

- кэш каталога (квесты, карты, убежище);
- резолв игроков по режимам PvP / PvE / Seasonal;
- контракт, который desktop сможет вызывать вместо прямых запросов к Tarkov.dev.

## Статус

- Desktop: правки UI/квестов/профилей/убежища в этом релизе.
- API scaffold: `server/` с `/health`, `/v1/catalog/:mode`, `/v1/players/resolve`.
- Следующий шаг: переключить Electron gateway на `http://127.0.0.1:8787` (или VPS), сохраняя offline fallback.

## Сервер

См. `server/README.md` — старт с 2 vCPU / 4 GB RAM / 40–80 GB SSD.
