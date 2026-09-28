import { describe, expect, it } from 'vitest'
import { buildWikiLandmarks, buildWikiQuestPins } from './wikiQuestPins'
import type { MapMarker, Quest } from '../domain/types'

const wetJob: Quest = {
  id: '5a27bbf886f774333a418eeb',
  name: 'Мокрое дело. Часть 2',
  trader: 'Миротворец',
  mapId: 'shoreline',
  level: 14,
  kappa: true,
  description: '',
  objectives: ['Пометить стол'],
  rewards: [],
}

const wikiCopy: Quest = {
  ...wetJob,
  id: 'wiki:мокроеделочасть2',
  trader: 'Escape from Tarkov Wiki',
}

describe('wiki quest pin lookup', () => {
  it('uses live zone coordinates even when the clicked card is a wiki duplicate', () => {
    const markers: MapMarker[] = [
      {
        id: 'shoreline-quest-zone-wet',
        mapId: 'shoreline',
        type: 'quest',
        title: 'Мокрое дело. Часть 2',
        description: 'Пометить рыболовный стол.',
        position: [442.02, 235.56],
        questId: '5a27bbf886f774333a418eeb',
        source: 'json.tarkov.dev/tasks',
      },
      {
        id: 'shoreline-quest-fallback-wiki',
        mapId: 'shoreline',
        type: 'quest',
        title: 'Мокрое дело. Часть 2',
        description: 'Актуальное задание на этой карте.',
        position: [0, 0],
        questId: 'wiki:мокроеделочасть2',
        source: 'quest-fallback',
      },
    ]
    const pins = buildWikiQuestPins({
      mapId: 'shoreline',
      markers,
      quests: [wetJob, wikiCopy],
      selectedQuestId: 'wiki:мокроеделочасть2',
    })
    expect(pins).toHaveLength(1)
    expect(pins[0]?.x).toBeCloseTo(235.56)
    expect(pins[0]?.z).toBeCloseTo(442.02)
    expect(pins[0]?.focused).toBe(true)
  })

  it('adds English extract aliases so Wiki titles can match', () => {
    const landmarks = buildWikiLandmarks([
      {
        id: 'ex',
        mapId: 'shoreline',
        type: 'extract',
        title: 'Tunnel',
        description: '',
        position: [319.25, 376.36],
      },
    ], 'shoreline')
    expect(landmarks.map((entry) => entry.name)).toEqual(expect.arrayContaining(['Tunnel', 'тоннель']))
  })
})
