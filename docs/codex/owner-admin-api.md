# Raid OS — owner admin API (for the owner app)

The server API a separate owner app uses to show and manage users, subscriptions and payments. Source:
`server/src/routes/ownerAdmin.ts` (routes), `server/src/services/adminStore.ts` (queries), tests in
`server/src/routes/ownerAdmin.test.ts` and `server/src/routes/ownerStats.test.ts`.

Part 1 describes the endpoints added for the owner app (statistics, user filters, users CSV, bulk grant, payment
filters). Part 2 summarises every other owner endpoint the app can use.

## Signing in and calling the API

- Base URL: `https://raidos.app/v1`. Every owner route below is under `/v1/accounts/me/admin/…`.
- Sign in: `POST /v1/accounts/login` with `{ "email": "...", "password": "..." }` →
  `200 { token, account }`. Send the token as `Authorization: Bearer <token>` on every request.
  - Wrong e-mail or password: `401`. A blocked account: `403`. Too many attempts: `429` with `Retry-After`
    (10 sign-in attempts per 15 minutes per address, 10 failed attempts per e-mail per hour).
  - Sign out: `POST /v1/accounts/logout` with the Bearer token → `204`.
- Sessions last 7 days and cannot be refreshed. When a call answers `401`, sign in again. An account keeps at most 10
  open sessions: the 11th sign-in ends the oldest one (the website, the PC app and the phone share this limit).
- Owner rights: the account's e-mail must be listed in the server's `TARKOV_OWNER_EMAILS` **and** confirmed (with a
  one-time code). Other accounts get `404` from every owner route (the routes do not reveal that they exist).
  `GET /v1/accounts/me` → `account.owner` tells the app whether the session has owner rights.
- A browser app (a web page calling the API from another origin) only works from an origin listed in the server's
  `WEB_ORIGIN` (CORS). A desktop or phone app that sends plain HTTP requests is not affected by CORS.
- `/v1/admin/…` (the desktop app's `TARKOV_ADMIN_TOKEN` routes) answer only to requests made on the server machine
  itself. They cannot be used remotely: use the `/v1/accounts/me/admin/…` routes.
- Every owner response has `Cache-Control: no-store`.

### Errors and limits (all owner routes in `ownerAdmin.ts`)

| Status | Body | When |
| --- | --- | --- |
| 400 | `{ error }` | Invalid query or body (`error` is `Некорректные данные запроса` or a specific Russian message) |
| 401 | `{ error }` | No session or an expired one |
| 404 | `{ error }` | Not an owner account, or the user / payment does not exist |
| 409 | `{ error }` | The action is not possible in this state (explained in `error`) |
| 429 | `{ error }` + `Retry-After` header (seconds) | Rate limit |

Rate limits are per owner account, per minute: 240 reads, 30 writes, 10 CSV exports. Error messages are in Russian
and meant to be shown to the owner as they are.

### Conventions

- Days (`YYYY-MM-DD`) are Moscow days (UTC+3, no daylight saving). A day filter covers the whole day: `from` from
  00:00, `to` until 24:00 Moscow time. Timestamps in answers are ISO 8601 in UTC.
- Money is in roubles (a number with up to 2 decimals). An archived payment counts with the rouble amount stored when
  it was paid.
- Payment regions (from the account's country, never from the IP): `RU` — Russia; `CIS` — the CIS countries except
  Russia (BY, KZ, KG, TJ, UZ, TM, AM, AZ, MD); `WORLD` — every other country, including a country typed by hand (`XX`);
  `none` — no country (old accounts, and every deleted account: the country is erased with it).
  Source: `src/shared/paymentRegions.ts`.
- Legacy regions (the website's «Пользователи» tabs): `cis` (СНГ, Russia included), `europe` (Европа), `other`
  (Другие), `none` (Не указана). Source: `src/shared/countries.ts`.
- Deleted accounts are anonymous stubs kept for the payment records. They are never counted or listed as users. Their
  payments still count as revenue (region `none`).
- Account ids are 24 lowercase hex characters.

---

## Part 1. Endpoints for the owner app

### GET /me/admin/stats

One aggregate for the dashboard.

Query: `from=YYYY-MM-DD`, `to=YYYY-MM-DD` (both optional). Default: `to` is today, `from` is 29 days before `to`
(30 days in total). `from` later than `to`, or an invalid date: `400`. Read rate limit.

«In range» means between `from` 00:00 and `to` 24:00 Moscow time. Everything else describes the state now.

```jsonc
{
  "generatedAt": "2026-10-01T10:00:00.000Z",
  "range": { "from": "2026-09-25", "to": "2026-10-01", "timezone": "Europe/Moscow", "start": "<ISO>", "end": "<ISO, exclusive>" },
  "users": {
    "total": 9,            // accounts that are not deleted (users, streamers and the owner)
    "new": 6,              // of those, registered in range
    "deletedExcluded": 1,  // deleted accounts (all time), left out of every user count
    "streamers": 1,
    "blocked": 0
  },
  "byRegion": {            // payment regions; the same shape for RU, CIS, WORLD, none
    "RU": { "users": 2, "new": 0, "paying": 2, "active": 2, "revenue": 1110 }
  },
  "legacyRegion": { "cis": 3, "europe": 3, "other": 1, "none": 2 },   // users per legacy region
  "byCountry": [           // countries that have users, most users first (then revenue, then code)
    { "country": "RU", "users": 2, "new": 0, "paying": 2, "active": 2, "revenue": 1110 }
  ],
  "subscriptions": {
    "activePaid": 3,       // a running period of an account that has at least one succeeded payment
    "activeGranted": 2,    // a running period of an account that never paid (only grants)
    "grantedBy": { "owner": 1, "friend": 1 },  // activeGranted split: owner grants (incl. bug report rewards) / «Пригласи друга» rewards
    "trials": 1,           // free period running, no paid period
    "trialsPending": 4,    // free period waiting for the first sign-in in an app
    "expiringIn7Days": 2,  // paid or granted periods (not lifetime) that end within 7 days
    "expiringIn30Days": 4, // … within 30 days
    "lifetime": { "total": 1, "streamers": 1, "legend": 0 },  // streamers, and rank Legend (lifelong Premium)
    "autopay": 1           // active ЮKassa autopayments
  },
  "payers": {
    "everPaid": 3,         // users with at least one succeeded payment (refunded ones do not count)
    "paidInRange": 3,      // users with a succeeded payment in range
    "newInRange": 2        // users whose first succeeded payment is in range
  },
  "revenue": {             // succeeded payments whose paid_at (else created_at) is in range
    "total": 1660,
    "payments": 4,
    "streamerEarnings": 0, // streamers' share of those payments
    "byProvider": { "yookassa": { "count": 3, "amount": 1410 }, "boosty": { "count": 1, "amount": 250 }, "archive": { "count": 0, "amount": 0 } },
    "byMethod": { "sbp": { "count": 2, "amount": 600 }, "bank_card": { "count": 1, "amount": 810 }, "boosty": { "count": 1, "amount": 250 } },
    "byRegion": { "RU": { "count": 2, "amount": 1110 }, "CIS": { "count": 1, "amount": 250 }, "WORLD": { "count": 0, "amount": 0 }, "none": { "count": 1, "amount": 300 } },
    "byPlan": { "1m": { "count": 3, "amount": 850 }, "3m": { "count": 1, "amount": 810 }, "6m": { "count": 0, "amount": 0 }, "12m": { "count": 0, "amount": 0 } },
    "refunds": { "count": 1, "amount": 300 }   // payments marked refunded, by refund date (else paid date) in range
  },
  "referrals": {
    "friendInvited": 1,          // users who came with a friend's code («Пригласи друга»)
    "friendInvitedInRange": 1,   // of those, registered in range
    "friendPaid": 1,             // of those, with a succeeded payment
    "friendPaidDiscount": 0,     // of those, with a succeeded payment at the friend's discount
    "streamerReferred": 0,       // users who came with a streamer's code
    "rewardsByStatus": { "pending": 0, "review": 0, "granted": 1, "canceled": 0 }  // all «Пригласи друга» rewards
  },
  "trialConversion": {
    "trialStarted": 2,     // users registered in range whose free period has started
    "laterPaid": 1,        // of those, with a succeeded payment
    "rate": 0.5            // laterPaid / trialStarted (0–1, 4 decimals; 0 when nobody started)
  }
}
```

Definitions:

- `paying` (region / country): the account's subscription source is `money` (see «Subscription source» below).
  `active`: any running access except the free period (`money`, `grant`, `friend` or `lifetime`).
- Region and country `revenue`: revenue in range from the payers' accounts in that region / country. Revenue of
  deleted accounts is in `byRegion.none` and in no country.
- `byMethod` keys: the payment method ЮKassa reports (`sbp`, `sberbank` = SberPay, `tinkoff_bank` = T-Pay, `bank_card`,
  `yoo_money`, `mir_pay`, …), `boosty` for Boosty, `unknown` for ЮKassa payments made before the method was stored
  (16.10.2026), `archive` for the removed foreign provider.
- Partial refunds are not in `refunds`: the payment stays succeeded and the owner adjusts the days by hand.
- The statistics do not include the owner's free days or bug report rewards as revenue (they are not payments).

### GET /me/admin/users (extended, backwards compatible)

Query (all optional; every filter narrows the list):

| Parameter | Values | Meaning |
| --- | --- | --- |
| `q` | text ≤ 254 | E-mail, game nickname, or the inviter's e-mail contains this text |
| `filter` | `all` (default), `active`, `trial`, `inactive`, `streamers`, `blocked` | As before |
| `region` | `all` (default), `cis`, `europe`, `other`, `none` | Legacy region tab, as before |
| `country` | ISO 3166-1 alpha-2, any case (`XX` = typed by hand) | Exact country |
| `payRegion` | `RU`, `CIS`, `WORLD`, `none` | Payment region |
| `payer` | `yes`, `no` | At least one succeeded payment ever / none |
| `expiresBefore` | `YYYY-MM-DD` | A running paid or granted period that ends on or before that day (already expired ones are not included) |
| `registeredFrom`, `registeredTo` | `YYYY-MM-DD` | Registration day range (inclusive); `registeredFrom` after `registeredTo` is `400` |
| `seenSince` | `YYYY-MM-DD` | Last authenticated request (site, PC app or phone) on or after that day |
| `autopay` | `yes`, `no` | Has an active autopayment / has not |
| `sort` | `created` (default), `paidUntil`, `lastSeen`, `payments` | `payments`: total paid (then the number of payments) |
| `order` | `desc` (default), `asc` | |
| `limit` | 1–500, default 100 | |
| `offset` | 0–1 000 000, default 0 | |

Answer: `{ users: AdminUser[], total, regions: { all, cis, europe, other, none } }`. `total` counts every match;
`regions` counts the legacy region tabs within all the other filters (it ignores `region`).

`AdminUser`:

```jsonc
{
  "id": "…24 hex…",
  "email": "player@example.com",
  "kind": "user",                      // or "streamer"
  "owner": true,                       // only on owner accounts
  "createdAt": "<ISO>",
  "referredBy": "STREAMER1",           // streamer's code the account came with
  "referralCode": "STREAMER1",         // a streamer's own code
  "subscription": { "status": "active", "paidUntil": "<ISO>" },
  //   status: active | trial | inactive; trialEndsAt (trial); lifetime: true (streamer);
  //   trialPendingDays: the free period waits for the first sign-in in an app
  "autopay": { "provider": "yookassa", "status": "active", "plan": "1m" },  // or null
  "lastSeenAt": "<ISO>",               // last authenticated request anywhere
  "pcSeenAt": "<ISO>",                 // last use of the PC app
  "blockedAt": "<ISO>",
  "payments": { "count": 2, "total": 600 },   // succeeded payments, roubles
  "eftAccount": { "masked": "••••123", "boundAt": "<ISO>" },
  "country": "RU",
  "countryOther": "Some country",      // text typed by hand when country = XX
  "nickname": "PlayerName",            // Escape from Tarkov nickname found by the PC app
  "invitedBy": { "id": "…", "email": "friend@example.com", "nickname": "…", "deleted": true, "discount": "used" },
  "payRegion": "RU",                   // NEW: RU | CIS | WORLD | none
  "source": "money"                    // NEW: see below; absent without access
}
```

Optional fields are left out when empty.

#### Subscription source (`source`)

What the account's access rests on right now:

| Value | Meaning |
| --- | --- |
| `money` | A running paid period on an account that has at least one succeeded payment (ЮKassa, Boosty or archived) |
| `grant` | A running period on an account that never paid: owner grants, bug report rewards |
| `friend` | The same, but the account also got days from a granted «Пригласи друга» reward |
| `lifetime` | A streamer, or rank Legend (paid until 2100) |
| `trial` | The free period is running and there is no paid period |
| *(absent)* | No access |

A paying account that also received free days stays `money`.

### GET /me/admin/users.csv

The same query parameters as the users list (no `limit`/`offset`), in the same order, at most 50 000 rows. Export rate
limit (10 a minute). Each export is written to the audit log as `users.export` with the row count and the filters.

Answer: `text/csv; charset=utf-8`, UTF-8 with BOM, `;` separator, CRLF line ends,
`Content-Disposition: attachment; filename="raidos-users-YYYY-MM-DD.csv"`. Cells that look like formulas are
prefixed with `'`.

Columns:

| Column | Content |
| --- | --- |
| `email` | |
| `nickname` | Game nickname, empty if not found yet |
| `country` | ISO code; `XX (text)` for a country typed by hand |
| `payRegion` | `RU`, `CIS`, `WORLD`, `none` |
| `created` | Registration, `YYYY-MM-DD HH:MM` Moscow time |
| `lastSeen` | Last authenticated request, Moscow time, empty if never |
| `status` | `blocked` if blocked, else `active`, `trial` or `inactive` |
| `paidUntil` | End of the paid / granted period, Moscow time (also an expired one; empty for a trial) |
| `source` | Subscription source, empty without access |
| `paymentsCount` | Succeeded payments |
| `paymentsTotal` | Their sum, roubles with a decimal comma (`810,00`) |
| `invitedBy` | Inviter's e-mail, `deleted` when the inviter's account was deleted, empty otherwise |

### POST /me/admin/users/bulk-grant

Gives the same number of free days to many accounts at once.

Body (JSON; unknown fields are refused):

```jsonc
{
  "ids": ["…24 hex…"],                  // EITHER a list of account ids (at most 500 distinct)
  "filter": { "payRegion": "WORLD", "payer": "no" },  // OR the users list filters (same names and values as the query)
  "days": 7,                            // 1–3650
  "reason": "Компенсация за сбой",      // 3–200 characters, kept in each account's grant history
  "dryRun": true                        // optional: nothing changes, the answer shows what would happen
}
```

Exactly one of `ids` and `filter`. Unknown filter keys are refused (`400`), so a misspelt filter never widens the
grant. `filter: {}` matches every user. `sort`/`order` in a filter are accepted and ignored.

Rules:

- Deleted accounts and streamers (they already have lifetime access) are skipped. With `ids`, unknown ids are skipped
  too, and duplicates count once.
- Each account gets exactly what the single grant (`POST /me/admin/users/:id/grant`) gives: the days are added to the
  end of the running paid period (or to now), and a row is added to the account's grant history with the reason.
- All grants are made in one transaction. The audit log gets one entry, `subscription.bulk-grant`, with
  `{ count, days, reason, ids: <number of distinct ids> }` or `{ count, days, reason, filter: { … } }`. No per-account
  `subscription.grant` entries. A dry run is not audited.
- Write rate limit (30 a minute, shared with the other owner write actions).

Answer `200`:

```jsonc
{
  "affected": 3,          // accounts that got (or, in a dry run, would get) the days
  "skipped": 0,           // ids that were deleted, streamers, unknown or duplicated (always 0 with a filter)
  "dryRun": false,
  "sample": [             // the first 20
    { "id": "…", "email": "…", "paidUntilBefore": "<ISO>", "paidUntilAfter": "<ISO>" }
  ]
}
```

More than 500 accounts (`ids` with more than 500 distinct ids, or a filter that matches more than 500 users):
`400 { error, code: "too_many", affected: <count>, max: 500 }` and nothing changes. A dry run with such a filter
answers `200 { affected: <count>, sample, skipped: 0, dryRun: true, tooMany: true, max: 500 }` so the app can show the
count before the owner narrows the filter.

### GET /me/admin/payments (new filters) and GET /me/admin/payments.csv

Existing query: `from`, `to` (`YYYY-MM-DD`), `status` (`pending`, `succeeded`, `canceled`, `refunded`), `plan`
(`1m`, `3m`, `6m`, `12m`), `q` (payer e-mail contains), `limit`, `offset`. New:

| Parameter | Values | Meaning |
| --- | --- | --- |
| `provider` | `yookassa`, `boosty`, `archive` | Who took the money |
| `method` | lowercase method key, e.g. `sbp`, `bank_card`, `boosty`, `unknown`, `archive` | As `revenue.byMethod` in the statistics |
| `region` | `RU`, `CIS`, `WORLD`, `none` | The payer's payment region now (deleted accounts: `none`) |
| `dateField` | `created` (default), `paid` | Which date `from`/`to` filter on, and the sort order (newest first). `paid` uses paid_at, else created_at, as the statistics do |

Answer: `{ payments: AdminPayment[], total, totals: { succeeded, revenue, streamerEarnings } }` (totals cover all
matches). `AdminPayment`: `{ id, email, plan, provider, status, amount, original?, createdAt, paidAt?, renewal?,
referralCode?, streamerEarning?, friendDiscount?, method }` — `method` is new.

The CSV takes the same filters (export rate limit, audited as `payments.export`); its columns are unchanged.

### Payment method stored with each payment

`payments.method` (a new nullable column, added on server start; existing rows are untouched, Boosty rows get
`boosty`):

- ЮKassa: the method asked for when the payment is created (`sbp`, `sberbank`, `tinkoff_bank`), replaced by
  ЮKassa's `payment_method.type` when the paid payment is read back from ЮKassa (also for automatic renewals).
- Boosty: `boosty`.
- Older payments: empty (shown as `unknown`); archived ones: shown as `archive`.

### Fix: registrations no longer count deleted accounts

`GET /me/admin/overview` (`users.total`, `today`, `days7`, `days30`), `GET /me/admin/series` and
`GET /me/admin/calendar` registration counts leave deleted accounts out, like the users list and `day` already did.

---

## Part 2. Other owner endpoints

All under `/v1/accounts/me/admin/`, Bearer owner session, `401`/`404` as above. «Read/write limit» are the
240/30-a-minute limits of `ownerAdmin.ts` unless another limit is given.

### Summary and calendar

- `GET overview` → `{ generatedAt, users: { total, today, days7, days30, blocked }, subscriptions: { active, trials,
  autopay, streamers }, revenue: { today, month, all: { total, payments } }, payouts: { paid, pending,
  pendingRequests, earned } }`.
- `GET series?period=day|month|year` → `{ period, rows: [{ period, registrations, payments, revenue, plans: { 1m:
  { count, revenue }, … } }] }` (last 31 days / 12 months / all years, newest first).
- `GET calendar?month=YYYY-MM` → `{ month, today, days: [{ date, registrations, payments, revenue, plans }] }`.
- `GET day?date=YYYY-MM-DD` → `{ date, totals: { registrations, payments, revenue, streamerEarnings, plans },
  registrations: [≤200], payments: [≤500 AdminPayment], grants: [{ email, days, reason, actor, at }], invites: [≤200] }`.
- `GET online` → `{ online, pc, phone, windowMinutes, at }` (accounts active in the PC or phone app right now; poll
  every ~45 s).

### Users

- `GET users/:id` → `{ user: AdminUser, payments: [last 20 AdminPayment], grants: [last 20 { days, reason, actor, at,
  paidUntil }] }` (`days` is negative for days taken off).
- `POST users/:id/grant { days: 1–3650, reason: 3–200 }` → the same as `GET users/:id`. Audit `subscription.grant`.
- `POST users/:id/revoke { days: 1–3650, reason: 3–200 }` → takes paid days off (never back past now); `409` when
  there are no paid days or the account is a streamer. Audit `subscription.revoke`.
- `POST users/:id/cancel-autopay` → cancels the autopayment (ЮKassa: the saved method is deleted). `404` when none.
- `POST users/:id/block { reason? }` → sessions revoked, sign-in answers `403`; `409` for the owner's account.
- `POST users/:id/unblock`.
- `POST users/:id/revoke-sessions` → `{ revoked, user, payments, grants }`.
- `POST users/:id/eft-account/unbind` → frees the bound Escape from Tarkov account.
- `POST users/:id/delete` → `{ deleted: true }` (the same erasure as the player's own «Удалить аккаунт»; payments are
  kept anonymously). `409` for the owner's account or while an autopayment is active (cancel it first).
- `GET users/:id/devices` → `{ devices, limit }`; `POST users/:id/devices/:deviceId/revoke` → `{ devices, limit }`
  (audited `device.revoke`). Source: `server/src/routes/entitlement.ts`.
- `GET users/:id/boosty` → `{ region, friendAvailable, friendPercent, requests: [{ offer, region, at }] }`.

### Payments

- `GET payments`, `GET payments.csv`: see Part 1.
- `POST payments/:id/refunded` → `{ ok: true }` «Отметить возврат»: a succeeded payment refunded outside ЮKassa; the
  paid days, the streamer's share and friend rewards are taken back. `409` unless the payment is succeeded. Audit
  `payment.refund`.
- `GET sales-settings` → `{ enabled, providers, plans, yookassa: { monthPrice, receipts, autopay, publicUrl } | null,
  streamerPercent, trialDays, welcomeTrialDays }` (never keys; editing stays in the desktop app).

### Boosty

From `docs/payments/payment-regions-and-announcements.md` («API for the subscription tool»):

- `GET boosty` → `{ sync, review: { items, total }, levels, offers }`.
- `GET boosty/payments?email=&limit=&offset=` → `{ payments, total }`.
- `GET boosty/review?status=open|all&limit=&offset=` → `{ items, total }`.
- `POST boosty/payments { email, offer: 'standard'|'friend', region?: 'CIS'|'WORLD', months?: 1|3|6|12, paidUntil?,
  amount?, reference?, reviewId? }` → `201 { payment, user }`; `404/409 { error, code }` with `code` one of
  `unknown_email`, `no_country`, `region_mismatch`, `friend_without_referral`. Audit `payment.boosty-confirm`.
- `POST boosty/review/:id/dismiss` → `{ ok: true }`.
- `PUT boosty/levels/:levelId { offer: 'WORLD_STANDARD'|'WORLD_FRIEND'|'CIS_STANDARD'|'CIS_FRIEND'|null }` → `{ levels }`.
- `PUT boosty/pause { paused }` → `{ sync }`; `POST boosty/sync` → `{ sync }` (`409` without the Boosty secrets).

### «Пригласи друга» rewards

Source: `server/src/routes/invites.ts`. Writes: 20 per 15 minutes.

- `GET invite-rewards?status=pending|review|granted|canceled&limit&offset` → `{ rewards, total, counts }`.
- `POST invite-rewards/:id/decide { decision: 'approve'|'cancel', comment? }` → the reward. Audit `invite.decide`.

### Streamers and payouts

Sources: `server/src/routes/accounts.ts`, `payouts.ts`, `ownerAdmin.ts`.

- `GET streamers` → `{ streamers, invites }`; `GET streamer-stats?code=&period=` → `{ code, period, rows, campaigns }`.
- `POST streamer-invites { code }` → `201 { token, code, expiresAt }` (the invitation link is `/streamer/<token>`).
- `GET streamer-settings` → `{ defaultPercent, streamers: [{ code, email, percent, custom, linkEnabled }] }`.
- `PUT streamers/:code/percent { percent: 0–100 | null }`, `PUT streamers/:code/link { enabled }`,
  `POST streamers/:code/revoke` → streamer settings.
- `GET payouts` → `{ payouts, limits: { min, max } }`; `POST payouts/decide { id, status: 'paid'|'rejected', comment? }`;
  `PUT payout-limits { min, max }`.

### Announcements, surveys, banner

Sources: `server/src/routes/notices.ts`, `announcement.ts`. Owner limits: 240 reads / 30 writes a minute; photo
uploads 40 per 10 minutes.

- `POST notices/images { data: base64 }` → `201 { image: { id, mime, size } }` (JPG/PNG/WEBP ≤ 5 MB).
- `POST notices { title, text, titleEn?, textEn?, button?, audience: { regions?, payment: 'all'|'paid'|'unpaid',
  payRegion?: 'CIS'|'WORLD'|'ALL_PAID_REGIONS' }, images }` → `201 { notice }`.
- `POST surveys { title, titleEn?, intro?, introEn?, questions, audience }` → `201 { notice }`.
- `GET notices?kind=announcement|survey` → `{ notices }`; `POST notices/:id/withdraw` → `{ notice }`;
  `GET notices/:id/images/:idx` → `{ mime, data }`.
- `GET surveys/:id/results` → `{ survey, questions, responses }`; `GET surveys/:id/responses.csv` → CSV.
- `GET announcement` / `PUT announcement { text, active, textEn? }` — the banner for everybody.

### Audit log

- `GET audit?limit&offset` → `{ entries: [{ id, at, actor, action, target?, details? }], total }`, newest first.
  Actions added here: `users.export`, `subscription.bulk-grant`.

### Not covered here

Bug reports, support chat, map data, quest data, server updates and the YooKassa settings also have owner routes
(`server/src/routes/bugReports.ts`, `supportChat.ts`, `mapBosses.ts`, `questPoints.ts`, `questTexts.ts`,
`questRequirements.ts`, `selfUpdate.ts`, `paymentSettings.ts`); see the header comment of each file.
