import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { trialFeatures } from './trialFeatures.js'

// A made-up player: the real accounts stand in trialFeatures.ts only as hashes (the repository is public).
const PLAYER = 'player.trial@example.com'
const TRIALS = [{ emailSha256: createHash('sha256').update(PLAYER).digest('hex'), feature: 'questTableScan' as const, until: '2026-11-01T20:00:00.000Z' }]

test('turns the quest table reading on for the one account until its end, then off by itself', () => {
  const before = Date.parse('2026-10-31T17:00:00Z')
  assert.deepEqual(trialFeatures(PLAYER, before, undefined, undefined, TRIALS), { questTableScan: '2026-11-01T20:00:00.000Z', mapFloorWheel: null })
  assert.notEqual(trialFeatures(' PLAYER.Trial@example.com ', before, undefined, undefined, TRIALS).questTableScan, null)
  assert.deepEqual(trialFeatures(PLAYER, Date.parse('2026-11-01T20:00:00Z'), undefined, undefined, TRIALS), { questTableScan: null, mapFloorWheel: null })
  assert.deepEqual(trialFeatures(PLAYER, before), { questTableScan: null, mapFloorWheel: null })
  assert.deepEqual(trialFeatures('someone@example.com', before), { questTableScan: null, mapFloorWheel: null })
  assert.deepEqual(trialFeatures(undefined, before), { questTableScan: null, mapFloorWheel: null })
  // Alt + the wheel on the map: one account only, by the hash of its e-mail (owner, 08.11.2026)
  assert.equal(trialFeatures('someone@example.com', Date.parse('2026-11-08T00:00:00Z')).mapFloorWheel, null)
})
