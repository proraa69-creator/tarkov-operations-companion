import assert from 'node:assert/strict'
import test from 'node:test'
import { bootstrapWorkers } from './bootstrapMirror.js'

const worker = (name: string, order: string[], state = 'done') => ({
  async run() { order.push(name) },
  status() { return { state } },
})

test('mirror bootstrap runs datasets, prices, legacy responses and queued history in order', async () => {
  const order: string[] = []
  const result = await bootstrapWorkers({
    datasets: worker('datasets', order),
    prices: worker('prices', order),
    legacyGraphql: worker('legacy', order),
    priceHistory: worker('history', order),
  })
  assert.deepEqual(order, ['datasets', 'prices', 'legacy', 'history'])
  assert.deepEqual(Object.keys(result), ['datasets', 'prices', 'legacyGraphql', 'priceHistory'])
})

test('mirror bootstrap stops before building legacy responses when prices fail', async () => {
  const order: string[] = []
  await assert.rejects(bootstrapWorkers({
    datasets: worker('datasets', order),
    prices: worker('prices', order, 'degraded'),
    legacyGraphql: worker('legacy', order),
  }), /prices: degraded/)
  assert.deepEqual(order, ['datasets', 'prices'])
})
