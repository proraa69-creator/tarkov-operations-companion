import { describe, expect, it } from 'vitest'
import { adaptStoryQuestMarkers } from './storyQuestMarkers'
import { maps } from './demo'
import type { Quest } from '../domain/types'

describe('story quest markers', () => {
  it('places a story stage on the mentioned map using a matching landmark', () => {
    const quests: Quest[] = [{
      id: 'story-tour',
      kind: 'story',
      name: 'Тур',
      trader: 'Глава истории',
      level: 1,
      kappa: false,
      description: '',
      objectives: [],
      rewards: [],
      stages: [{
        id: 's1',
        title: 'Терминал',
        description: 'Интерком у вышки',
        mapIds: ['shoreline'],
        landmarkHints: ['интерком'],
      }],
    }]
    const landmarks = [
      { id: 'shore-intercom', mapId: 'shoreline', type: 'extract' as const, title: 'Интерком Терминала', description: 'Сторожевая вышка', position: [120, 880] as [number, number] },
    ]
    const markers = adaptStoryQuestMarkers(quests, maps, landmarks)
    expect(markers).toHaveLength(1)
    expect(markers[0]?.mapId).toBe('shoreline')
    expect(markers[0]?.questId).toBe('story-tour')
    expect(markers[0]?.stageIndex).toBe(0)
    expect(markers[0]?.position).toEqual([120, 880])
    expect(markers[0]?.source).toBe('tarkov-wiki/story')
  })
})
