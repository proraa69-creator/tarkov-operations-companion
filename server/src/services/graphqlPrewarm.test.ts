import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationGraphqlRequests, GraphqlPrewarm } from './graphqlPrewarm.js'
import { canonicalQuery, checkQueryAllowed, type DataGateway } from './dataGateway.js'

test('GraphQL prewarm covers unique valid app requests for both modes and languages', () => {
  const requests = applicationGraphqlRequests()
  assert.ok(requests.length >= 25)
  assert.ok(requests.some((row) => row.variables?.gameMode === 'regular' && row.variables?.lang === 'ru'))
  assert.ok(requests.some((row) => row.variables?.gameMode === 'pve' && row.variables?.lang === 'en'))
  const keys = requests.map((row) => `${canonicalQuery(row.query)}\0${JSON.stringify(row.variables ?? {})}`)
  assert.equal(new Set(keys).size, keys.length)
  for (const row of requests) assert.ok(checkQueryAllowed(row.query).fields.length > 0)
})

test('GraphQL prewarm tries a failed pass again soon, then stops retrying once everything is there', async () => {
  let calls = 0
  let failing = true
  const gateway = { graphql: async () => { calls += 1; if (failing && calls === 1) throw new Error('upstream timeout'); return '{"data":{}}' } } as unknown as DataGateway
  const logs: string[] = []
  const prewarm = new GraphqlPrewarm(gateway, (message) => logs.push(message), 20)
  const total = applicationGraphqlRequests().length
  prewarm.start(0, 24 * 60 * 60 * 1000)
  try {
    for (let wait = 0; wait < 100 && calls < total * 2; wait += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    failing = false
    assert.equal(calls, total * 2)
    assert.ok(logs.some((line) => /1 failed, retry 1\/6/.test(line)))
    assert.ok(logs.some((line) => line === `GraphQL prewarm: ${total}/${total} snapshots refreshed`))
    // Everything is there: no further retry is scheduled.
    await new Promise((resolve) => setTimeout(resolve, 60))
    assert.equal(calls, total * 2)
  } finally { prewarm.stop() }
})
