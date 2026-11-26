import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { agreedPromoCodes, ANNOUNCED_PROMO_CODES, checkPromoChannels, checkPromoCodes, parseChannelFeed, parsePromoPage, PROMO_SOURCES, PromoCodeStore, PromoListWatch } from './promoCodes.js'

const SOURCE = { from: /^all codes/i, to: /^(how to|expired)/i }

const LIST_PAGE = `<h1>Codes</h1><h2>All codes (November)</h2>
<ul><li><strong>WIPE</strong> – a helmet <em>[PvP Season (Kord Breach)]</em></li>
<li><strong>INVEN</strong> – a kit <em>[PvE Zone]</em></li>
<li><strong>PAY2WIN</strong>: Free Rewards <button>Copy</button></li>
<li><strong>Free stuff</strong> is not a code</li></ul>
<h2>Expired codes</h2><ul><li><strong>OLDCODE</strong></li></ul>`

const TABLE_PAGE = `<h2>All codes</h2><table><tr><th>Код</th></tr>
<tr><td class="x">WIPE</td><td>Награды</td></tr><tr><td>GOONSQUAD</td><td>Награды</td></tr></table><h2>How to redeem</h2><table><tr><td>NOTACODE</td></tr></table>`

test('reads a list and a table between the headings; expired codes and other parts stay out', () => {
  assert.deepEqual(parsePromoPage(LIST_PAGE, SOURCE), [{ code: 'WIPE', mode: 'season' }, { code: 'INVEN', mode: 'pve' }, { code: 'PAY2WIN' }])
  assert.deepEqual(parsePromoPage(TABLE_PAGE, SOURCE).map((row) => row.code), ['WIPE', 'GOONSQUAD'])
  assert.deepEqual(parsePromoPage('<h2>Nothing here</h2>', SOURCE), [])
})

test('the mode by the sub-heading a code stands under', () => {
  const page = '<h2>All codes</h2><h3>PvE Zone codes</h3><ul><li><strong>INVEN</strong></li></ul><h3>PvP Zone codes</h3><ul><li><strong>LIGHTSOUT</strong></li></ul><h2>How to</h2>'
  assert.deepEqual(parsePromoPage(page, SOURCE), [{ code: 'INVEN', mode: 'pve' }, { code: 'LIGHTSOUT', mode: 'pvp' }])
})

test('a code counts once two pages list it', () => {
  assert.deepEqual(agreedPromoCodes([[{ code: 'WIPE', mode: 'season' }, { code: 'ONLYHERE' }], [{ code: 'WIPE' }]]), [{ code: 'WIPE', mode: 'season' }])
})

function setup() {
  let at = Date.parse('2026-11-06T10:00:00Z')
  const db = new DatabaseSync(':memory:')
  const store = new PromoCodeStore(db, () => at)
  return { store, db, now: () => at, move: (ms: number) => { at += ms } }
}

test('the store: the first batch is marked, later codes are news with their own date; a code once added stays (owner, 25.11.2026)', () => {
  const { store, move } = setup()
  assert.deepEqual(store.update([{ code: 'WIPE', mode: 'season' }]), ['WIPE'])
  assert.equal(store.list([])[0]!.first, true)
  move(2 * 60 * 60 * 1000)
  assert.deepEqual(store.update([{ code: 'WIPE' }, { code: 'NEWONE' }]), ['NEWONE'])
  const [newest, older] = store.list([])
  assert.equal(newest!.code, 'NEWONE')
  assert.equal(newest!.first, undefined)
  assert.equal(newest!.addedAt, '2026-11-06T12:00:00.000Z')
  assert.equal(older!.mode, 'season')
  move(25 * 60 * 60 * 1000)
  store.update([{ code: 'NEWONE' }])
  assert.deepEqual(store.list([]).map((row) => row.code), ['NEWONE', 'WIPE'], 'no page lists WIPE any more: it stays')
})

test('a check: pages that fail do not count, fewer than two answers change nothing, new codes are told', async () => {
  const { store } = setup()
  const sources = [{ id: 'a', url: 'https://a.test/', ...SOURCE }, { id: 'b', url: 'https://b.test/', ...SOURCE }]
  const down = (async () => new Response('', { status: 503 })) as typeof fetch
  assert.deepEqual(await checkPromoCodes(store, { fetch: down, sources }), { answered: 0, added: [] })
  const told: string[][] = []
  const pages = (async (url: string | URL | Request) => new Response(String(url).includes('a.test') ? LIST_PAGE : TABLE_PAGE)) as typeof fetch
  const result = await checkPromoCodes(store, { fetch: pages, sources, onNew: (codes) => told.push(codes) })
  assert.equal(result.answered, 2)
  assert.deepEqual(result.added, ['WIPE'])
  assert.deepEqual(told, [['WIPE']])
})

test('report №99: a page that marks its codes <em><strong> and puts «might have expired» under the same heading', () => {
  const source = PROMO_SOURCES.find((entry) => entry.id === 'insider-gaming')!
  const page = '<h2>All Active Escape from Tarkov Codes</h2><p><strong>Confirmed Active Escape from Tarkov Codes</strong></p>'
    + '<ul><li><strong><em>UNDEADTARKOV</em></strong></li><li><em><strong>EMBRACEPAIN</strong></em></li><li><em><strong>PLAYYOURWAY</strong></em></li></ul>'
    + '<p><strong>Escape from Tarkov Codes That Might Have Expired</strong></p><ul><li><strong>SUDAKTUDAK</strong></li></ul><h2>How to Redeem Escape from Tarkov Codes</h2>'
  assert.deepEqual(parsePromoPage(page, source).map((row) => row.code), ['UNDEADTARKOV', 'EMBRACEPAIN', 'PLAYYOURWAY'])
})

test('report №99: the studio\'s own codes show at once, for their time, in their mode', () => {
  const { store, move } = setup()
  const announced = [{ code: 'EMBRACEPAIN', mode: 'pvp-season' as const, from: '2026-11-07T12:00:00Z', until: '2026-11-21T00:00:00Z' }]
  assert.deepEqual(store.list(announced), [], 'not before it was posted')
  move(30 * 60 * 60 * 1000)
  assert.deepEqual(store.list(announced), [{ code: 'EMBRACEPAIN', mode: 'pvp-season', addedAt: '2026-11-07T12:00:00.000Z' }])
  // the pages list it as PvP only: it keeps «PvP и Сезон» and the day it was posted, once
  store.update([{ code: 'EMBRACEPAIN', mode: 'pvp' }, { code: 'OTHER' }])
  assert.deepEqual(store.list(announced).map((row) => [row.code, row.mode]), [['OTHER', undefined], ['EMBRACEPAIN', 'pvp-season']])
  move(20 * 24 * 60 * 60 * 1000)
  assert.deepEqual(store.list(announced).map((row) => row.code), ['OTHER', 'EMBRACEPAIN'], 'past its time and no page lists it: it stays')
  assert.deepEqual(ANNOUNCED_PROMO_CODES.map((entry) => [entry.code, entry.mode]), [['PLAYYOURWAY', 'pve'], ['EMBRACEPAIN', 'pvp-season']])
})

// «Тарковское Метадвижение» through its RSS mirror (owner, 18.11.2026): two real posts, cut short, and one that is no code
const FEED = `<rss><channel><title>Тарковское Метадвижение</title>
<item><title>[Photo] 👀 Технический промокод из нового лонгрида</title><description>&lt;b&gt; Технический промокод из нового лонгрида&lt;/b&gt;&lt;br&gt;&lt;br&gt;Набор можно найти в большой статье &lt;a href="https://80.lv/"&gt;80 LEVEL&lt;/a&gt;, где разработчики раскрывают создание локации Терминал.&lt;br&gt;&lt;br&gt;&lt;tg-emoji emoji-id="5199749070830197566"&gt;🎁&lt;/tg-emoji&gt; &lt;code&gt;READ80LV&lt;/code&gt;&lt;br&gt;&lt;br&gt;#EscapefromTarkov #EFT</description><pubDate>Tue, 17 Nov 2026 18:28:49 +0300</pubDate></item>
<item><title>[Photo] 👀 Новый промокод от разработчиков</title><description>&lt;b&gt;Новый промокод от разработчиков&lt;/b&gt;&lt;br&gt;&lt;br&gt;Добротный подгон только для PvE-режима.&lt;br&gt;&lt;br&gt;&lt;tg-emoji&gt;🎁&lt;/tg-emoji&gt; &lt;code&gt;9GAG&lt;br&gt;&lt;/code&gt;&lt;br&gt;#EscapefromTarkov #EFT</description><pubDate>Sat, 14 Nov 2026 16:46:28 +0300</pubDate></item>
<item><title>Ледокол</title><description>Новая локация &lt;b&gt;ICEBREAKER&lt;/b&gt; 🎁 подарки на месте</description><pubDate>Sat, 14 Nov 2026 10:00:00 +0300</pubDate></item>
<item><title>Старый</title><description>Промокод 🎁 &lt;code&gt;OLDCODE&lt;/code&gt;</description><pubDate>Mon, 19 Oct 2026 10:00:00 +0300</pubDate></item>
</channel></rss>`
const FEED_DAY = Date.parse('2026-11-18T06:00:00Z')

test('the channel posts about codes: the code after 🎁 or in <code>, the mode the post says, two weeks from the post; other and old posts stay out', () => {
  const now = Date.parse('2026-11-18T06:00:00Z')
  assert.deepEqual(parseChannelFeed(FEED, now), [
    { code: 'READ80LV', until: Date.parse('2026-12-01T15:28:49Z') },
    { code: '9GAG', mode: 'pve', until: Date.parse('2026-11-28T13:46:28Z') },
  ])
})

test('a check takes the channel code at once, with no second page, and keeps it to its own date', async () => {
  const { store, move } = setup()
  const feedOnly = (async (url: string | URL | Request) => String(url).includes('rss') ? new Response(FEED) : new Response('', { status: 503 })) as typeof fetch
  const channels = [{ id: 'metadvij', url: 'https://feed.test/rss/metadvij' }]
  // the posts measured by the feed's own day, not today's: the real clock dropped 9GAG from 28.11.2026 on
  const result = await checkPromoCodes(store, { fetch: feedOnly, sources: [], channels, now: () => FEED_DAY })
  assert.equal(result.answered, 0)
  assert.deepEqual(result.added.sort(), ['9GAG', 'READ80LV'])
  // not in the feed any more and no page lists it: still shown to its post's date and a day after
  move(10 * 24 * 60 * 60 * 1000)
  store.update([])
  assert.ok(store.list([]).some((row) => row.code === 'READ80LV'))
})

test('the fresher pages (25.11.2026): the Dexerto table and the Timesaver list between their headings', () => {
  const dexerto = PROMO_SOURCES.find((source) => source.id === 'dexerto')!
  const timesaver = PROMO_SOURCES.find((source) => source.id === 'timesaver')!
  const dex = `<h2>Active Escape from Tarkov codes</h2><table><tr><th>Code</th><th>Reward</th></tr><tr><td>READ80LV</td><td>Items</td></tr><tr><td>1YEAROFESCAPING</td><td>PvE rifle</td></tr></table><h2>Escape from Tarkov discounts</h2><table><tr><td>ANNIVERSARY</td></tr></table><h2>List of expired codes</h2><ul><li><strong>KANISTRA</strong></li></ul>`
  assert.deepEqual(parsePromoPage(dex, dexerto).map((entry) => entry.code), ['READ80LV', '1YEAROFESCAPING'])
  const ts = `<h2>Which Tarkov codes are active right now (November 2026)?</h2><ul><li><strong>9GAG</strong> — PvE</li><li><strong>EMBRACEPAIN</strong> — PvP Zone</li></ul><h2>How do you redeem Escape from Tarkov codes?</h2><ul><li><strong>NOTACODE</strong></li></ul>`
  assert.deepEqual(parsePromoPage(ts, timesaver).map((entry) => entry.code), ['9GAG', 'EMBRACEPAIN'])
})

test('the channel alone every 15 minutes (owner, 26.11.2026): a code new to the list is added and told at once; a known one keeps its mode', async () => {
  const { store } = setup()
  store.update([{ code: 'WIPE', mode: 'season' }])
  store.update([{ code: '9GAG', mode: 'pvp' }])
  const channels = [{ id: 'metadvij', url: 'https://feed.test/rss/metadvij' }]
  const feed = (async () => new Response(FEED)) as typeof fetch
  const now = () => FEED_DAY
  const told: string[][] = []
  assert.deepEqual(await checkPromoChannels(store, { fetch: feed, channels, now, onNew: (codes) => told.push(codes) }), { added: ['READ80LV'] })
  assert.deepEqual(told, [['READ80LV']])
  assert.equal(store.list([]).find((row) => row.code === '9GAG')!.mode, 'pvp', 'the post says PvE: the mode it has stays')
  assert.deepEqual(await checkPromoChannels(store, { fetch: feed, channels, now, onNew: (codes) => told.push(codes) }), { added: [] })
  assert.equal(told.length, 1, 'told once')
  const lines: string[] = []
  const down = (async () => { throw new TypeError('fetch failed') }) as typeof fetch
  assert.deepEqual(await checkPromoChannels(store, { fetch: down, channels, now, log: (line) => lines.push(line) }), { added: [] })
  assert.deepEqual(lines, ['promo codes: metadvij TypeError: fetch failed'])
})

test('the list watched (owner, 26.11.2026): a code put straight into the table by hand, or a studio code\'s hour, is told to the open apps once', () => {
  const { store, db, now, move } = setup()
  store.update([{ code: 'WIPE' }])
  const studio = [{ code: 'STUDIO', mode: 'pve' as const, from: '2026-11-06T11:00:00Z', until: '2026-11-20T00:00:00Z' }]
  let told = 0
  const watch = new PromoListWatch(store, () => { told += 1 }, studio)
  assert.equal(watch.check(), false, 'nothing moved')
  db.prepare('INSERT INTO promo_codes (code, mode, first_seen_at, last_seen_at, first_batch) VALUES (?, NULL, ?, ?, 0)').run('BYHAND', now(), now())
  assert.equal(watch.check(), true, 'the code added by hand')
  assert.equal(watch.check(), false, 'told once')
  move(2 * 60 * 60 * 1000)
  assert.equal(watch.check(), true, 'the studio code\'s hour')
  store.update([{ code: 'WIPE' }])
  assert.equal(watch.check(), false, 'a code seen again changes nothing the apps show')
  assert.equal(told, 2)
})
