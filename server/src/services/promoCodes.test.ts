import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import { agreedPromoCodes, ANNOUNCED_PROMO_CODES, checkPromoCodes, parsePromoPage, PROMO_SOURCES, PromoCodeStore } from './promoCodes.js'

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
  const store = new PromoCodeStore(new DatabaseSync(':memory:'), () => at)
  return { store, move: (ms: number) => { at += ms } }
}

test('the store: the first batch is marked, later codes are news with their own date; a code no page lists for a day goes', () => {
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
  assert.deepEqual(store.list([]).map((row) => row.code), ['NEWONE'])
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
  assert.deepEqual(store.list(announced), [], 'over, and no page lists it any more')
  assert.deepEqual(ANNOUNCED_PROMO_CODES.map((entry) => [entry.code, entry.mode]), [['PLAYYOURWAY', 'pve'], ['EMBRACEPAIN', 'pvp-season']])
})
