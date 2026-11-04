# «Торговля» in «Экономика»

Owner, 05.11.2026: «Купить дешевле, продать дороже». Its own block in «Экономика», not the flea market's page: the items whose price swings hardest, their lows and highs over a week or 3 days, the current price, and signals in the app when a price is near its low (buy) or near its high (sell), with what it should earn. Only what the flea market opens at the player's level is shown (owner, same day: «Опирайся на его уровень»). Items with durability are left out altogether (owner, same day: «Предметы у которых есть прочность, не рассматривай и не добавляй их в систему»). PvP, PvE and Season are apart throughout.

Code: `src/domain/trading.ts` (shared, pure), `server/src/services/tradingStats.ts` (builds the file), `GET /v1/data/trading/:mode`, `src/data/tradingApi.ts`, `src/trading/*`, `src/pages/TradingPage.tsx`.

## The game's rules, checked 05.11.2026

| Rule | What was found | Source |
| --- | --- | --- |
| Listing needs «found in raid» | **No.** `foundInRaidRequired: false` in all three modes | tarkov.dev `fleaMarket`, the game's own settings; the wiki's «Trading» page lists what cannot be offered and FIR is not on it |
| What cannot be listed | Secure containers, bitcoins, currency, loose ammo, some weapons, loot, armor, vests, backpacks, helmets: 1 532 of 5 498 items have `noFlea` | wiki «Trading»; tarkov.dev `types` |
| Level | The market at 15; per item `minLevelForFlea`: 0, 20, 25, 30, 35, 40 (PvP: 1 641, 927, 1 153, 166, 30, 49 items). Applies to buying and listing | tarkov.dev; timesaver.gg, lfcarry.com |
| Fee | `VO·Ti·4^PO + VR·Tr·4^PR`, `Ti = Tr = 0.05` since patch 1.1.0.0 of 03.08.2026 (was 0.03). −30% with the Intelligence Center at level 3, up to −45% with the Hideout Management skill. Buying has no fee | wiki «Trading», Insider Gaming on 1.1.0, tarkov.dev rates |
| A listing that does not sell | The fee is gone (taken when listing), flea reputation falls | wiki «Trading» |
| Traders | Since 1.1.0.0 they pay about 20% less | Insider Gaming |

Not confirmed by a patch note: no source names the patch that ended the FIR rule, and one undated guide still states it. The game's own setting and the wiki's current page (it already has the 5% fee) outweigh that, but **one purchase and one try at listing it in the game is the proof**: the owner was asked for it. If the rule does exist after all, only the trader route stands (143 items in PvP, 190 in PvE, 131 in Season are under a trader's price at least a tenth of the week).

## The data

- `json.tarkov.dev/<mode>/prices/<itemId>`: history from 2022, a point every **2 hours** over about the last 30 days, daily before that. Enough: nothing of our own has to be gathered.
- `priceMin`: the cheapest offer at that scan. `price`: their average. `offerCount`: how many offers. **There is no data on actual sales.**
- Current prices are up to ~1.5 hours old: `updated` of an item, median 52 min, max 92 min (04.11.2026). Our minute price mirror cannot be fresher than that.
- Season has its own history too (`pvp-season`). `src/data/economyApi.ts graphqlGameMode` says otherwise only for GraphQL.

## How it is worked out

- Lows and highs use `priceMin`: what one can buy at, and the price to undercut to sell. Scans with 1–2 offers are dropped: a key at 4 500 000 ₽ while the usual range is 45 000–555 000 ₽ is a lone listing.
- The zones are quantiles of the week, not its extremes: buy under the cheapest 10%, sell over the dearest 15%. The real low and high are shown beside them, because the owner asked for them, but a one-off cannot be traded on.
- A sale: listed 1% under the lowest price, minus the fee. To a trader: his price, at once, no fee, no slot, no waiting.
- Never asked for: items with durability (`hasDurability` in `src/domain/trading.ts`): tarkov.dev `durability` above 0 (armor, armored rigs, face shields), `maxDurability` (weapons), the types `gun`, `preset`, `armor`, `armorPlate`, `helmet`. About 526 items of the market per mode. A price there is the price of one worn copy, and history does not say how worn. Keys and medkits have uses, not durability: they stay, keys with a warning. Sunglasses have a `durability` of 0 and stay.
- Not listed: too few scans, fewer than 5 offers usually, under 3 000 ₽, not profitable even from the week's lowest to its best (the owner's rule), not worthwhile (1 000 ₽ and 5%) from the usual low to the usual high, or a past month that did not pay.
- **The past month is replayed as if the scheme had been followed**, knowing only the week before each moment. A signal buys at the **next** scan (the cheap offer is usually gone), sells at the first floor in the zone within 48 hours, at the zone's price, not at the jump that crossed it, else at the end of the 48 hours. In a first run, buying at the signal's own price showed 95% wins, the next scan about 72% and half the money. With sales counted at the zone's price it is 76–77%. That is the honest figure, and the page shows it as «как это было в прошлом».
- Signals (the app, at the current price): under a trader's price by 2% / 500 ₽; or in the buying zone, at least 10% under the usual price, worthwhile, and at least 60% of past dips in profit; or in the selling zone, 10% over the usual price, more than a trader pays. Statistics older than 36 hours give no signals. Neither do a 24-hour average or demo prices.
- Messages: from the player's threshold (25 000 ₽ by default, 5 000–100 000 ₽), a listing only with ≥80% of past dips in profit, 3 at most at a time, one per item, kind and mode per 12 hours, never in a raid, never while the character's level is unknown, not over the page itself.

## Added by us, not asked for

Marked in the owner's report: how often past dips paid and how long the wait was; the number of offers; the time of day an item is usually cheaper or dearer (only where the difference is ≥10%; over the PvP items floors run about 5% above the day's level at 02–04 UTC and 2.6% below at 16–18 UTC); profit per stash cell and per rouble; a warning when the last day is 10% under the usual price (it may keep falling); the lowest listing that loses nothing, for the player's own price; the warning on keys below.

## Figures of 05.11.2026

Candidates: on the market, at least 3 000 ₽, at least 2 offers.

| | PvP | PvE | Season |
| --- | --- | --- | --- |
| On the market / checked (without durability) | 3 540 / 1 715 | 3 744 / 2 183 | 3 432 / 1 403 |
| Profitable | 730 | 1 032 | 603 |
| Open at level 15 / 20 / 25 / 30 / 40 | 175 / 298 / 660 / 715 / 730 | 320 / 543 / 958 / 1 020 / 1 032 | 142 / 233 / 536 / 588 / 603 |
| Past month: dips, in profit | 7 275, 77% | 11 146, 77% | 6 704, 77% |
| Typical item, usual profit per deal | 5 626 ₽ | 5 666 ₽ | 5 194 ₽ |

Golden egg (level 30, Therapist pays 34 680 ₽): PvP usual 32 000–34 755 ₽, +380 ₽ a deal, hardly worth it; PvE usual 22 300–34 000 ₽, 16 of 17 in profit, +4 680 ₽; Season +2 680 ₽.

## Load

The server builds the file; a player's request only reads it.

- Every 6 hours the published items (about 225 per mode), once a day all candidates, one request at a time with a 300 ms pause: at most about 40 minutes a day and 5 300 requests, then ~2 000 a day more. Measured on the real data on the owner's PC (the VPS is slower): 7.5 CPU seconds for a whole pass (about 0.25% of one core while it runs) and ~320 MB of process memory at its peak, most of it the three datasets being parsed.
- The file: ~205 KB, ~52 KB compressed. The app asks for it every 3 hours at most while its window is visible.
- Prices come from what the app already fetches: the catalog every 10 minutes, the minute prices only on the page itself. No new polling.
- `RAIDOS_TRADING_STATS=0` turns the pass off; the page then says the statistics are being gathered.

## Risks that remain

- A rising lowest price is not a proof of sale: there is no data on deals. The past month is judged on prices, not on sales.
- **Uses.** The cheapest key may be nearly used up, and history does not show it; the page warns on keys. Items with durability are left out for the same reason.
- Everything is one player's view: many players following one signal would move the price.
- The first pass on a server takes about an hour, then the file exists; until then the page says so.
