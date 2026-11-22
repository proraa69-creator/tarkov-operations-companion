import { createRequire } from 'node:module'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { FleaPixels } from './fleaDigits'
import { createFleaWatch, type FleaRect } from './fleaReading'

const dir = join(__dirname, '__fixtures__', 'flea')
const sharp = createRequire(import.meta.url)('sharp') as (input: string) => { removeAlpha(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number } }> } } }
const frames = new Map<string, FleaPixels>()

beforeAll(async () => {
  for (const name of ['pve-keys', 'season-weapons', 'pvp-locked-banner', 'season-short', 'pve-eur']) {
    const { data, info } = await sharp(join(dir, `${name}.webp`)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
    frames.set(name, { width: info.width, height: info.height, data, channels: 3, bgr: false })
  }
})

/** OCR stand-in: what each line reads, by where it is (the test frames keep no names or sellers). */
function fakeOcr(sellers: Record<number, string> = {}, chips = ['Сост. от 100', 'Кроме бартера']) {
  const lines: string[] = []
  const ocr = async (rect: FleaRect) => {
    if (rect.y < 100) {
      // The filter chips: the first one's words start at x 608 («Сост. от 100», or «Валюта EUR» on the euro frame).
      lines.push(`chip${rect.x}`)
      return rect.x === 608 ? chips[0]! : chips[1]!
    }
    const row = Math.floor((rect.y - 144) / 72)
    const part = rect.y >= 1018 ? 'label' : rect.x < 900 ? 'seller' : rect.y - (144 + row * 72) < 25 ? 'name' : 'info'
    lines.push(part === 'label' ? 'label' : `${part}${row}`)
    if (part === 'label') return '1.3.0.2.48779 | PvE'
    if (part === 'seller') return sellers[row] ?? `Player${row}`
    if (part === 'info') return sellers[row] ? 'Всего 1645000 (лимит 6)' : 'Всего 1'
    return `Item ${row}`
  }
  return { ocr, lines }
}

describe('the flea followed on the screen copies of the quest scanner', () => {
  it('is no flea on another screen: nothing read, the quest scanner reads as before', async () => {
    const { ocr, lines } = fakeOcr()
    const watch = createFleaWatch(ocr)
    const black: FleaPixels = { width: 1920, height: 1080, data: new Uint8Array(1920 * 1080 * 3), channels: 3, bgr: false }
    expect(await watch.look(black)).toEqual({ flea: false })
    expect(lines).toEqual([])
  })

  it('reads a list once it has settled (the same prices on two looks), then not again while it stays', async () => {
    const { ocr, lines } = fakeOcr()
    const watch = createFleaWatch(ocr, () => 1_000)
    const keys = frames.get('pve-keys')!
    const first = await watch.look(keys)
    expect(first).toMatchObject({ flea: true, state: { open: true } })
    expect(first.reading).toBeUndefined()
    expect(lines).toEqual([])
    const second = await watch.look(keys)
    expect(second.reading).toMatchObject({ at: 1_000, labelMode: 'pve', filters: ['Сост. от 100', 'Кроме бартера'] })
    expect(second.reading!.rows.map((row) => row.price.kind === 'price' && row.price.value)).toEqual([1000, 2000, 2000, 2000, 2500, 2900, 2900, 2990, 3000, 3000, 3000, 3000])
    expect(second.reading!.rows[0]).toMatchObject({ seller: 'Player0', info: 'Всего 1', name: 'Item 0' })
    expect(lines).toHaveLength(2 + 12 * 3 + 1)
    expect((await watch.look(keys)).reading).toBeUndefined()
    expect(lines).toHaveLength(2 + 12 * 3 + 1)
    // Another list, then this one again: read again.
    await watch.look(frames.get('season-short')!)
    expect((await watch.look(frames.get('season-short')!)).reading).toBeDefined()
    await watch.look(keys)
    expect((await watch.look(keys)).reading).toBeDefined()
  })

  it('reads no names of the traders\' rows, and stops at the list\'s end', async () => {
    const { ocr, lines } = fakeOcr({ 0: 'Прапор', 1: '99 Егерь' })
    const watch = createFleaWatch(ocr)
    await watch.look(frames.get('season-weapons')!)
    const reading = (await watch.look(frames.get('season-weapons')!)).reading!
    expect(reading.rows.slice(0, 3).map((row) => row.name)).toEqual(['', '', 'Item 2'])
    expect(lines.filter((line) => line.startsWith('name'))).not.toContain('name0')
    // Row 3 is a dim player's row: the reading ends there, its name not read.
    expect(reading.rows).toHaveLength(4)
    expect(reading.rows[3]).toMatchObject({ price: { kind: 'dim' }, name: '' })
    const short = createFleaWatch(fakeOcr().ocr)
    await short.look(frames.get('season-short')!)
    expect((await short.look(frames.get('season-short')!)).reading!.rows.map((row) => row.price.kind)).toEqual(['price', 'price', 'empty'])
  })

  it('reads nothing behind the level-15 banner: only the traders\' offers are listed there', async () => {
    const { ocr, lines } = fakeOcr()
    const watch = createFleaWatch(ocr)
    const locked = frames.get('pvp-locked-banner')!
    await watch.look(locked)
    expect(await watch.look(locked)).toEqual({ flea: true, state: { open: true, ascending: true, atTop: true, locked: true } })
    expect(lines).toEqual([])
  })

  it('leaves a list alone behind a currency filter: its top row is the cheapest in euros, not of the item', async () => {
    const { ocr, lines } = fakeOcr({}, ['Валюта EUR', 'Сост. от 100'])
    const watch = createFleaWatch(ocr)
    const euros = frames.get('pve-eur')!
    await watch.look(euros)
    expect(await watch.look(euros)).toMatchObject({ flea: true, filtered: ['Валюта EUR', 'Сост. от 100'] })
    expect(lines).toEqual(['chip608', 'chip725'])
    // Not asked again while it stays.
    expect((await watch.look(euros)).filtered).toBeUndefined()
    expect(lines).toHaveLength(2)
  })
})
