# Raid OS — payment regions and announcement audiences

This is the source of truth for the payment-region UI and the «Создать объявление» audience selector.

## Regions

- `RU` — Russia. Payment method: ЮKassa (the methods enabled for the shop, `YOOKASSA_PAYMENT_METHODS`). The owner may
  open BZB's CIS pages to one Russian account that cannot pay through ЮKassa (02.11.2026: admin «Пользователи» →
  «Оплата через BZB (СНГ)»; ЮKassa stays for it).
- `CIS` — the CIS countries except Russia, Asia, the low-income countries and Ukraine (`CIS_PAYMENT_COUNTRIES`; Ukraine by the
  owner, 08.11.2026: «Переведи Украину в СНГ-сегмент… и в рублях, и в долларах… Не $7, а … 3,5»). Payment method: BZB in
  roubles, or in US dollars by a foreign card ($3.5 a month). Ukraine stays Europe in the admin regions and notices' language.
  Belarus (`BY`) gets the rouble pages only (owner, 11.11.2026): its cards are refused by the dollar pages' processor,
  while the rouble pages' Russian acquiring takes them, Belkart included (BZB's answer). `NO_CARD_COUNTRIES` in
  `server/src/services/bezebee.ts`: no `card` offer, and `POST /v1/payments/bezebee { card: true }` answers 409
  `BEZEBEE_CARD_COUNTRY`.
- `WORLD` — the rest of Europe and every other country, a country typed by hand (`XX`) included. Payment method: BZB in US dollars.

The account country is mandatory. If it is missing, the site must block payment and other protected account actions until the user selects it. Do not use IP or VPN geolocation as the account country; it may only be used as a non-binding suggestion.

The server must derive the allowed payment region from the saved country. The client must not be able to request a cheaper region by changing a form value.

## Announcement audiences

«Создать объявление» and «Создать опрос» (owner app and website admin, `src/shared/notices.ts`) offer the regions
«Все», «Россия», «СНГ» (the CIS price list without Russia) and «Мир» (every other country), together with the payment
state: «Все», «Платная подписка», «Без оплаты». An account without a country gets only «Все».

---

## Implementation

- `src/shared/paymentRegions.ts` — `paymentRegionOf(country)`: `RU`; `CIS` for `CIS_PAYMENT_COUNTRIES`; `WORLD` for every
  other country; no country → no region.
- `GET /v1/payments` returns `region`, `provider` (`yookassa` for Russia, `bezebee` for CIS / WORLD, `null` without a
  country) and `bezebee` (below). The region always comes from the saved country; nothing in a request can change it.
- `POST /v1/payments` (ЮKassa) answers 409 `COUNTRY_REQUIRED` without a country and 409 `YOOKASSA_REGION` for CIS / WORLD.
- The friend discount («Пригласи друга», 20 %) is open while the account came with a friend's code and has no successful
  payment yet; the first payment that activates the subscription spends it, so it never comes back on a reload.

## BZB (Bezebee) tariffs for the CIS and the world (20.10.2026)

Owner: «добавь СНГ-тарифы для тех, у кого аккаунты СНГ на сайте; каждую ссылку отдельно, каждой кнопкой, как у нас сделано с ЮKassa», then the Global ones and the referral ones. One BZB product page per plan (one-time payment, no auto-renewal):

| Region | Plan | Price | Page |
|---|---|---|---|
| CIS | 1 month | 300 ₽ | https://pay.bezebee.com/NMTIra0O |
| CIS | 3 months | 800 ₽ | https://pay.bezebee.com/EIV5foW0 |
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
- The cabinet (`website/src/components/BezebeeCheckout.tsx`) shows the four plan cards (roubles for the CIS, dollars elsewhere), the discounted ones highlighted like the Russian ЮKassa plans; an invited account sees «1 месяц» crossed out with the friend price («−N % по приглашению, только первый месяц»). «Оплатить» opens the same confirmation as ЮKassa: «Я принимаю условия публичной оферты и даю согласие на обработку персональных данных» (required), «Платёж разовый. Автоматических повторных списаний нет», then «Перейти к оплате». No e-mail warning for BZB (owner: «при оплате через новый сервис это не нужно» — BZB confirms through its API).
- The BZB pages are one-time payments: no auto-renewal, so no autopay consent. A recurring BZB tariff would need its own links and the separate autopay consent, as with ЮKassa.
- The referral page is handed out while the friend discount is open; nothing tells the server that it was paid, so the discount is spent when the owner confirms that payment. Until BZB's API confirmation is connected, the owner opens the subscription by hand (admin «Пользователи» → add days). Public offer and privacy policy name BZB for the CIS and other countries (LEGAL_VERSION 2026-10-20.2).

## BZB confirmation; owner preview (20.10.2026)

- `POST /v1/accounts/me/admin/bezebee/payments { email, plan, friend?, amount?, reference? }` (services/bezebee.ts `BezebeePayments.confirm`): a succeeded payment (provider `bezebee`), the plan's months added; the referral price spends the friend discount (`friendDiscountUsed`) so the cabinet shows only the full prices afterwards, and earns the inviter's reward. This is the path BZB's API (webhook) will call once its documentation and key are given; there is no admin button for it (owner: «подтверждаться будет автоматически»).
- Owner preview: `https://raidos.app/cabinet?as=cis`, `?as=global`, `?as=cis&friend=1`, `?as=global&friend=1` — `GET /v1/payments?as=CIS|WORLD&friend=1` and `POST /v1/payments/bezebee { as }` honour it for the owner's account only (everybody else gets their own region; tests). The real BZB pages open, so a test payment is a real payment.

## BZB: автозачисление по уведомлениям (20.10.2026)

- В кабинете BZB: «API ключи для интеграций» → ключ с **Webhook URL** `https://raidos.app/v1/payments/bezebee/webhook` и выпущенным **секретом подписи вебхуков**.
- В админке Raid OS (вкладка «Платежи» → «BZB — автозачисление оплат») владелец вставляет API токен и секрет подписи; сервер хранит их в `bezebee-credentials.json` рядом с базой (права 600) или берёт из `BEZEBEE_API_TOKEN` / `BEZEBEE_WEBHOOK_SECRET`. Курс для выручки Global: `BEZEBEE_USD_RUB` (по умолчанию 90).
- Сервер (`server/src/services/bezebeeWebhook.ts`): проверяет `X-BZB-Signature` (HMAC-SHA256 тела), читает ссылку оплаты (тариф и регион), e-mail покупателя, сумму и статус; оплату зачисляет на аккаунт с этим e-mail (как `BezebeePayments.confirm`, реферальная ссылка сжигает скидку друга); один платёж — один раз. Без секрета уведомления сохраняются, но подписку не открывают. Не сопоставленные (только Telegram, другой e-mail, аккаунт из России, скидка уже использована) ждут в админке — «Привязать к аккаунту».
- Схему тела уведомления BZB не публикует: разбор нестрогий; после первого реального уведомления сверить его JSON в админке и при необходимости уточнить разбор.
- Проверка 20.10.2026 (оплата $7 Global): от BZB не пришло ни одного уведомления — в журнале только две проверки самого сервера (`{}` и `{"check":"raid-os"}`). Кабинет BZB описывает API-ключи как способ «создавать платёжные ссылки и проверять статусы оплат»; вебхуки уходят по ссылкам, созданным через API этим ключом, а 10 ссылок тарифов сделаны в кабинете вручную. Чтобы автозачисление заработало, сервер должен создавать ссылку на каждую оплату через API BZB — нужна документация их Public API (запрос создания ссылки, тело вебхука); публичной документации нет, запрошена у владельца/поддержки BZB.
- Автозачисление по письмам (владелец 20.10.2026: «уведомление об оплате пришло мне на почту… читать почту и брать оттуда информацию»; подтвердил «разрешаю автозачисление по почте»). BZB присылает каждую продажу письмом от `no-reply@bezebee.com`: тема «Новая продажа: «Raid OS — Global — 1 Month»», текст «Покупатель оплатил товар «…» на сумму 7.00 USD… Контакт покупателя: e-mail». Владелец пересылает такие письма фильтром Gmail на ящик проекта (почта кабинета BZB остаётся его — на ящик сервера не попадают письма сброса пароля кабинета) и вставляет в админке адрес ящика и пароль приложения Google. Сервер (`services/bezebeeMail.ts`, `imapReader.ts`, `mailMessage.ts`) раз в минуту читает INBOX по IMAP (только чтение, `BODY.PEEK`), разбирает письмо: тариф — по сумме и валюте, аккаунт — по e-mail покупателя. Подписку открывает только письмо, за которое ручается Gmail (верхний `Authentication-Results: mx.google.com` — dkim=pass для bezebee.com, dmarc=pass header.from=bezebee.com или spf=pass для отправителя bezebee.com); подделка ложится в «Ждут привязки» как «без подписи». Одно письмо (Message-ID) — один раз. Первая проверка смотрит на 3 дня назад. Пароль хранится в `bezebee-credentials.json` (600), обратно не отдаётся. `PUT /me/admin/bezebee/credentials { mailUser, mailPassword }`, `POST /me/admin/bezebee/mail/check`.
- Ручные действия: админка «BZB — автозачисление оплат» → «Зачислить оплату вручную» (`POST /me/admin/bezebee/payments`: e-mail, тариф, «цена друга», сумма в рублях — для Global обязательна) и «Убрать» у уведомления в «Ждут привязки», которое не оплата (`POST /me/admin/bezebee/events/:id/dismiss` → status `ignored`).
- E-mail уже введён на странице BZB (0.6.0.95, владелец 20.10.2026: «чтобы когда человек переходил по ссылке на оплату, у него уже был введен его email»). `POST /v1/payments/bezebee` отдаёт ссылку тарифа с `?email=<e-mail аккаунта>`; форма BZB берёт поле «Email» из этого параметра (`receiptEmail: searchParams.get("email") || prefill_email`; проверено на живой странице `pay.bezebee.com/NMTIra0O?email=…` — поле заполнено). Надписи «укажите e-mail аккаунта» в окне оплаты нет (владелец: «тогда не надо делать надпись, что нужно указать соответствующий email»). Покупатель может стереть или сменить адрес на странице BZB — тогда письмо о продаже ляжет в «Ждут привязки».

## Boosty removed (03.11.2026)

Owner: «все что связано с бусти удаляй, с ними мы больше не работаем» (release 0.6.0.189; on 20.10.2026 Boosty had
already left the site's checkout).

- Gone: the Boosty sync (Boosty's unofficial API, the `BOOSTY_*` settings, the «Токен Boosty» session), the Boosty links
  and routes (`POST /v1/payments/boosty`, `GET /v1/payments/boosty/public`, `/v1/accounts/me/admin/boosty*`,
  `/me/admin/users/:id/boosty`), «Подтвердить оплату Boosty» in the owner app, the Boosty announcement audiences and the
  «Мы на Boosty» button of «О нас».
- The first start of the new server drops Boosty's own tables (`boosty_link_requests`, `boosty_grants`,
  `boosty_seen_countries`, `boosty_subscribers`, `boosty_review`, `boosty_levels`, `boosty_state`: `PaymentStore`
  `removeBoosty`) and deletes `boosty-tokens.json` / `boosty-credentials.json` next to the database. Notices sent to a
  Boosty audience read as the same regions («СНГ», «Мир», both) and the live ones are withdrawn; the `pay_region` column
  goes (`NoticeStore` `dropBoostyAudiences`). A form that still sends `payRegion` gets 400, never «Все».
- Kept: the payments made through Boosty (provider `boosty` in the database) as financial history, shown as «Архив»
  everywhere like Lava.top's and counted in the revenue; the days they paid for run to their end. The audit log keeps
  its `payment.boosty-confirm` entries. `/boosty` on the site still redirects to `/cabinet#subscription` (old links).
- Documents ред. 21 (`LEGAL_VERSION` 2026-11-03): the offer says Boosty is no longer a way to pay, what was paid there
  runs to its end and renewals there do not count; the privacy policy and the consent no longer name data received
  from Boosty.
