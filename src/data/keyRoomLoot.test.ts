import { describe, expect, it } from 'vitest'
import type { GameMap, MapMarker } from '../domain/types'
import { keyRoomLoot } from './keyRoomLoot'

// The Lab's black-card room (src/data/mapRoomSigns.ts LAB_KEYCARD_ROOMS): x -269.5…-250.2, z -371.8…-358.6
const LAB = { id: 'the-lab', name: 'Лаборатория', floors: [] } as unknown as GameMap
const BLACK = 'black-card'
const door = { id: 'the-lab-lock-e36b7350a3badbd5c6723420914340c37dc250d8', mapId: 'the-lab', type: 'key', layerId: 'key', title: '', description: '', position: [-365, -255], lock: { keyId: BLACK } } as unknown as MapMarker
const point = (id: string, x: number, z: number, patch: Partial<MapMarker>) => ({ id, mapId: 'the-lab', type: 'cache', title: '', description: '', position: [z, x], ...patch }) as MapMarker

describe('«Что в комнате»: what spawns behind a key\'s doors (owner, 18.11.2026)', () => {
  const markers = [
    door,
    point('safe', -260, -365, { layerId: 'loot.container', title: 'Сейф' }),
    point('box1', -258, -362, { layerId: 'loot.container', title: 'Оружейный ящик' }),
    point('box2', -256, -362, { layerId: 'loot.container', title: 'Оружейный ящик' }),
    point('valuables', -262, -366, { layerId: 'loot.valuable', title: 'Драгоценности', lootIds: ['ledx', 'gpu'], itemId: 'ledx' }),
    point('keys', -261, -360, { layerId: 'loot.key', title: 'Ключи', keyIds: ['red', 'ledx'] }),
    point('doc', -259, -361, { layerId: 'loot.documents', title: 'Документы', itemId: 'doc' }),
    point('quest', -259, -361, { layerId: 'quest.zone', type: 'quest', title: 'Квест' }),
    point('outside', -200, -300, { layerId: 'loot.valuable', title: 'Драгоценности', lootIds: ['btc'] }),
  ]

  it('the items and containers inside the rooms its doors lock, nothing outside them', () => {
    const loot = keyRoomLoot(BLACK, markers, [LAB])
    expect(loot.known).toBe(true)
    expect(Object.fromEntries(loot.items.map((row) => [row.itemId, row.spots]))).toEqual({ ledx: 2, gpu: 1, red: 1, doc: 1 })
    expect(loot.containers).toEqual([{ name: 'Оружейный ящик', count: 2 }, { name: 'Сейф', count: 1 }])
  })

  it('a key with no known room: nothing known', () => {
    expect(keyRoomLoot('other', markers, [LAB])).toEqual({ known: false, items: [], containers: [] })
  })
})
