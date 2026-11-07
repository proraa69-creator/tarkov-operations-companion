import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllFoundDocuments, clearFoundDocuments, clearFoundDocumentsOfProfile, dropExpiredFoundDocuments, FOUND_MAX_MS, markDocumentFound, readFoundDocuments, watchRaidEnds,
} from './foundDocuments'
import type { RaidState } from '../import/raidState'

/** A raid state source the test drives. */
function source(first: RaidState) {
  let send: (state: RaidState) => void = () => {}
  return {
    getRaidState: () => Promise.resolve(first),
    onRaidStateChanged: (callback: (state: RaidState) => void) => { send = callback; return () => { send = () => {} } },
    send: (state: RaidState) => send(state),
  }
}

describe('«Нашёл» on a battle pass document', () => {
  beforeEach(() => localStorage.clear())

  it('is kept per profile and mode, PvP, PvE and Season apart', () => {
    markDocumentFound('p1', 'pvp', 'customs-battle-pass-documents-3', 1000)
    expect([...readFoundDocuments('p1', 'pvp').keys()]).toEqual(['customs-battle-pass-documents-3'])
    expect(readFoundDocuments('p1', 'pve').size).toBe(0)
    expect(readFoundDocuments('p2', 'pvp').size).toBe(0)
  })

  it('«Вернуть найденные» brings this mode back; the raid\'s end brings every mode of the profile back', () => {
    for (const mode of ['pvp', 'pve', 'seasonal'] as const) markDocumentFound('p1', mode, 'a')
    markDocumentFound('p2', 'pvp', 'a')
    clearFoundDocuments('p1', 'pvp')
    expect(readFoundDocuments('p1', 'pvp').size).toBe(0)
    expect(readFoundDocuments('p1', 'pve').size).toBe(1)
    clearFoundDocumentsOfProfile('p1')
    expect(readFoundDocuments('p1', 'pve').size).toBe(0)
    expect(readFoundDocuments('p1', 'seasonal').size).toBe(0)
    expect(readFoundDocuments('p2', 'pvp').size).toBe(1)
    clearAllFoundDocuments()
    expect(readFoundDocuments('p2', 'pvp').size).toBe(0)
  })

  it('where no raid can be seen it ends with the time, longer than any raid', () => {
    markDocumentFound('p1', 'pvp', 'old', 1000)
    markDocumentFound('p1', 'pvp', 'new', 1000 + FOUND_MAX_MS - 1)
    dropExpiredFoundDocuments('p1', 'pvp', 1000 + FOUND_MAX_MS)
    expect([...readFoundDocuments('p1', 'pvp').keys()]).toEqual(['new'])
  })

  it('a damaged value reads as nothing found', () => {
    localStorage.setItem('raidos-found-documents-v1:p1:pvp', '{oops')
    expect(readFoundDocuments('p1', 'pvp').size).toBe(0)
  })
})

describe('the end of a raid', () => {
  it('comes when «in raid» turns off, not while the raid goes on', async () => {
    const onEnd = vi.fn()
    const raid = source({ inRaid: true, since: 1, tracked: true })
    const stop = watchRaidEnds(raid, onEnd)
    await Promise.resolve()
    raid.send({ inRaid: true, since: 2, tracked: true })
    expect(onEnd).not.toHaveBeenCalled()
    raid.send({ inRaid: false, tracked: true })
    expect(onEnd).toHaveBeenCalledTimes(1)
    raid.send({ inRaid: false, tracked: true })
    expect(onEnd).toHaveBeenCalledTimes(1)
    stop()
  })

  it('an app opened after the raid clears what was left; logs not followed say nothing', async () => {
    const opened = vi.fn()
    watchRaidEnds(source({ inRaid: false, tracked: true }), opened)
    await Promise.resolve()
    await Promise.resolve()
    expect(opened).toHaveBeenCalledTimes(1)

    const unknown = vi.fn()
    const raid = source({ inRaid: false })
    watchRaidEnds(raid, unknown)
    await Promise.resolve()
    await Promise.resolve()
    expect(unknown).not.toHaveBeenCalled()
    // Menu → raid → menu is a real end, once the logs are followed.
    raid.send({ inRaid: true, since: 1, tracked: true })
    raid.send({ inRaid: false, tracked: true })
    expect(unknown).toHaveBeenCalledTimes(1)
  })
})
