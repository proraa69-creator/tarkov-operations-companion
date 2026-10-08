import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetUrl, isWebp, isImage } from './cache-item-images.mjs'

test('only canonical item assets from the trusted image host are downloaded', () => {
  const id = '5447a9cd4bdc2dbd208b4567'
  assert.equal(assetUrl(id, `https://assets.tarkov.dev/${id}-icon.webp`), `https://assets.tarkov.dev/${id}-icon.webp`)
  for (const url of [`http://assets.tarkov.dev/${id}-icon.webp`, `https://assets.tarkov.dev.evil.test/${id}-icon.webp`, `https://user:pass@assets.tarkov.dev/${id}-icon.webp`, `https://assets.tarkov.dev/${id}-icon.webp?redirect=1`, 'https://127.0.0.1/secret', `https://assets.tarkov.dev/${id}-icon.svg`]) assert.equal(assetUrl(id, url), null)
  assert.equal(assetUrl('../secret', 'https://assets.tarkov.dev/secret-icon.webp'), null)
  assert.equal(assetUrl('customdogtags12345678910', 'https://assets.tarkov.dev/customdogtags12345678910-icon.webp'), 'https://assets.tarkov.dev/customdogtags12345678910-icon.webp')
  assert.ok(assetUrl(id, 'https://assets.tarkov.dev/64a536392d2c4e6e970f4121-icon.webp'))
  assert.ok(assetUrl(id, `https://assets.tarkov.dev/${id}-grid-image.jpg`))
})

test('rejects HTML, truncated images and oversized downloads', () => {
  assert.equal(isWebp(Buffer.from('<html>error</html>')), false)
  const bytes = Buffer.alloc(24)
  bytes.write('RIFF'); bytes.writeUInt32LE(16, 4); bytes.write('WEBP', 8)
  assert.equal(isWebp(bytes), true)
  assert.equal(isWebp(bytes.subarray(0, 23)), false)
  assert.equal(isWebp(Buffer.alloc(9 * 1024 * 1024)), false)
  assert.equal(isImage(Buffer.from('<html>not an image</html>'), 'jpg'), false)
})
