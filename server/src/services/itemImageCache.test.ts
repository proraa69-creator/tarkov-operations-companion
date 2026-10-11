import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppDataset } from '../../../src/domain/types'
import { withCachedItemImages } from './itemImageCache.js'

test('replaces only verified ID images and preserves uncached links and prices', async () => {
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
    assert.equal(result.items[1]!.iconUrl, catalog.items[1]!.iconUrl)
    assert.equal(catalog.items[0]!.iconUrl, 'https://assets.tarkov.dev/old.webp')
    const weapon = { ...catalog.items[0]!, types: ['gun'], presetImageUrl: `https://assets.tarkov.dev/${preset}-512.webp` }
    assert.equal(withCachedItemImages({ ...catalog, items: [weapon] }).items[0]!.presetImageUrl, `https://raidos.app/item-images/${preset}-grid.webp`)
    for (const value of [`https://evil.example/${preset}-512.webp`, `https://assets.tarkov.dev/${id}-512.webp`, `https://assets.tarkov.dev/${preset}-512.webp?bad=1`]) {
      assert.equal(withCachedItemImages({ ...catalog, items: [{ ...weapon, presetImageUrl: value }] }).items[0]!.presetImageUrl, value)
    }
    assert.equal(withCachedItemImages({ ...catalog, items: [{ ...weapon, types: ['mods'] }] }).items[0]!.presetImageUrl, weapon.presetImageUrl)
    await writeFile(join(dir, 'manifest.json'), 'corrupt')
    assert.equal(withCachedItemImages(catalog), catalog)
  } finally {
    if (oldDir === undefined) delete process.env.RAIDOS_ITEM_IMAGE_DIR; else process.env.RAIDOS_ITEM_IMAGE_DIR = oldDir
    if (oldUrl === undefined) delete process.env.RAIDOS_ITEM_IMAGE_URL; else process.env.RAIDOS_ITEM_IMAGE_URL = oldUrl
    if (dir.startsWith(join(tmpdir(), 'raidos-item-cache-test-'))) await rm(dir, { recursive: true, force: true })
  }
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
