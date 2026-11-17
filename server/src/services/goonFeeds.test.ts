import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { MemoryGoonStore, SqliteGoonStore, summarizeGoons } from './goonStore.js'
import { feedNickname, importFeedSightings, parseMinutesAgoFeed, parseNextDataFeed, readGoonFeeds, type FeedFetch, type GoonFeed } from './goonFeeds.js'

const NOW = Date.parse('2026-11-17T10:00:30.000Z')

test('report 180: a minutes-ago list becomes PvP sightings with nicknames, to the minute', () => {
  const body = JSON.stringify({ data: [
    { reporter: 'LoyS', location: 'lighthouse', created: 4, created_at: '12:56', name: 'Маяк' },
    { reporter: 'monkite|TTV', location: 'customs', created: 90 },
    { reporter: 'tarkov.help', location: 'shoreline', created: 120 },
    { reporter: 'x', location: 'factory', created: 1 },
  ] })
  assert.deepEqual(parseMinutesAgoFeed(body, NOW), [
    { mode: 'pvp', mapId: 'lighthouse', reportedAt: '2026-11-17T09:56:00.000Z', nickname: 'LoyS' },
    { mode: 'pvp', mapId: 'customs', reportedAt: '2026-11-17T08:30:00.000Z', nickname: 'monkite' },
    // a tracker's own name is not shown; a map without Goons is dropped
    { mode: 'pvp', mapId: 'shoreline', reportedAt: '2026-11-17T08:00:00.000Z' },
  ])
  assert.deepEqual(parseMinutesAgoFeed('<html>', NOW), [])
})

test('report 180: a Next.js page gives the mode it is about; a row that is not a sighting is skipped', () => {
  const data = { props: { pageProps: { trackings: [
    { username: 'bot-tp', map: { name: 'Watch a stream', slug: 'some-stream' }, currentDate: 'Invalid Date' },
    { username: 'Tripify', map: { slug: 'customs' }, currentDate: '2026-11-17T04:42:05Z' },
    { username: 'goons shibal', map: { slug: 'woods' }, currentDate: '2026-11-17T08:27:42Z' },
  ] } } }
  const page = `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script></html>`
  assert.deepEqual(parseNextDataFeed('pve')(page), [
    { mode: 'pve', mapId: 'customs', reportedAt: '2026-11-17T04:42:05.000Z', nickname: 'Tripify' },
    { mode: 'pve', mapId: 'woods', reportedAt: '2026-11-17T08:27:42.000Z' },
  ])
})

test('report 180: nicknames shown only when they look like EFT ones and are not rude', () => {
  assert.equal(feedNickname('Kunder_Thunt'), 'Kunder_Thunt')
  assert.equal(feedNickname('Вася-01'), 'Вася-01')
  assert.equal(feedNickname('Ace_Of_Spades87 '), 'Ace_Of_Spades87')
  for (const name of ['DickPole', 'bot-tp', 'a', 'two words', '<b>x</b>', 42]) assert.equal(feedNickname(name), undefined, String(name))
})

test('report 180: read again, from another tracker or reported in the app — one sighting; PvP and PvE apart', () => {
  const store = new MemoryGoonStore()
  // a player of ours reported it in the app
  store.add({ mapId: 'woods', mode: 'pvp', reportedAt: '2026-11-17T09:50:00.000Z', reporter: 'acc', nickname: 'Eremor', account: 'a1' })
  const list = [
    { mode: 'pvp' as const, mapId: 'woods' as const, reportedAt: '2026-11-17T09:51:00.000Z', nickname: 'eremor' },
    { mode: 'pvp' as const, mapId: 'customs' as const, reportedAt: '2026-11-17T09:40:00.000Z', nickname: 'LoyS' },
    { mode: 'pve' as const, mapId: 'customs' as const, reportedAt: '2026-11-17T09:40:00.000Z', nickname: 'LoyS' },
    { mode: 'pvp' as const, mapId: 'shoreline' as const, reportedAt: '2026-11-16T09:00:00.000Z', nickname: 'Old' },
    { mode: 'pvp' as const, mapId: 'shoreline' as const, reportedAt: '2026-11-17T09:30:00.000Z' },
  ]
  assert.equal(importFeedSightings(store, 'feed:a', list, NOW), 3)
  // the next round reads the same list a minute later, the times a minute on
  const later = list.map((entry) => ({ ...entry, reportedAt: new Date(Date.parse(entry.reportedAt) + 60_000).toISOString() }))
  assert.equal(importFeedSightings(store, 'feed:a', later, NOW + 60_000), 0)
  const pvp = summarizeGoons(store, 'pvp', NOW)
  // the older one from a feed sits in its place in time: the newest is still ours
  assert.deepEqual(pvp.latest, { mapId: 'woods', reportedAt: '2026-11-17T09:50:00.000Z', nickname: 'Eremor' })
  assert.deepEqual(pvp.recent.map((entry) => `${entry.mapId} ${entry.nickname ?? '—'}`), ['woods Eremor', 'customs LoyS', 'shoreline —'])
  assert.deepEqual(summarizeGoons(store, 'pve', NOW).recent.map((entry) => entry.mapId), ['customs'])
})

test('report 180: SQLite keeps feed sightings in time order with the rest', () => {
  const store = new SqliteGoonStore(new DatabaseSync(':memory:'))
  store.add({ mapId: 'woods', mode: 'pvp', reportedAt: '2026-11-17T09:50:00.000Z', reporter: 'acc', nickname: 'Eremor' })
  importFeedSightings(store, 'feed:b', [{ mode: 'pvp', mapId: 'lighthouse', reportedAt: '2026-11-17T09:55:00.000Z', nickname: 'LoyS' }, { mode: 'pvp', mapId: 'customs', reportedAt: '2026-11-17T08:00:00.000Z' }], NOW)
  assert.deepEqual(summarizeGoons(store, 'pvp', NOW).recent.map((entry) => entry.mapId), ['lighthouse', 'woods', 'customs'])
})

test('report 180: a round reads every feed, a failing one does not stop the rest, the apps are told once', async () => {
  const store = new MemoryGoonStore()
  const feeds: GoonFeed[] = [
    { key: 'feed:a', url: 'https://a.test/list', parse: parseMinutesAgoFeed },
    { key: 'feed:x', url: 'https://x.test/down', parse: parseMinutesAgoFeed },
    { key: 'feed:b', url: 'https://b.test/list', parse: parseMinutesAgoFeed },
  ]
  const bodies: Record<string, string> = {
    'https://a.test/list': JSON.stringify({ data: [{ reporter: 'LoyS', location: 'lighthouse', created: 4 }] }),
    'https://b.test/list': JSON.stringify({ data: [{ reporter: 'Qvim', location: 'customs', created: 30 }] }),
  }
  const fetch: FeedFetch = async (url) => {
    if (!bodies[url]) throw new Error('offline')
    return { ok: true, status: 200, text: async () => bodies[url]! }
  }
  let told = 0
  const logged: string[] = []
  assert.equal(await readGoonFeeds({ store, feeds, fetch, now: () => NOW, onImported: () => { told += 1 }, log: (line) => logged.push(line) }), 2)
  assert.equal(told, 1)
  assert.deepEqual(logged, ['Goon feed feed:x: offline'])
  assert.equal(await readGoonFeeds({ store, feeds, fetch, now: () => NOW + 60_000, onImported: () => { told += 1 } }), 0)
  assert.equal(told, 1)
})

test('owner 17.11.2026: one nickname spamming — only the first of 50 minutes is shown, on any map; then the next', () => {
  const store = new MemoryGoonStore()
  const at = (minutes: number) => new Date(Date.parse('2026-11-17T09:00:00.000Z') + minutes * 60_000).toISOString()
  const add = (minutes: number, mapId: 'woods' | 'customs' | 'shoreline', nickname?: string, reporter = 'feed:a') =>
    store.add({ mapId, mode: 'pvp', reportedAt: at(minutes), reporter, ...(nickname ? { nickname } : {}) })
  add(0, 'woods', 'Spammer')
  add(5, 'woods', 'spammer')
  add(12, 'customs', 'Spammer')
  add(49, 'shoreline', 'Spammer')
  add(20, 'customs', 'Other')
  add(55, 'shoreline', 'Spammer')
  // without a nickname: by who sent it and the map
  add(30, 'woods')
  add(31, 'woods')
  add(32, 'customs')
  const view = summarizeGoons(store, 'pvp', Date.parse(at(60)))
  assert.deepEqual(view.recent.map((entry) => `${entry.reportedAt.slice(11, 16)} ${entry.mapId} ${entry.nickname ?? '—'}`), [
    '09:55 shoreline Spammer', '09:32 customs —', '09:30 woods —', '09:20 customs Other', '09:00 woods Spammer',
  ])
  assert.deepEqual(view.last5h.map((row) => [row.mapId, row.count]), [['customs', 2], ['woods', 2], ['shoreline', 1]])
})
