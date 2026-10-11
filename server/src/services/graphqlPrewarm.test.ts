import assert from 'node:assert/strict'
import test from 'node:test'
import { applicationGraphqlRequests } from './graphqlPrewarm.js'
import { canonicalQuery, checkQueryAllowed } from './dataGateway.js'

test('GraphQL prewarm covers unique valid app requests for both modes and languages', () => {
  const requests = applicationGraphqlRequests()
  assert.ok(requests.length >= 25)
  assert.ok(requests.some((row) => row.variables?.gameMode === 'regular' && row.variables?.lang === 'ru'))
  assert.ok(requests.some((row) => row.variables?.gameMode === 'pve' && row.variables?.lang === 'en'))
  const keys = requests.map((row) => `${canonicalQuery(row.query)}\0${JSON.stringify(row.variables ?? {})}`)
  assert.equal(new Set(keys).size, keys.length)
  for (const row of requests) assert.ok(checkQueryAllowed(row.query).fields.length > 0)
})
