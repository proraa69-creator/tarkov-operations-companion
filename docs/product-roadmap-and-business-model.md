# Raid OS — product roadmap, monetization, and server model

This document captures the current product direction discussed with the owner so another AI agent or developer can continue the project without losing context.

## Current project

- Product: Raid OS (renamed from Tarkov Operator / Tarkov APP on 2026-09-30; brand variant E «Чистый», artwork in `build/brand/`).
- Current repository: `https://github.com/proraa69-creator/tarkov-operations-companion`.
- Current app version in `package.json`: `0.5.4`.
- Current technical direction: hybrid desktop client plus server API.
- Desktop client should remain a visual/control shell. Paid catalog logic, subscription checks, protected databases, user entitlement, referral accounting, and expensive shared data processing should move server-side.

## Main product goal

Build a paid Escape from Tarkov companion app with:

- interactive maps;
- current tasks and quest planning;
- raid requirements;
- map priority by available/current quests;
- Flea Market data: items, keys, ammunition, prices;
- trader reference;
- hideout planner;
- PvP, PvE, and Seasonal profile separation;
- automatic refresh from supported sources;
- streamer referral program;
- protected paid server-side data and subscriptions.

The desktop application must not automate gameplay, inject into Escape from Tarkov, bypass anti-cheat, or alter game files. It should only read allowed local files/screenshots/logs and use external public data sources/API where permitted.

## User profiles and Tarkov modes

The app must support three separate Tarkov profile bindings:

- PvP;
- PvE;
- Seasonal.

One nickname for all modes (owner, 10.10.2026: in Escape from Tarkov a character has the same nickname in PvP, PvE
and Seasonal — not three nicknames). It is read from the game logs automatically and fast; there is no manual
nickname input in the app or on the website (owner, 10.10.2026: «ручную привязку везде удали»). Progress stays separate:

1. The desktop app reads the game AccountId of each mode from the EFT logs and gets its Tarkov.dev profile; the nickname
   is the most recently updated profile's name (a mode's Tarkov.dev name can lag behind a rename).
2. Each mode found in the logs is bound to its game account; other bound modes take the same nickname; a mode not in the
   logs is looked up on Tarkov.dev by that nickname.
3. The nickname is saved on the server account; the website cabinet and the phone show it read-only.
4. Switching modes switches the progress, levels and quests of that mode; the nickname does not change.

The app should try to detect the currently selected/played game mode automatically from logs/session data. If the game mode changes from PvP to PvE or Seasonal, the app should switch its active mode accordingly.

Character level must come from trusted profile/account data where possible. The user should not manually edit level because quest availability depends on it.

Refresh target:

- profile/task/log data should update automatically about once per minute while the app is open;
- different modes must stay isolated;
- mixed PvP/PvE/Seasonal logs must not corrupt the wrong mode.

## Quest logic requirements

The current quest logic has been unreliable and must be improved.

Important requirements:

- PvE quests must display correctly and completely.
- Current tasks must be shown as the main quest view.
- The old “Available” tab should be removed or renamed depending on final UX.
- “My tasks” should become “Current tasks” / “Текущие задания”.
- Completed tab can remain as a read-only history.
- One quest-state engine decides every quest per mode (owner, 15.10.2026: «все должно взаимодействовать как одно целое и сравнивать данные»; `docs/quests/quest-state-engine.md`): the game logs are the main truth for trader quests, the Tasks-table screen reading fills gaps in PvE only, story chapters come from the story pane in every mode.
- «Ручная отметка» (owner, 15.10.2026): a switch on the Quests page, off by default, lets the player mark a quest a bug got wrong («В текущие» / «Выполнено» / «Снять отметку»). A mark is tagged «вручную», synced, beats older log events and loses to newer ones, and is cleared by «Престиж +» / «Вайп». There is no other manual quest editing.
- If exact completed quest list cannot be read, infer previous chain completion from later completed/current quests using the Tarkov.dev quest dependency graph — shown as «вероятно выполнено», never counted in «Выполнено» or Kappa (owner, 15.10.2026: 154 in the game, 226 in the app).
- Kappa progress must be calculated correctly from actual Kappa-required tasks, not from incomplete demo/sample data.
- Quest counts must not change when switching interface language.
- «Ивент-квесты» (owner, 16.10.2026: «добавь возможность обновить мне из админ приложения название потом и вообще добавь в админ панели возможность добавлять ивент квесты и редактировать их»): the owner app's quest constructor (Карты → «Редактировать квесты» → «Ивент-квесты») edits the built-in event quests of `src/data/curatedQuests.ts` (an override by the same id, «Вернуть исходный» drops it) and adds new ones (`raidos-event-…`, «Удалить»), with title, series, trader, modes, the event's end, «Скрыть», objectives, rewards and description in RU/EN. Stored on the server (`/v1/accounts/me/admin/event-quests`, public `/v1/event-quests`), shown by every app at once (`src/data/eventQuests.ts`) and built into the server's quest base shortly after (`src/data/eventQuestDefinitions.ts`, one merge for both). A quest leaves the app at its event's end; a tarkov.dev quest of the same title replaces ours.

Current tasks should drive:

- Overview widgets;
- raid plan;
- map priority;
- map quest markers;
- raid requirements;
- required keys/items list.

## Overview page requirements

The Overview page is the primary “what should I do next?” screen.

It should show:

- current tasks count;
- completed quest progress;
- remaining Kappa quest progress;
- current map/next raid plan;
- current tasks for selected map;
- raid requirements;
- map priority;
- Goons/Nomads information where applicable;
- market favorites.

«Админ панель» → «Блоки» (owner, 16.10.2026: «функции редактирования блоков… без надобности загружать обновление сервера»): the owner sets, for every player at once, which Overview blocks show, their default order on the PC and on the phone, and his own block titles (RU / EN; an empty one keeps the standard title). Stored on the server (`/v1/accounts/me/admin/overview-defaults`, public `/v1/overview-defaults`) and delivered with the owner's notice (`GET /v1/announcement` → `overview`), so the apps pick it up within a few minutes without an update. A player's own «Настроить блоки» order wins over the default order; a block the owner hides is hidden for everybody.

In the raid plan block:

- keep buttons: Build route, Tasks, Choose map;
- Choose map should open the map list upward inside the same block, not downward out of the card;
- map selector animation should not push content outside the block;
- remove task count from the large raid-plan map hero area;
- map priority section should be smaller and show readable quest-count bars/scales.

Map naming/filter requirements:

- remove Night Factory from the main selection;
- remove Dark Laboratory;
- keep Labyrinth unless later removed;
- rename “Ground Zero”/“Epicenter” display to “Эпицентр” in Russian and a clean English equivalent in English;
- locked maps should show a lock;
- locked map tooltip should say which story quest unlocks it.

Remove unnecessary small equipment/profile blocks from Overview cards:

- armband;
- headset;
- holster;
- small duplicate nickname/level/hours block inside the map card.

## Operator profile page requirements

The Operator Profile page should be compact and clean.

Required:

- show nickname;
- show level;
- show account/game time if available;
- show current bound profiles for PvP/PvE/Seasonal;
- the nickname (one for all modes) comes from the game logs — no manual change action;
- allow deleting/removing a profile binding with a small X/cross;
- add a full “clear all app data” action that removes all local app data and resets the application completely.

Remove for now:

- fake character portrait/imitated character image;
- armband block;
- headset block;
- holster block.

## Maps and minimap requirements

Interactive maps must be accurate and usable.

Requirements:

- maps should display completely, not cropped incorrectly;
- map markers must be positioned using proper map coordinates, not random rows/lines;
- exits, quest markers, quest items, keys, bosses, loot, and other markers need distinct icons;
- default map layers should show only:
  - exits by faction;
  - quest objectives;
  - quest items.
- loot should be a separate layer and off by default;
- bosses should not have ugly outlines; use cleaner icons without heavy outline;
- floor switching must work on all maps where floors exist;
- map and item information windows must open correctly;
- pressing `M` should open/close the full minimap overlay, matching the experimental “show/hide minimap” behavior;
- clicking a mini-map should not only open a tiny broken window; it should open the intended fullscreen/minimap mode;
- map overlay must work in fullscreen Tarkov where possible, with the known limitation that Windows cannot always draw overlays over exclusive fullscreen. Borderless mode is the safer target.

Screenshot/location tracking:

- screenshot-based location tracking currently does not work and must be fixed before claiming support;
- if implemented, the app should read supported screenshots/log hints, detect map/position, and sync the point on the active minimap;
- do not claim exact in-raid location unless verified.

## Item card and Flea Market requirements

Flea Market should merge:

- all items;
- keys;
- ammunition;
- economy/price information.

The separate old “Economy”, “Keys”, and “Ammo” sections should be combined into Flea Market tabs/filters.

Item details:

- clicking a key must not incorrectly navigate away to a separate broken item page;
- the item card should open in place;
- item card should show only Flea Market price for now;
- remove extra unrelated details from item info until needed.

## Traders page requirements

Traders should be shown as photo cards similar to in-game trader selection.

For now:

- show trader portraits/cards;
- clicking trader opens a detail area;
- do not overfill trader page with unfinished data yet.

## Hideout requirements

The Hideout section should become a top-down hideout map similar in spirit to Tarkov’s in-game hideout view.

Requirements:

- show modules as visible clickable zones/cards on a top-down layout;
- clicking a module opens a small panel/modal;
- panel shows:
  - current level if known;
  - next level;
  - required items;
  - required trader levels;
  - required skills/other modules;
  - build time if available.
- If EFT logs do not expose reliable hideout state, allow local manual state for module level but clearly label it.
- Use Tarkov.dev/Tarkov data sources for module requirements where possible.

## Goons / Nomads feature

Add a block for Goons/Nomads sightings.

Desired UX:

1. User opens Goons/Nomads block.
2. User clicks “Seen” / “Видел”.
3. Buttons move upward inside the block.
4. App shows selectable maps where they can appear.
5. User selects the map where they saw them.
6. App saves and displays fresh crowd-sourced info:
   - map;
   - time;
   - possibly region/server if later added.

This feature should be designed as user-submitted data and will need anti-spam/abuse protection if moved server-side.

## Localization requirements

The interface must support Russian and English fully.

Known issues to fix:

- switching to English leaves some Russian labels;
- switching back to Russian does not fully translate the left menu;
- some English translations are poor or incorrect;
- generated/raw IDs appear instead of real names;
- language switching can change quest progress, which must never happen.

Rules:

- language changes must only change text presentation;
- language must not modify quest state, profile data, task counts, Kappa progress, selected mode, or local progress;
- all labels in cards, buttons, side menu, top bar, settings, overview, maps, market, traders, hideout, experiments, and profile must go through the localization layer.

## Subscription model

The planned app is paid.

Flow:

1. User downloads desktop client.
2. User registers/signs in.
3. Every new account gets 1 free day (owner, 12.10.2026), server-side, once per canonical e-mail, per device and per Escape from Tarkov account (owner, 13.10.2026). The day is counted from the first sign-in in an app — PC, phone or browser build, the first POST /v1/entitlement — not from registration (owner, 12.10.2026: «сутки должны начинаться после первого входа в приложение»); until then the account shows «сутки ждут первого входа в приложение». Accounts that had a free period but had never signed in to an app when this shipped (0.6.0.23) wait for that sign-in at the full length; accounts from before 12.10.2026 without a streamer's code have no free day.
   One Escape from Tarkov account — one Raid OS account, both ways (owner, 13.10.2026: «не войдешь в один аккаунт Таркова двумя аккаунтами RAID OS»): the desktop app reports the game AccountId from the logs, the server binds a free one and refuses the entitlement and paid data to a PC whose game account belongs to another Raid OS account or differs from the bound one (docs/subscription-protection.md). The owner unbinds a game account in the admin panel when a player changes accounts. Similar e-mail addresses (name+x@, n.a.m.e@gmail.com) register (owner, 13.10.2026: «блокировать по созданию похожей почты не нужно»): the app then says the game account is already in use, also on the «Нужна подписка» screen. The server compares the whole AccountId (a digest of all its digits); the last three digits are only shown.
4. User may arrive through a streamer referral link; referral users get 3 free days, also from the first sign-in in an app (programme paused since 09.10.2026 — a streamer's code then gives the same 1 day as everybody).
5. After the free period, paid features are blocked.
6. App shows a subscription/payment window.
7. User can subscribe for:
   - 1 month;
   - 3 months;
   - 6 months;
   - 12 months.
8. Annual plan should have a 33% discount.
9. Monthly auto-renewal should be supported where payment provider allows it.

If a user has no active subscription:

- desktop shell may open;
- paid data/functionality should be unavailable;
- server should not return protected catalog/progression features;
- local cached paid data should have strict expiry and should not allow permanent offline bypass.

## Friend referral program («Пригласи друга»)

Implemented in `server/src/services/invites.ts`; terms in the offer, section 7 (`website/src/legal/documents.ts`).

- Every player has a personal code and link. A new player who registers with it (or enters it in the cabinet before the first payment) gets 20 % off the first payment of the 1-month plan.
- The inviter gets 7 days of Premium for every friend whose first payment is that discounted first month (owner, 12.10.2026: «друзья должны оплатить подписку по скидке 20%»). A friend who starts with a longer plan (no discount there) does not count. The inviter's own payment is not required (owner, 12.10.2026: «ему дают бонусы, даже если он не оплатил первично»).
- The reward is held 14 days; any refund of the friend's payment cancels it. A friend counts once per Escape from Tarkov account (bound by the desktop app). Suspicious rewards go to the owner's review. Ranks: 3 / 10 / 25 confirmed friends add a month / three months / a year, 50 make access lifelong (25 and 50 after the owner's review).
- Rewards are subscription days only, never money.

## Streamer referral program

Streamers should receive unique referral links.

Referral link behavior:

- user clicks streamer link;
- landing/registration flow tracks the streamer referral code;
- user gets 3 free days;
- if user pays, streamer receives attribution/commission;
- attribution should be stored server-side, not only in client.

Streamer dashboard:

- total link clicks;
- registrations;
- trial activations;
- paid conversions;
- active paid users;
- churn/cancellations if available;
- total revenue attributed;
- streamer earnings;
- pending payout;
- paid payout history;
- conversion rate.

Streamer payout:

- streamer should be able to request withdrawal to card/bank/account where legally and technically possible;
- first version can be manual approval;
- later version can integrate payout provider;
- fraud checks and minimum payout threshold are recommended.

Possible dashboard implementation:

- website personal account;
- or separate streamer mode inside the app;
- website is recommended first because it is easier to secure and maintain.

## Payments and regions

Product should support Russian-speaking and English-speaking audiences.

Possible architecture:

- one global backend;
- region-aware payment providers;
- UI language and payment method chosen by locale, referral campaign, or user choice.
- Registration country (owner, 13.10.2026: «при регистрации нужно указать страну»): every registration form (site, PC app, phone) asks it as an ISO 3166-1 alpha-2 code (`src/shared/countries.ts`, mandatory on the server too since 14.10.2026 (owner: «на сайте сделай указывать страну обязательно при регистрации»): an app from before the question, whose form has no such field, is told to update the app or register on raidos.app; older accounts set it in the cabinet); the admin panel's «Пользователи» splits accounts into СНГ (RU, BY, KZ, KG, TJ, UZ, TM, AM, AZ, MD) / Европа (UN-geoscheme Europe plus CY, minus the CIS list: UA is Europe, GE and TR are «Другие») / Другие / Не указана — a country moves by moving its code between `CIS_COUNTRIES` and `EUROPE_COUNTRIES` in that file.

Payment options:

- international cards/subscriptions through providers such as Stripe or Paddle, if available for the business entity;
- RU/CIS methods need separate research: SBP, YooKassa, CloudPayments, Robokassa, or other providers depending on business registration and recurring-payment support.

Important:

- SBP may not support the same simple recurring subscription model everywhere;
- recurring payments depend on provider and legal setup;
- do not hard-code payment secrets or provider keys into the desktop client;
- payment state must be verified server-side by webhooks.

## Server-side architecture

Recommended target architecture:

- Desktop client:
  - UI shell;
  - local log/screenshot reader;
  - local cache;
  - sends normalized events to server;
  - receives allowed/protected results only after entitlement check.
- API server:
  - authentication;
  - subscription entitlement;
  - referral attribution;
  - streamer dashboard data;
  - public/protected catalog cache;
  - player profile resolver;
  - quest inference;
  - per-user progress snapshots;
  - payment webhooks.
- Database:
  - users;
  - devices/sessions;
  - linked Tarkov profiles;
  - subscriptions;
  - referrals;
  - streamer accounts;
  - payouts;
  - event logs;
  - derived progress snapshots.
- Cache layer:
  - Tarkov.dev catalog cache;
  - market prices;
  - map/quest data;
  - profile lookup results.

Suggested pilot server:

- 2 vCPU;
- 4 GB RAM;
- 40–80 GB SSD;
- Ubuntu 24.04 LTS;
- Node.js 24 LTS;
- HTTPS reverse proxy;
- off-server backups.

This should be enough for an invitation-only pilot if data processing is cached and clients do not spam upstream APIs.

Growth path:

- add PostgreSQL instead of SQLite for production;
- add Redis/cache if needed;
- move static assets/CDN separately;
- add background workers for catalog refresh/payment reconciliation;
- add monitoring/logging;
- add rate limiting.

## Expected server load

Main load sources:

- account registration/login;
- profile refresh every minute;
- log/screenshot event upload;
- catalog/market data refresh;
- payment webhooks;
- streamer dashboard analytics.

Most expensive data should be shared/cached server-side. Do not make every desktop client independently fetch the same huge Tarkov catalog every minute.

Approximate early pilot expectations:

- low CPU if catalog is cached;
- RAM mostly used by Node.js API, cache, and DB connections;
- SSD mostly used by database, event logs, profile snapshots, app logs, and backups;
- screenshots should not be uploaded raw unless absolutely needed because they increase storage and privacy risk.

Prefer sending normalized local events rather than large raw files:

- task appeared/completed;
- session mode;
- map/session info;
- recognized quest names;
- extracted coordinates if available;
- timestamp;
- client version.

## Security and anti-bypass goals

The user explicitly wants a low chance of users extracting the paid database from the exe or bypassing subscriptions.

Rules:

- do not ship the complete protected database inside the exe;
- do not store payment/subscription secrets in the client;
- client should request protected data from server only after auth and entitlement check;
- server validates active subscription;
- server validates referral/trial rules;
- server rate-limits API;
- server signs short-lived access tokens;
- client cache should expire;
- client must not permanently unlock paid features offline;
- do not trust client-provided subscription state;
- do not trust client-provided referral revenue;
- all payment state must be confirmed by provider webhooks.

Possible attack paths to consider:

- modifying local storage to fake subscription;
- patching renderer JavaScript;
- replaying old API responses;
- extracting bundled data from Electron ASAR;
- using someone else’s token;
- abusing trial accounts;
- changing system clock;
- blocking server calls after one successful unlock;
- fake streamer referrals;
- payment webhook spoofing;
- API scraping.

Mitigations:

- server-side entitlement checks;
- short-lived JWT/session tokens;
- refresh tokens with device/session tracking;
- signed responses where useful;
- request rate limits;
- replay protection for critical endpoints;
- server-generated trial state;
- payment webhook signature validation;
- no long-lived secrets in exe;
- obfuscation can be used but must not be the main protection.

## What is realistic vs difficult

Realistic:

- protected server-side catalog and subscription gates;
- streamer referral links and dashboards;
- separate PvP/PvE/Season profiles;
- current tasks from logs plus public profile data plus inference;
- paid desktop shell with server login;
- RU/EN interface;
- hideout planner from static data;
- map markers and layers from proper coordinate data.

Difficult:

- perfectly reading all current in-game task/progress state from local files;
- live inventory/rig/backpack reading unless a reliable supported source exists;
- exact real-time player location from screenshots;
- drawing overlays over true exclusive fullscreen mode;
- preventing every possible client patch forever.

Not acceptable:

- game memory reading;
- injection;
- anti-cheat bypass;
- gameplay automation;
- claiming exact live data without verified implementation.

## Handoff checklist for another AI/developer

Before implementing new major changes:

1. Read `CLAUDE.md`.
2. Read this document.
3. Inspect `package.json`.
4. Inspect `docs/superpowers/specs/2026-09-26-mode-profiles-progression-design.md`.
5. Inspect `docs/superpowers/plans/2026-09-26-hybrid-desktop-api.md`.
6. Inspect `server/README.md`.
7. Check `git status`.
8. Do not overwrite user changes.
9. Run relevant tests before building an exe.

