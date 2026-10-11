import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppDataset } from '../../../src/domain/types'
import { withCachedItemImages } from './itemImageCache.js'

test('replaces only verified ID images and removes uncached external links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-item-cache-test-'))
  const oldDir = process.env.RAIDOS_ITEM_IMAGE_DIR, oldUrl = process.env.RAIDOS_ITEM_IMAGE_URL
  try {
    const id = '5447a9cd4bdc2dbd208b4567'
    const preset = '584147732459775a2b6d9f12'
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ items: { [id]: { images: { icon: { file: `${id}-icon.webp` }, grid: { file: '../../secret' } } }, [preset]: { images: { grid: { file: `${preset}-grid.webp` } } }, bad: { images: { icon: { file: '../../secret' } } } } }))
    process.env.RAIDOS_ITEM_IMAGE_DIR = dir
    process.env.RAIDOS_ITEM_IMAGE_URL = 'https://raidos.app/item-images/'
    const catalog = { items: [{ id, iconUrl: 'https://assets.tarkov.dev/old.webp', fleaPrice: 123 }, { id: 'uncached', iconUrl: 'https://assets.tarkov.dev/fallback.webp' }] } as AppDataset
    const result = withCachedItemImages(catalog)
    assert.equal(result.items[0]!.iconUrl, `https://raidos.app/item-images/${id}-icon.webp`)
    assert.equal(result.items[0]!.fleaPrice, 123)
    assert.equal(result.items[1]!.iconUrl, undefined)
    assert.equal(catalog.items[0]!.iconUrl, 'https://assets.tarkov.dev/old.webp')
    const weapon = { ...catalog.items[0]!, types: ['gun'], presetImageUrl: `https://assets.tarkov.dev/${preset}-512.webp` }
    assert.equal(withCachedItemImages({ ...catalog, items: [weapon] }).items[0]!.presetImageUrl, `https://raidos.app/item-images/${preset}-grid.webp`)
    for (const value of [`https://evil.example/${preset}-512.webp`, `https://assets.tarkov.dev/${id}-512.webp`, `https://assets.tarkov.dev/${preset}-512.webp?bad=1`]) {
      assert.equal(withCachedItemImages({ ...catalog, items: [{ ...weapon, presetImageUrl: value }] }).items[0]!.presetImageUrl, value.startsWith('https://assets.tarkov.dev/') ? undefined : value)
    }
    assert.equal(withCachedItemImages({ ...catalog, items: [{ ...weapon, types: ['mods'] }] }).items[0]!.presetImageUrl, undefined)
    await writeFile(join(dir, 'manifest.json'), 'corrupt')
    assert.equal(withCachedItemImages(catalog).items[0]!.iconUrl, undefined)
  } finally {
    if (oldDir === undefined) delete process.env.RAIDOS_ITEM_IMAGE_DIR; else process.env.RAIDOS_ITEM_IMAGE_DIR = oldDir
    if (oldUrl === undefined) delete process.env.RAIDOS_ITEM_IMAGE_URL; else process.env.RAIDOS_ITEM_IMAGE_URL = oldUrl
    if (dir.startsWith(join(tmpdir(), 'raidos-item-cache-test-'))) await rm(dir, { recursive: true, force: true })
  }
})

test('catalog assets never send a packaged client to tarkov.dev', () => {
  const external = 'https://assets.tarkov.dev/maps/svg/Factory.svg'
  const catalog = {
    items: [], markers: [],
    maps: [{ id: 'factory', name: 'Factory', subtitle: '', raidTime: 1, players: '1', difficulty: 'Низкая', accent: '#000', markerCount: 0, imageUrl: external, layers: [{ name: 'main', tileUrl: 'https://assets.tarkov.dev/maps/factory/main/{z}/{x}/{y}.png' }] }],
    quests: [{ id: 'q', name: 'q', trader: 't', level: 1, kappa: false, description: '', objectives: [], rewards: [], imageUrl: 'https://assets.tarkov.dev/q.webp' }],
    traders: [{ id: 't', name: 't', role: '', loyalty: 1, accent: '#000', imageUrl: 'https://assets.tarkov.dev/t.webp' }],
    hideout: [{ id: 'h', name: 'h', level: 0, status: 'locked', requirements: [], bonus: '', imageUrl: 'https://assets.tarkov.dev/h.webp' }],
  } as AppDataset
  const result = withCachedItemImages(catalog)
  assert.equal(result.maps[0]!.imageUrl, 'https://raidos.app/v1/map-tiles/maps/svg/Factory.svg')
  assert.equal(result.maps[0]!.layers![0]!.tileUrl, 'https://raidos.app/v1/map-tiles/maps/factory/main/{z}/{x}/{y}.png')
  assert.equal(result.quests[0]!.imageUrl, undefined)
  assert.equal(result.traders[0]!.imageUrl, undefined)
  assert.equal(result.hideout[0]!.imageUrl, undefined)
})

test('catalog image rewriting follows the active image generation', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'raidos-item-generation-')); t.after(() => rm(dir, { recursive: true, force: true }))
  const id = '5447a9cd4bdc2dbd208b4567', generation = 'images-current1'
  await mkdir(join(dir, 'generations', generation), { recursive: true })
  await writeFile(join(dir, 'generations', generation, 'manifest.json'), JSON.stringify({ items: { [id]: { images: { icon: { file: `${id}-icon.webp` } } } } }))
  await writeFile(join(dir, 'active.json'), JSON.stringify({ version: 1, current: generation }))
  const oldDir = process.env.RAIDOS_ITEM_IMAGE_DIR, oldUrl = process.env.RAIDOS_ITEM_IMAGE_URL
  process.env.RAIDOS_ITEM_IMAGE_DIR = dir; process.env.RAIDOS_ITEM_IMAGE_URL = 'https://raidos.app/v1/item-images'
  try {
    const result = withCachedItemImages({ items: [{ id, prices: [] }] } as unknown as AppDataset)
    assert.equal(result.items[0]!.iconUrl, `https://raidos.app/v1/item-images/${id}-icon.webp`)
  } finally {
    if (oldDir === undefined) delete process.env.RAIDOS_ITEM_IMAGE_DIR; else process.env.RAIDOS_ITEM_IMAGE_DIR = oldDir
    if (oldUrl === undefined) delete process.env.RAIDOS_ITEM_IMAGE_URL; else process.env.RAIDOS_ITEM_IMAGE_URL = oldUrl
  }
})
