# «Торговля» in «Экономика»

Owner, 05.11.2026: «Купить дешевле, продать дороже». Its own block in «Экономика», not the flea market's page: on top the items whose price swings hardest with «Цена за 3 дн.» and «Цена за неделю» over the list, each with its lowest price of the period, the price now, the highest and the successful sales (9/14) on the right. A click opens one chart with prices, dates and hours and the forecast on it, and the sums: what you paid, the fee, the lowest selling price to come out ahead, and the price for a chosen plus (0, 10 000, 25 000, 50 000, 100 000, more). A click on «Минимум» sorts by what is now closest to its low, «Максимум» closest to its high, «Сейчас» by the price; a second click turns it round, a third goes back to the top of what swings. A right click offers «Купил» with a window for the price. «Куплено», beside the period, follows what was bought: the price to break even, the price for the chosen plus, the price now and what selling now brings; a click on one sets its plus, its messages and a price to be told about. «Продажа модулей» beside it: below. Under the list signals in the app when a price is near its low (buy) or near its high (sell), with what it should earn. Only what the flea market opens at the player's level is shown (owner, same day: «Опирайся на его уровень»). Items whose copies differ are left out altogether (owner, same day: «Предметы у которых есть прочность, не рассматривай и не добавляй их в систему», and after checking in the game: «цены на ключи которые уже без полных очков прочности, соответственно вот и разница в цене»). PvP, PvE and Season are apart throughout.

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

**The owner tried it in the game on 05.11.2026: what is bought on the flea market can be listed there again** («предметы, которые можно купить на барахолке, можно обратно продать на барахолку»). No patch note names the end of the old rule, and one undated guide still states it; that try settles it.

## The data

- `json.tarkov.dev/<mode>/prices/<itemId>`: history from 2022, a point every **2 hours** over about the last 30 days, daily before that. Enough: nothing of our own has to be gathered.
- `priceMin`: the cheapest offer at that scan. `price`: their average. `offerCount`: how many offers. **There is no data on actual sales.**
- Current prices are up to ~1.5 hours old: `updated` of an item, median 52 min, max 92 min (04.11.2026). Our minute price mirror cannot be fresher than that.
- Season has its own history too (`pvp-season`). `src/data/economyApi.ts graphqlGameMode` says otherwise only for GraphQL.

## How it is worked out

- Lows and highs use `priceMin`: what one can buy at, and the price to undercut to sell. Scans with 1–2 offers are dropped: a key at 4 500 000 ₽ while the usual range is 45 000–555 000 ₽ is a lone listing.
- The zones are quantiles of the week, not its extremes: buy under the cheapest 10%, sell over the dearest 15%. The real low and high are shown beside them, because the owner asked for them, but a one-off cannot be traded on.
- A sale: listed 1% under the lowest price, minus the fee. To a trader: the trader's price, at once, no fee, no slot, no waiting.
- Never asked for: items whose copies differ (`conditionVaries` in `src/domain/trading.ts`), about 770 of the market per mode. tarkov.dev's lowest price is for any copy, whole or not (the owner saw it on keys in the game), history does not say which, and a low bought that way cannot be resold as a whole one. Out: `durability` above 0 (armor, armored rigs, face shields), `maxDurability` (weapons), `hitpoints` (medkits), more than one `uses` (medicine), more than one `units` (water, juice, fuel, filters), the types `gun`, `preset`, `armor`, `armorPlate`, `helmet`, `keys`, and the repair kits' category. The owner named durability and keys; the rest went out by the same reasoning, the data shows it (PvP week: Metal fuel tank 27 777 ₽ against the usual 220 000–300 000 ₽, Water filter 15 000 ₽ against 70 000–99 000 ₽, Grizzly 30 000 ₽ against 45 000–78 000 ₽). What is whole or gone stays: one-use injectors and bandages, cans of food, sunglasses (a `durability` of 0), chest rigs, knives, barter, weapon parts.
- Not listed: too few scans, fewer than 5 offers usually, under 3 000 ₽, not profitable even from the week's lowest to its best (the owner's rule), not worthwhile (1 000 ₽ and 5%) from the usual low to the usual high, or a past month that did not pay.
- **The past month is replayed as if the scheme had been followed**, knowing only the week before each moment. A signal buys at the **next** scan (the cheap offer is usually gone), sells at the first floor in the zone within 48 hours, at the zone's price, not at the jump that crossed it, else at the end of the 48 hours. In a first run, buying at the signal's own price showed 95% wins, the next scan about 72% and half the money. With sales counted at the zone's price it is 76–77%. That is the honest figure, and the page shows it as «как это было в прошлом».
- Signals (the app, at the current price): under a trader's price by 2% / 500 ₽; or in the buying zone, at least 10% under the usual price, worthwhile, and at least 60% of past dips in profit; or in the selling zone, 10% over the usual price, more than a trader pays. Statistics older than 36 hours give no signals. Neither do a 24-hour average or demo prices.
- Messages: from the player's threshold (25 000 ₽ by default, 5 000–100 000 ₽), a listing only with ≥80% of past dips in profit, 3 at most at a time, one per item, kind and mode per 12 hours, never in a raid, never while the character's level is unknown, not over the page itself.

## The chart and the sums

- The dates and hours are the player's own clock. The rows carry each scan's time (`seriesFrom`, `seriesAt`), a week of them, ~320 KB raw per mode, about 65 KB gzipped (measured on the real pass, 05.11.2026, with the modules). The file is fetched every 3 hours at most.
- Forecast line (`priceForecast`): the next 48 hours as the same 2-hour buckets of the past week were, median and middle half, evened with the neighbours. It follows the day and does not foresee a sudden jump.
- When it can be sold (`sellForecast`): from every moment of the week the price was under the needed one, how long it took to get there within two days. The middle half of those waits is the band on the chart, and the page says how often it happened («Если дойдёт, то примерно…» under one time in two, «почти не доходила» under 10%). The chart's line is the needed lowest price, 1% over the listing, and moves with the chosen sum.
- `askForNet` finds the listing that leaves the sum after the fee, or says none does: the fee grows faster than the price from a point on.
- «Куплено» (`src/trading/tradingPositions.ts`) is on this device, per mode, one per item; not synced. A message comes from the notifier with the catalog's regular update (10 minutes), not in a raid, once per item, price and sum per 12 hours, whatever the threshold of the signals: when the chosen plus can be had, and when the lowest price reaches the player's own threshold. Short, with the item's picture and the plus (owner: «в окне более-менее короткую информацию»), the rest in the block. The system's notification carries the picture when the page could draw it (`app:notify`, a PNG only, checked by size); the app's own always does.
- While the page is open the minute prices are fetched by themselves (owner: «обновление раз в минуту автоматически если человек находится в этом разделе»), as before: `/v1/data/prices/:mode`, a prepared file. Measured on the real route with a 318 KB file: 60 requests at once 0.3 s on the owner's PC, client side included. Not fresher than tarkov.dev's 1–1.5 hours. A button was dropped for this.

## The fee's test, the slider, the peak (owner, 05.11.2026)

- **A difference that pays for the fee.** «разница в цене окупила и комиссию, и дала еще какую-то прибыль… такие предметы не рассматривают, у которых разница в цене небольшая, а комиссия большая». `windowPays`: on the market itself, without a trader, from the period's lowest to its highest and from its usual low to its usual high, a tenth of the price must be left after the fee. The server applies it to the week, the page to the period on screen, so «Цена за 3 дн.» judges by those three days. Red Rebel ice pick in PvE (696 969–799 999 ₽, a fee of 146 000 ₽) lost 55 000 ₽ at best and stood in the list only because Jaeger pays 796 773 ₽; such rows are out, with what they earned at a trader.
- **The sum is a slider** from 0 to at least 100 000 ₽, wider for a dear item, with a field for any sum. Green up to what the period's highest price leaves after the fee, red above it with «Дорого для этого предмета»; the green frame under it says what can really be earned.
- **«Через сколько продать»** in «Куплено»: the hours the next two days were dearest in the past week (`peakForecast`), on the player's own clock. Under 2% of difference over the day there is no peak to speak of, and it says so.
- **Prices.** They come by themselves: the owner took the button away on 06.11.2026 («Убери ее и сделай автоматическое обновление… И пиши, когда было последнее обновление»). Our server asks tarkov.dev every minute, the page asks our server every minute while it is open: a renewal reaches the player within about 2 minutes. tarkov.dev renews a portion of the items every 10 minutes (measured 05.11.2026: 130–1 065 items at :08, :18, :28…), so each item about every 1.5 hours (half of them under 31 minutes old, 90% under 81, the oldest 101–111). So the page says «Цены обновляются раз в 1,5 часа» (the owner's words) and «последнее обновление цен: HH:MM», the newest `updated` of the items (`pricesAt` in the minute file). That time moves every 10 minutes although one item's price does not. tarkov.dev rescans each item about hourly: measured on 05.11.2026 at 13:40, half the prices older than 42 minutes, a tenth older than 92, the oldest 102. So the price can still differ from the game's, and no button changes that. The owner had the line about it taken off the page («Удали этот блок»); the warning at the top stays in the owner's words.
- **PvE's prices are its own since 0.6.0.246.** `api.tarkov.dev/api/v1/<mode>/items` has PvP prices whatever the mode in its address, and the price mirror had taken PvE from it since c54ded89 (12.10.2026): measured on 05.11.2026, a median of 42% off. Only PvP comes from that route now; PvE and Season come from their own JSON files, 17 MB against 6 MB a minute on the server. The statistics were right all along, they read each mode's own history.
- **«Новое: Торговля»** is a news item of `src/onboarding/tours.ts` since 0.6.0.249, as the owner asked: «должно быть посередине, как у нас все всплывающие окна с указателем». The card stands in the middle of the window, the button in the menu is lit up, the pointer is right beside it (`centred` in `GuideTip`), and it takes its turn with the other windows. Who closed the window 0.6.0.246 showed on its own (`raidos-trading-intro-v1`) or has been on the page is not told again, nor is a new player, as with all news; none of it in a raid.

## «Продажа модулей»

Owner, 05.11.2026: buy from a trader what the Gunsmith needs, list it on the flea market. «покупаешь вот дульник, например, там за 6000, а на барахолку ты можешь выставить там, ну, допустим, за 50000». Only the parts that cannot be replaced: `containsAll` of the Mechanic's `buildWeapon` objectives (78 parts in 30 builds; `containsCategory` lets the player choose, and does not count). Out by the owner's word (05.11.2026, «взаимозаменяемые предметы тут не должны быть», `partIsCommon`): grips, foregrips, magazines, flashlights, lasers, the Zenit parts of the AK family; the game's data names those in the builds too, so this is a choice and not a fact of the game. Left, sold for money by a trader and not banned on the market: 37. The server adds them to the file with their week of prices (`tradingModules`, `moduleHistory`), asked for at every pass. The app works out the deal at the current lowest price (`moduleDeal`): the cheapest trader open to the player, listed 1% under it, the fee off, worth at least 5 000 ₽ and 5%. Open means: the market's level, the trader's level at most what the character's level allows (`useTraderLevels`; the game does not tell the real loyalty, so one above the player's real level can show), and the quest that opens the offer done.

Now, at level 40, PvP: 37 of 72 are worth it. The top: Magpul MOE grip (FDE) 25 187 ₽ at Peacekeeper, 99 000 ₽ on the market, +55 682 ₽; Zenit DTK-1P 10 573 ₽ at Skier, 69 420 ₽, +44 890 ₽; AB Arms rail mount 4 935 ₽, 79 666 ₽, +41 396 ₽. Traders limit these per restock (often 1–5) and many offers are few (1–3 listings): the price may rest on one listing. The page says both.

## «Продажа торговцам»

Owner, 05.11.2026, on a player's proposal («от большей к меньшей выгоде»): «ты находишь, какой предмет продается дешевле, чем торговцам… золотое яйцо… продать торговцу 30 тысяч, а на барахолке оно сейчас там 20 тысяч… предметы с износом, с количеством ресурсов не используй». The button stands to the right of «Продажа модулей».

- The server lists what may qualify at every pass (`traderItems` in the file, `tradingTraderItems`): a trader buys it, the market lets it through, `conditionVaries` is false, more than two listings. No requests of its own. About 1 200 items in PvP, 1 750 in PvE, 890 in Season (05.11.2026): the file grows by 10–20 KB gzipped.
- The app holds that list against this minute's prices (`traderSales` in `src/trading/tradingBoard.ts`): the lowest listing now against the trader who pays most, in this mode, at this level. No fee either way. The most profit first.
- Left out: under 500 ₽ on an item, and a trader paying five times the market's price or more. Those rows were stray scans: 1 ₽, 15 ₽, 77 ₽ against 742–3 607 ₽, every one with a single listing. With three listings or more the widest gap on the real data was 3.2.
- An answer on the real data of 05.11.2026, level 40: 82 items of 500 ₽ or more in PvP, 122 in PvE, 55 in Season. The prices are tarkov.dev's, up to about 1.5 hours old: a listing this cheap may be gone, and the page says to check.
- A trader the player has not opened is not known to the app: Jaeger counts as open. He is the best payer on about 15% of the rows.
- No chart under a row, nothing about what the item will do next; a right click marks it as bought, like the other lists.

## The gateway's list

Until 0.6.0.256 the desktop app could not ask for this file: `/v1/data/trading/:mode`, `/v1/data/prices/:mode` and `/v1/data/price-history/…` were not in `ROUTES` of `electron/serviceGateway.ts`, which refuses anything else before it leaves the app. So every player on a PC saw «ещё собирается» from 0.6.0.246 on, in all three modes, with the files on the server; the test builds had the statistics packed inside the exe and could not show it. `electron/serviceGateway.dataRoutes.test.ts` now sends the page's own paths through the real gateway to a real server, and the page says «Не удалось получить статистику» on a failed request. The paths also bring the minute prices to the tier lists and weapon builds, and the data to barters, crafts and the flea market's chart, as they were meant to from the start.

## Added by us, not asked for

Marked in the owner's report: how often past dips paid and how long the wait was; the number of offers; the time of day an item is usually cheaper or dearer (only where the difference is ≥10%; over the PvP items floors run about 5% above the day's level at 02–04 UTC and 2.6% below at 16–18 UTC); profit per stash cell and per rouble; a warning when the last day is 10% under the usual price (it may keep falling); the lowest listing that loses nothing, for the player's own price.

## Figures of 05.11.2026

Candidates: on the market, at least 3 000 ₽, at least 2 offers.

| | PvP | PvE | Season |
| --- | --- | --- | --- |
| On the market / checked (copies alike) | 3 540 / 1 490 | 3 744 / 1 948 | 3 432 / 1 188 |
| Profitable | 559 | 863 | 452 |
| Open at level 15 / 20 / 25 / 30 / 40 | 166 / 287 / 504 / 549 / 559 | 312 / 528 / 803 / 854 / 863 | 136 / 224 / 396 / 440 / 452 |
| Past month: dips, in profit | 5 618, 75% | 9 086, 75% | 5 098, 76% |
| Typical item, usual profit per deal | 4 592 ₽ | 4 846 ₽ | 4 271 ₽ |

Golden egg (level 30, Therapist pays 34 680 ₽): PvP usual 32 000–34 755 ₽, +380 ₽ a deal, hardly worth it; PvE usual 22 300–34 000 ₽, 16 of 17 in profit, +4 680 ₽; Season +2 680 ₽.

## Load

The server builds the file; a player's request only reads it.

- Every 6 hours the published items (about 225 per mode), once a day all candidates, one request at a time with a 300 ms pause: at most about 35 minutes a day and 4 600 requests, then ~2 000 a day more. Measured on the real data on the owner's PC (the VPS is slower): 7.5 CPU seconds for a whole pass (about 0.25% of one core while it runs) and ~320 MB of process memory at its peak, most of it the three datasets being parsed.
- The file: ~320 KB, ~65 KB gzipped. The app asks for it every 3 hours at most while its window is visible.
- Prices come from what the app already fetches: the catalog every 10 minutes, the minute prices only on the page itself. No new polling.
- `RAIDOS_TRADING_STATS=0` turns the pass off; the page then says the statistics are being gathered.

## Risks that remain

- A rising lowest price is not a proof of sale: there is no data on deals. The past month is judged on prices, not on sales.
- **Modules.** The lowest price of a thin market may be one lone listing, and a buyer may take long to come. Trader limits per restock are shown; restock times are not taken into account.
- **Copies that differ.** They are told apart by what tarkov.dev marks; something it does not mark could still slip through, and the lowest price of such an item would again be a worn copy. The swings of what is left have not been checked against listings in the game item by item.
- **«Продажа торговцам».** The cheapest listing goes first, and the price may be up to 1.5 hours old. Whether such listings last long enough to be bought has not been measured.
- Everything is one player's view: many players following one signal would move the price.
- The first pass on a server takes about an hour, then the file exists; until then the page says so.
