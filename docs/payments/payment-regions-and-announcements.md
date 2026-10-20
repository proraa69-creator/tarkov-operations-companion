# Raid OS — payment regions and announcement audiences

This is the source of truth for the payment-region UI and the «Создать объявление» audience selector.

## Regions

- `RU` — Russia. Payment method: existing YooKassa SBP only.
- `CIS` — CIS countries except Russia. Payment method: Boosty CIS offer.
- `WORLD` — Europe and every country outside CIS. Payment method: Boosty international offer.

The account country is mandatory. If it is missing, the site must block payment and other protected account actions until the user selects it. Do not use IP or VPN geolocation as the account country; it may only be used as a non-binding suggestion.

The server must derive the allowed payment region from the saved country. The client must not be able to request a cheaper region by changing a form value.

## Boosty links

- WORLD standard: https://boosty.to/raidosapp/purchase/4136082?ssource=DIRECT&share=subscription_link
- WORLD friend discount: https://boosty.to/raidosapp/purchase/4136112?ssource=DIRECT&share=subscription_link
- CIS standard: https://boosty.to/raidosapp/purchase/4136107?ssource=DIRECT&share=subscription_link
- CIS friend discount: https://boosty.to/raidosapp/purchase/4136111?ssource=DIRECT&share=subscription_link

Russia must never receive a Boosty link. CIS must never receive a WORLD link, and WORLD must never receive a CIS link.

## Referral visibility

Users who arrived through a valid friend referral may see both the standard link and the one-time friend-discount link for their region. The discount link is consumed after the owner manually confirms the Boosty payment and activates the subscription. It must not be restored on reload or exposed to users without a valid referral.

The manual flow requires the buyer to use the same email on Boosty as in Raid OS. Payment confirmation is manual until an official Boosty API/webhook is available.

## Required Boosty warning (before every Boosty redirect)

Russian:

> Укажите на Boosty тот же email, который используется в вашем аккаунте Raid OS. Иначе мы не сможем найти платёж и активировать подписку.

English:

> Use the same email on Boosty as in your Raid OS account. Otherwise, we won’t be able to find your payment and activate your subscription.

The user must acknowledge this warning before the external link is opened.

## Announcement audiences

The «Создать объявление» screen must offer these audience values:

- `CIS` / «СНГ» — announcement about the CIS Boosty payment link.
- `WORLD` / «Мир» — announcement about the international Boosty payment link.
- `ALL_PAID_REGIONS` / «Все, кроме России» — optional combined audience for the same announcement text.

Russia is intentionally excluded from Boosty announcements because Russian users pay through SBP.

Suggested Russian announcement:

> Оплата Raid OS через Boosty доступна для пользователей из СНГ и других стран. Перед оплатой укажите на Boosty тот же email, который используется в Raid OS. Пользователям из России доступна оплата через СБП.

Suggested English announcement:

> Raid OS payments via Boosty are now available for users in the CIS and other countries. Use the same email on Boosty as in your Raid OS account before paying. Users in Russia can pay via SBP.


---

## Implementation (16.10.2026)

Everything above is the owner's text. This part describes how it is implemented.

### Regions and links

- `src/shared/paymentRegions.ts` — `paymentRegionOf(country)`: `RU`; `CIS` = the CIS list of `src/shared/countries.ts` without Russia (BY, KZ, KG, TJ, UZ, TM, AM, AZ, MD); `WORLD` = every other country, a country typed by hand (`XX`) included; no country → no region.
- `GET /v1/payments` returns `region`, `provider` (`yookassa` | `boosty` | `null`) and `boosty: { offers: ['standard', 'friend'?] }` — never links. The region always comes from the saved country; nothing in a request can change it.
- `POST /v1/payments/boosty { offer: 'standard' | 'friend', acknowledged: true }` → `{ url, region, offer }`: the link of the account's own region only. 400 without the acknowledgement, 409 `COUNTRY_REQUIRED` without a country, 409 for Russia, 403 for the friend offer without an unspent friend code. `POST /v1/payments` (ЮKassa SBP) answers 409 `COUNTRY_REQUIRED` without a country and 409 `BOOSTY_REGION` for CIS / WORLD.
- The friend discount (`«Пригласи друга»`, 20 %) is the same one as with ЮKassa: open while the account came with a friend's code and has no successful payment yet; the first payment that activates the subscription spends it, so it never comes back on a reload.
- The website cabinet (`website/src/components/BoostyCheckout.tsx`) shows the Boosty buttons for CIS / WORLD, the ЮKassa plans for Russia, and «Укажите страну» without a country. Before every redirect the dialog shows the warning above (exact RU / EN text) with the account e-mail and a checkbox; «Перейти на Boosty» stays disabled until it is ticked, and only then the server is asked for the link. The desktop app has no own checkout (it opens the cabinet).

### Announcement audiences

`POST /v1/accounts/me/admin/notices` (and `/surveys`) accept `audience.payRegion`: `CIS` («СНГ», the CIS without Russia), `WORLD` («Мир», every country outside the CIS), `ALL_PAID_REGIONS` («Все, кроме России»). It replaces the regions (400 together with them); Russia and accounts without a country never get such a notice. In «Создать объявление» (owner app and website admin) picking one fills the suggested RU / EN text above as an editable draft (title «Оплата через Boosty» / «Payments via Boosty»).

### Automatic issuance (Boosty's unofficial API)

The owner chose automatic issuance through Boosty's internal, undocumented API and accepted the risk that it may change or be blocked without notice. Manual confirmation keeps working in any case.

Server environment (in `/etc/raidos/raidos.env` on the VPS; never in Git, never in chat):

| Variable | Aliases | Meaning |
|---|---|---|
| `BOOSTY_AUTH` | `BOOSTY_AUTH_JSON` | the `auth` value from boosty.to localStorage: JSON `{"accessToken","refreshToken","expiresAt"}` (snake_case and URL-encoded forms are accepted too) |
| `BOOSTY_CLIENT_ID` | `BOOSTY_DEVICE_ID`, `BOOSTY_CLIENTID` | the `_clientId` value (device id), needed to refresh the token |
| `BOOSTY_BLOG` | — | blog name, default `raidosapp` |
| `BOOSTY_SYNC_MINUTES` | — | poll period, 2–120, default 5 |
| `BOOSTY_LEVEL_MAP` | — | optional JSON for levels that are not the four offers: `{"<level id>": "CIS_STANDARD", "name:<level name>": "WORLD_FRIEND", "price:<roubles>": "WORLD_STANDARD"}` |
| `BOOSTY_WORLD_PRICE_RUB` | — | optional: the WORLD standard level's price in roubles, used for the other-region share until the sync has seen a WORLD subscriber (17.10.2026) |

**«Токен Boosty» in the owner's panel (17.10.2026).** The owner can paste a new session on the website («Админ-панель» → Boosty → «Токен Boosty»): `PUT /v1/accounts/me/admin/boosty/session { session }` (the JSON `{ auth, clientId }` a bookmark on boosty.to shows; or `{ auth, clientId }` apart). The server keeps it in `boosty-credentials.json` next to the database (mode 600), prefers it to `BOOSTY_AUTH` / `BOOSTY_CLIENT_ID`, replaces the running session at once (or starts the job when there was none) and never echoes, logs or audits the values (the audit says only `boosty.session`). Safari on iPhone has no developer tools: the panel gives a `javascript:` bookmark that reads only `localStorage.auth` / `_clientId` of boosty.to and shows them in a prompt to copy. A **private** tab gives a session of the server's own: closed without «Выйти», nothing else rotates its tokens.

Without a pasted session and without both `BOOSTY_AUTH` and `BOOSTY_CLIENT_ID` no job exists and nothing calls Boosty. With them (`server/src/services/boostySync.ts`, `boostyClient.ts`):

- every period: `GET https://api.boosty.to/v1/blog/{blog}/subscribers?limit=100&offset=N` with `Authorization: Bearer <accessToken>`, page by page (1 s between pages, 15 s timeout per request); paths and fields follow the public unofficial clients (krasnovmv/boosty-api, BazZziliuS/boostylib, ath31st/boosty_api_rs);
- an expiring token (or a 401) is refreshed once: `POST https://api.boosty.to/oauth/token/` (form: `grant_type=refresh_token`, `refresh_token`, `device_id`, `device_os=web`). The rotated tokens are saved next to the database in `boosty-tokens.json` (mode 600) with a fingerprint of the env seed: a restart keeps working, a new `BOOSTY_AUTH` replaces them. Tokens are never logged, returned or put into error texts;
- after an error the next pass waits twice as long (up to an hour); a refused refresh means a dead token: the owner panel shows «Токен Boosty истёк — обновите BOOSTY_AUTH» and the job retries hourly;
- the owner's pause switch stops the passes (kept in the database).

Each active paid subscriber (`subscribed`, `status: active`, price > 0) is matched:

1. level → offer: the table keyed by level id (`4136082` WORLD standard, `4136112` WORLD friend, `4136107` CIS standard, `4136111` CIS friend), then the owner's mapping in the panel, then `BOOSTY_LEVEL_MAP`;
2. e-mail (case-insensitive) → Raid OS account;
3. the same rules as the manual confirmation: the offer's region must equal the account's payment region; the friend offer needs an unspent friend code (and spends it). Two exceptions of the sync (owner, 17.10.2026): a level of the **other** Boosty region is issued for what it is worth — a WORLD account on a CIS level gets the share `paid price / WORLD price of the same kind` (at most 1) of the time to Boosty's date, a CIS account on a WORLD level the whole period; Russia stays in review. A «СНГ» account that the cabinet / Boosty link saw (Cloudflare `CF-IPCountry`, last 60 days) **only** from countries outside the CIS goes to review as `region_suspect` for CIS levels; the owner's confirmation settles it (the owner's account view of Boosty shows `seenCountries` and `regionSuspect`);
4. the account is paid until Boosty's `nextPayTime` + 1 day, never shorter than it already is; one payment row per subscriber and period (`boosty_subscribers.last_period_end`, payment `provider_id = boosty:sub:<user>:<period>`), so a pass every few minutes changes nothing until Boosty's date moves (a renewal). A manual confirmation of the same account and region in the last 40 days that is not yet tied to a subscriber is adopted as that subscriber's first period (no second payment).

The review list (nothing is issued; one item per subscriber, period and reason):

| `reason` | case |
|---|---|
| `unknown_email` | no Raid OS account with the subscriber's e-mail (settled automatically once such an account exists) |
| `no_country` | the account has no country |
| `region_mismatch` | any offer bought by a Russian account, or a CIS offer bought by a WORLD account while the WORLD price is unknown |
| `region_suspect` | a CIS offer of a «СНГ» account seen only from countries outside the CIS (17.10.2026) |
| `friend_without_referral` | a NEW subscriber on a friend offer without an unspent friend code. Later periods of a friend-offer subscription already issued once (same Boosty subscriber and same Raid OS account, whose first grant spent the referral) renew automatically like a standard one; only the first friend payment carries the discount mark and the inviter's reward |
| `unknown_level` | a level that is none of the four offers (logged; map it in the panel) |
| `no_period` | Boosty sent no next-payment date |

Owner panel: website admin → «Платежи» → «Boosty (СНГ и мир)»: last check / last successful check, the last error (sanitised), the dead-token banner, pause, «Проверить сейчас», the review list («Подтвердить…» fills the manual form, «Скрыть»), unknown levels with an offer selector, and «Подтвердить оплату Boosty».

### API for the subscription tool

All endpoints: `https://raidos.app/v1/accounts/me/admin/…`, `Authorization: Bearer <session token of an owner account>` (an account listed in `TARKOV_OWNER_EMAILS` with a confirmed e-mail). 401 without a session, 404 for any other account, 429 above 240 reads / 30 writes per minute. Amounts are roubles.

- `GET /me/admin/boosty` → `{ sync, review: { items, total }, levels, offers }`
  - `sync`: `{ configured, paused, running, blog?, periodMinutes?, lastSyncAt?, lastSuccessAt?, lastError?, tokenDead, nextRunAt?, lastResult?: { subscribers, active, granted, adopted, review, unchanged } }`
- `GET /me/admin/boosty/payments?email=&limit=1..500&offset=` → `{ payments: [...], total }`, newest first; each payment: `{ id, accountId, email?, region: 'CIS'|'WORLD', offer: 'standard'|'friend', offerKey?, plan, amount, status: 'succeeded'|'refunded', source: 'auto'|'manual', confirmedAt, confirmedBy, periodEnd?, paidUntilAfter?, boostyUserId?, reference? }`
- `GET /me/admin/boosty/review?status=open|all&limit=&offset=` → `{ items: [{ id, reason, reasonText, email, accountId?, boostyUserId?, levelId?, levelName?, offerKey?, price?, periodEnd?, status: 'open'|'resolved'|'dismissed', createdAt, updatedAt, resolvedAt?, resolvedBy? }], total }`
- `POST /me/admin/boosty/payments` «Подтвердить оплату Boosty» `{ email, offer: 'standard'|'friend', region?: 'CIS'|'WORLD', months?: 1|3|6|12, paidUntil?: 'YYYY-MM-DD' | ISO, amount?, reference?, reviewId? }` — exactly one of `months` / `paidUntil` (a date means the end of that day, Moscow, + 1 day of grace; at most 400 days ahead); `region` is the region of the offer that was bought (default: the account's). → `201 { payment, user }`; `404 { code: 'unknown_email' }`, `409 { code: 'no_country' | 'region_mismatch' | 'friend_without_referral' }`, 409 for a `reference` already used, 400 for a friend offer with more than 1 month or unknown fields. Audited as `payment.boosty-confirm`.
- `POST /me/admin/boosty/review/:id/dismiss` → `{ ok: true }`
- `PUT /me/admin/boosty/levels/:levelId { offer: 'WORLD_STANDARD'|'WORLD_FRIEND'|'CIS_STANDARD'|'CIS_FRIEND'|null }` → `{ levels }`
- `PUT /me/admin/boosty/pause { paused: boolean }` → `{ sync }` (409 without the Boosty secrets)
- `POST /me/admin/boosty/sync` → `{ sync }` («Проверить сейчас»; runs even while paused; 409 without the Boosty secrets)

## BZB (Bezebee) tariffs for the CIS and the world (20.10.2026)

Owner: «добавь СНГ-тарифы для тех, у кого аккаунты СНГ на сайте; каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa», then the Global ones and the referral ones. One BZB product page per plan (one-time payment, no auto-renewal):

| Region | Plan | Price | Page |
|---|---|---|---|
| CIS | 1 month | 300 ₽ | https://pay.bezebee.com/NMTIra0O |
| CIS | 3 months | 810 ₽ | https://pay.bezebee.com/EIV5foW0 |
| CIS | 6 months | 1500 ₽ | https://pay.bezebee.com/iPnQLAib |
| CIS | 12 months | 2400 ₽ | https://pay.bezebee.com/x0ccDHp2 |
| CIS | referral, 1 month | 240 ₽ | https://pay.bezebee.com/DBmUzkAn |
| WORLD | 1 month | $7 | https://pay.bezebee.com/3bAgJUTh |
| WORLD | 3 months | $19 | https://pay.bezebee.com/EpGyVETp |
| WORLD | 6 months | $35 | https://pay.bezebee.com/ivaGNRWa |
| WORLD | 12 months | $60 | https://pay.bezebee.com/sOGFWBn6 |
| WORLD | referral, 1 month | $5.50 | https://pay.bezebee.com/Xw98gnXM |

- `server/src/services/bezebee.ts` holds the table. `GET /v1/payments` adds `bezebee: { currency: 'RUB' | 'USD', plans: [{ plan, months, price }], friend: { plan: '1m', price } | null }` for CIS / WORLD accounts (null for Russia or without a country; never links). `friend` while the account's friend discount is open (services/invites.ts).
- `POST /v1/payments/bezebee { plan, friend?: true, consent: { version } }` → `{ url, plan, friend }`: the page of the account's own region only; the offer / personal data consent is stored like a ЮKassa payment's (`account_consents`, kind `payment`). 400 without the consent, 409 `COUNTRY_REQUIRED` / `BEZEBEE_REGION` (Russia), 403 for the referral page without an open friend discount or for a plan other than 1 month.
- The cabinet (`website/src/components/BezebeeCheckout.tsx`) shows the four plan cards (roubles for the CIS, dollars elsewhere), the discounted ones highlighted like the Russian ЮKassa plans; an invited account sees «1 месяц» crossed out with the friend price («−N % по приглашению, только первый месяц»). «Оплатить» opens the same confirmation as ЮKassa: «Я принимаю условия публичной оферты и даю согласие на обработку персональных данных» (required), «Платёж разовый. Автоматических повторных списаний нет», then «Перейти к оплате». No e-mail warning for BZB (owner: «при оплате через новый сервис это не нужно» — BZB confirms through its API); the Boosty buttons below keep theirs.
- The BZB pages are one-time payments: no auto-renewal, so no autopay consent. A recurring BZB tariff would need its own links and the separate autopay consent, as with ЮKassa.
- The referral page is handed out while the friend discount is open; nothing tells the server that it was paid, so the discount is spent when the owner confirms that payment. Until BZB's API confirmation is connected, the owner opens the subscription by hand (admin «Пользователи» → add days). Public offer and privacy policy name BZB for the CIS and other countries (LEGAL_VERSION 2026-10-20.2).

## Boosty removed from the site; BZB confirmation; owner preview (20.10.2026)

- Owner: «оплату Boosty убирай вообще с сайта, все надписи, кнопки». The cabinet shows only the BZB tariffs for CIS / WORLD (no Boosty buttons, no e-mail warning), `/boosty` redirects to `/cabinet#subscription`, the «Подписка» dialog and the documents name BZB. The offer keeps one line for subscriptions bought on Boosty before (they run to Boosty's next payment date + 1 day and renew / cancel on Boosty); the privacy policy keeps what the server still reads for them. The server's Boosty sync and the owner's Boosty panel stay for those subscriptions.
- `POST /v1/accounts/me/admin/bezebee/payments { email, plan, friend?, amount?, reference? }` (services/bezebee.ts `BezebeePayments.confirm`): a succeeded payment (provider `bezebee`), the plan's months added; the referral price spends the friend discount (`friendDiscountUsed`) so the cabinet shows only the full prices afterwards, and earns the inviter's reward. This is the path BZB's API (webhook) will call once its documentation and key are given; there is no admin button for it (owner: «подтверждаться будет автоматически»).
- Owner preview: `https://raidos.app/cabinet?as=cis`, `?as=global`, `?as=cis&friend=1`, `?as=global&friend=1` — `GET /v1/payments?as=CIS|WORLD&friend=1` and `POST /v1/payments/bezebee { as }` honour it for the owner's account only (everybody else gets their own region; tests). The real BZB pages open, so a test payment is a real payment.

## BZB: автозачисление по уведомлениям (20.10.2026)

- В кабинете BZB: «API ключи для интеграций» → ключ с **Webhook URL** `https://raidos.app/v1/payments/bezebee/webhook` и выпущенным **секретом подписи вебхуков**.
- В админке Raid OS (вкладка «Платежи» → «BZB — автозачисление оплат») владелец вставляет API токен и секрет подписи; сервер хранит их в `bezebee-credentials.json` рядом с базой (права 600) или берёт из `BEZEBEE_API_TOKEN` / `BEZEBEE_WEBHOOK_SECRET`. Курс для выручки Global: `BEZEBEE_USD_RUB` (по умолчанию 90).
- Сервер (`server/src/services/bezebeeWebhook.ts`): проверяет `X-BZB-Signature` (HMAC-SHA256 тела), читает ссылку оплаты (тариф и регион), e-mail покупателя, сумму и статус; оплату зачисляет на аккаунт с этим e-mail (как `BezebeePayments.confirm`, реферальная ссылка сжигает скидку друга); один платёж — один раз. Без секрета уведомления сохраняются, но подписку не открывают. Не сопоставленные (только Telegram, другой e-mail, аккаунт из России, скидка уже использована) ждут в админке — «Привязать к аккаунту».
- Схему тела уведомления BZB не публикует: разбор нестрогий; после первого реального уведомления сверить его JSON в админке и при необходимости уточнить разбор.
- Проверка 20.10.2026 (оплата $7 Global): от BZB не пришло ни одного уведомления — в журнале только две проверки самого сервера (`{}` и `{"check":"raid-os"}`). Кабинет BZB описывает API-ключи как способ «создавать платёжные ссылки и проверять статусы оплат»; вебхуки уходят по ссылкам, созданным через API этим ключом, а 10 ссылок тарифов сделаны в кабинете вручную. Чтобы автозачисление заработало, сервер должен создавать ссылку на каждую оплату через API BZB — нужна документация их Public API (запрос создания ссылки, тело вебхука); публичной документации нет, запрошена у владельца/поддержки BZB.
- До этого: админка «BZB — автозачисление оплат» → «Зачислить оплату вручную» (`POST /me/admin/bezebee/payments`: e-mail, тариф, «цена друга», сумма в рублях — для Global обязательна) и «Убрать» у уведомления в «Ждут привязки», которое не оплата (`POST /me/admin/bezebee/events/:id/dismiss` → status `ignored`).
