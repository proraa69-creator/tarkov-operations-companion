import { describe, expect, it } from 'vitest'
import { layBuild, type PartAsset, type PartsIndex } from './partPictures'

// A weapon (its stock slot at the back) and a stock, with a folded look that turns the stock slot 180° about the vertical — as the
// AK family folds its stock to the left side, behind the receiver in a picture of the right side.
const STRAIGHT = [-0.70711, 0, 0, 0.70711]
const FOLDED_SLOT = [0, 0.70711, 0.70711, 0]
const part = (extra: Partial<PartAsset> = {}): PartAsset => ({ w: 100, h: 40, o: [0, 20], d: [-0.02, 0.02], s: {}, ...extra })
const weapon = (fold: boolean): PartAsset => part({
  w: 300, d: [-0.003, 0.18],
  s: { mod_stock: [0.12, 0, 0.15, ...STRAIGHT] },
  fs: 'mod_stock',
  ...(fold ? { fold: { w: 300, h: 40, o: [0, 20], d: [-0.003, 0.18], s: { mod_stock: [0.12, 0, 0.15, ...FOLDED_SLOT] } } } : {}),
})
const index = (fold: boolean): PartsIndex => ({ ppm: 1000, parts: { gun: weapon(fold), stock: part({ d: [-0.01, 0.04] }) } })
const build = { weaponId: 'gun', root: { itemId: 'gun', children: { mod_stock: { itemId: 'stock', children: {} } } } }

describe('a folded stock', () => {
  // owner, 20.11.2026: «при нажатии уходит в текстуры, а он должен находиться снаружи»
  it('folded to the far side lies in front of the receiver, outside it', () => {
    const laid = layBuild(build, index(true), { folded: true })
    const receiver = laid.parts.find((entry) => entry.tpl === 'gun')!
    const stock = laid.parts.find((entry) => entry.tpl === 'stock')!
    expect(stock.x + stock.asset.d[1]).toBeLessThan(receiver.x + receiver.asset.d[0])
    // unfolded it stays where the game puts it
    const plain = layBuild(build, index(true))
    expect(plain.parts.find((entry) => entry.tpl === 'stock')!.x).toBeCloseTo(0.12)
  })

  it('no fold button where nothing folds (MP7, UZI PRO: no folded look of the weapon or the stock)', () => {
    expect(layBuild(build, index(true)).foldable).toBe(true)
    expect(layBuild(build, index(false)).foldable).toBe(false)
    // and pressing it would move nothing
    expect(layBuild(build, index(false), { folded: true }).parts.find((entry) => entry.tpl === 'stock')!.x).toBeCloseTo(0.12)
  })
})

describe('a stock stands level', () => {
  // owner, 20.11.2026: «АК… смотрит чуть-чуть наверх… у Скара, МК-17… смотрит вниз… У УЗИ… горизонтально должен стоять»
  const tilted = (lv?: number): PartsIndex => ({
    ppm: 1000,
    parts: {
      gun: part({ w: 300, d: [-0.003, 0.18], s: { mod_stock: [0.12, 0, 0.15, -0.72892, 0, 0, 0.68459] } }),
      stock: part(lv === undefined ? {} : { lv }),
    },
  })
  const angleOf = (index: PartsIndex) => {
    const stock = layBuild(build, index).parts.find((entry) => entry.tpl === 'stock')!
    return (Math.atan2(stock.m[3], stock.m[0]) * 180) / Math.PI
  }

  it('the slot\'s own small tilt is taken off (the AK-74M\'s 3.59°)', () => {
    expect(angleOf(tilted())).toBeCloseTo(0, 5)
  })

  it('a stock with a drooping top edge is turned by it', () => {
    expect(angleOf(tilted(15.8))).toBeCloseTo(-15.8, 3)
  })
})
