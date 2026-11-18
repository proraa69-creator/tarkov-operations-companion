import assert from 'node:assert/strict'
import test from 'node:test'
import { layPlayerPrices, PLAYER_PRICE_RULES, PlayerPrices, priceReferences, type PlayerPriceReference } from './playerPrices.js'

const id = (n: number) => `${n}`.padStart(24, 'a')
const START = Date.parse('2026-11-18T15:00:00Z')

function setup(references: Record<string, PlayerPriceReference> = { [id(1)]: { price: 10_000 }, [id(2)]: { price: 50_000 }, [id(3)]: { noFlea: true } }) {
  let clock = START
  const players = new PlayerPrices(() => clock)
  const send = (account: string, rows: Array<{ itemId: string; price: number; seenAt?: number }>, mode: 'regular' | 'pve' | 'pvp-season' = 'pve') =>
    players.submit(account, mode, rows.map((row) => ({ seenAt: clock, ...row })), (itemId) => references[itemId])
  return { players, send, advance: (ms: number) => { clock += ms } }
}

test('player prices: one near the price of the other sources stands at once, in its own mode only, for half an hour', () => {
  const { players, send, advance } = setup()
  assert.deepEqual(send('a', [{ itemId: id(1), price: 9_000 }]), { accepted: 1, pending: 0, rejected: 0 })
  assert.deepEqual([...players.prices('pve')], [[id(1), { price: 9_000, seen: START }]])
  assert.equal(players.prices('regular').size, 0)
  assert.equal(players.prices('pvp-season').size, 0)
  advance(PLAYER_PRICE_RULES.holdMs - 1)
  assert.equal(players.prices('pve').size, 1)
  advance(1)
  assert.equal(players.prices('pve').size, 0)
})

test('player prices: a jump waits for a second account that saw about the same, then stands', () => {
  const { players, send, advance } = setup()
  // 3 000 ₽ where the others say 10 000 ₽: not at once.
  assert.deepEqual(send('a', [{ itemId: id(1), price: 3_000 }]), { accepted: 0, pending: 1, rejected: 0 })
  assert.equal(players.prices('pve').size, 0)
  // The same account again does not confirm itself (and is a repeat within 2 minutes).
  assert.deepEqual(send('a', [{ itemId: id(1), price: 3_000 }]), { accepted: 0, pending: 0, rejected: 1 })
  advance(5 * 60_000)
  // Another account, a price far from the first and outside the band: no confirmation.
  assert.deepEqual(send('b', [{ itemId: id(1), price: 4_000 }]), { accepted: 0, pending: 1, rejected: 0 })
  // A third one within 10 % of the first: both see it — it stands.
  assert.deepEqual(send('c', [{ itemId: id(1), price: 3_100 }]), { accepted: 1, pending: 0, rejected: 0 })
  assert.equal(players.prices('pve').get(id(1))?.price, 3_100)
  // An item no other source knows also needs two accounts.
  assert.deepEqual(send('a', [{ itemId: id(9), price: 777 }]), { accepted: 0, pending: 1, rejected: 0 })
  advance(PLAYER_PRICE_RULES.confirmMs + 1)
  assert.deepEqual(send('b', [{ itemId: id(9), price: 777 }]), { accepted: 0, pending: 1, rejected: 0 }, 'too late to confirm the first')
})

test('player prices: what is not a price is refused: banned on the flea, malformed, too old, from the future, over the limit', () => {
  const { send, advance } = setup()
  assert.equal(send('a', [{ itemId: id(3), price: 100 }]).rejected, 1)
  assert.equal(send('a', [{ itemId: 'not-an-id', price: 100 }]).rejected, 1)
  assert.equal(send('a', [{ itemId: id(2), price: 0 }, { itemId: id(2), price: 1.5 }, { itemId: id(2), price: -5 }]).rejected, 3)
  assert.equal(send('a', [{ itemId: id(2), price: 50_000, seenAt: START - PLAYER_PRICE_RULES.maxAgeMs - 1 }]).rejected, 1)
  assert.equal(send('a', [{ itemId: id(2), price: 50_000, seenAt: START + PLAYER_PRICE_RULES.maxAheadMs + 1 }]).rejected, 1)
  const many = Array.from({ length: 200 }, (_, n) => ({ itemId: id(100 + n), price: 1000 }))
  const first = send('b', many)
  assert.equal(first.accepted + first.pending + first.rejected, PLAYER_PRICE_RULES.perRequest, 'one request holds a screen or two')
  for (let n = 0; n < 10; n += 1) { advance(1000); send('b', many.slice(n * 24, n * 24 + 24).map((row) => ({ ...row, itemId: id(1000 + n * 24 + Number(row.itemId.slice(-3))) }))) }
  advance(1000)
  assert.equal(send('b', [{ itemId: id(1), price: 10_000 }]).rejected, 1, `${PLAYER_PRICE_RULES.perHour} an hour`)
  advance(60 * 60_000)
  assert.equal(send('b', [{ itemId: id(1), price: 10_000 }]).accepted, 1, 'the next hour')
})

test('player prices: an account often outside the band loses «at once», others keep it', () => {
  const { send, advance } = setup()
  for (let n = 0; n < PLAYER_PRICE_RULES.oddCount; n += 1) {
    send('liar', [{ itemId: id(1), price: 100 }])
    advance(PLAYER_PRICE_RULES.repeatMs)
  }
  advance(PLAYER_PRICE_RULES.confirmMs + 1)
  assert.deepEqual(send('liar', [{ itemId: id(2), price: 50_000 }]), { accepted: 0, pending: 1, rejected: 0 })
  assert.deepEqual(send('honest', [{ itemId: id(2), price: 51_000 }]), { accepted: 1, pending: 0, rejected: 0 })
})

test('player prices: the status counts the last hour by mode, without accounts', () => {
  const { players, send } = setup()
  send('a', [{ itemId: id(1), price: 10_000 }, { itemId: id(3), price: 5 }])
  send('b', [{ itemId: id(2), price: 1 }], 'regular')
  assert.deepEqual(players.status(), { state: 'done', lastHour: { pve: { received: 2, accepted: 1, pending: 0, rejected: 1, standing: 1 }, regular: { received: 1, accepted: 0, pending: 1, rejected: 0, standing: 0 } } })
  assert.doesNotMatch(JSON.stringify(players.status()), /"a"|"b"/)
})

test('player prices: laid over the prices file, the references taken from it before', () => {
  const file = JSON.stringify({ mode: 'pve', items: { [id(1)]: { lastLowPrice: 10_000, avg24hPrice: 11_000, at: 1 }, [id(2)]: { avg24hPrice: 40_000 }, [id(3)]: { noFlea: true } } })
  assert.deepEqual(Object.fromEntries(priceReferences(file)), { [id(1)]: { price: 10_000 }, [id(2)]: { price: 40_000 }, [id(3)]: { noFlea: true } })
  const seen = Date.parse('2026-11-18T15:07:30Z')
  const laid = JSON.parse(layPlayerPrices(file, new Map([[id(1), { price: 9_000, seen }], [id(3), { price: 5, seen }], [id(4), { price: 5, seen }]])))
  assert.deepEqual(laid.items[id(1)], { lastLowPrice: 9_000, avg24hPrice: 11_000, at: Math.floor(seen / 60_000) })
  assert.deepEqual(laid.items[id(3)], { noFlea: true })
  assert.equal(laid.items[id(4)], undefined)
  assert.equal(layPlayerPrices(file, new Map()), file)
})
