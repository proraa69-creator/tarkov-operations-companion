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

