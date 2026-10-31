import { test } from 'node:test'
import assert from 'node:assert/strict'
import { trialFeatures } from './trialFeatures.js'

test('turns the quest table reading on for the one account until its end, then off by itself', () => {
  const before = Date.parse('2026-10-31T17:00:00Z')
  assert.deepEqual(trialFeatures('3216164vaio@gmail.com', before), { questTableScan: '2026-11-01T20:00:00.000Z' })
  assert.notEqual(trialFeatures(' 3216164VAIO@gmail.com ', before).questTableScan, null)
  assert.deepEqual(trialFeatures('3216164vaio@gmail.com', Date.parse('2026-11-01T20:00:00Z')), { questTableScan: null })
  assert.deepEqual(trialFeatures('someone@example.com', before), { questTableScan: null })
  assert.deepEqual(trialFeatures(undefined, before), { questTableScan: null })
})
