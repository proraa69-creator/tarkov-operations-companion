import { describe, expect, it } from 'vitest'
import { layBuild, PICTURE_STAND_INS, type PartAsset, type PartsIndex } from './partPictures'
import realIndex from '../../public/gun-parts/index.json'

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

  // owner, 22.11.2026: «приклады до сих пор кривые на ак 12… приклады и труба приклада»; «проверь все трубы прикладов, что бы
  // именно они были ровные»
  // a slot bone turned `extra` degrees beyond the standard −90° about X (the AK receiver's stock slot: 3.59°)
  const slot = (extra: number) => { const half = ((90 + extra) * Math.PI) / 360; return [-Math.sin(half), 0, 0, Math.cos(half)] }
  const chainIndex = (first: Partial<PartAsset>, second: Partial<PartAsset>, back: number): PartsIndex => ({
    ppm: 1000,
    parts: {
      gun: part({ w: 300, d: [-0.003, 0.18], s: { mod_stock: [0.12, 0, 0.15, ...slot(3.59)] } }),
      first: part({ ...first, s: { mod_stock: [0, 0, 0.15, ...slot(back)] } }),
      second: part(second),
    },
  })
  const chainBuild = { weaponId: 'gun', root: { itemId: 'gun', children: { mod_stock: { itemId: 'first', children: { mod_stock: { itemId: 'second', children: {} } } } } } }
  const angles = (index: PartsIndex) => Object.fromEntries(layBuild(chainBuild, index).parts.map((entry) => [entry.tpl, (Math.atan2(entry.m[3], entry.m[0]) * 180) / Math.PI]))

  it('a tube stands level by its own top edge, and the stock on it stands level too (the AK-12 tube)', () => {
    // the AK-12 tube: 17 × 5 cm, its picture's top edge rising 3.6° to the back; the game turns the stock 4.18° back up on it
    const laid = angles(chainIndex({ w: 172, h: 50, lv: -3.6 }, { w: 180, h: 130 }, -4.18))
    expect(laid.first).toBeCloseTo(3.6, 3)
    expect(laid.second).toBeCloseTo(0, 3)
  })

  it('a stock on a short lock stands level (the PT-1 on the PT lock)', () => {
    expect(angles(chainIndex({ w: 24, h: 50 }, { w: 200, h: 120, lv: -3.83 }, -3.59)).second).toBeCloseTo(3.83, 3)
  })

  it('a butt on a chassis follows it as the game puts it (the UAS butt on the SKS chassis)', () => {
    const laid = angles(chainIndex({ w: 580, h: 110 }, { w: 260, h: 130 }, 4))
    expect(laid.first).toBeCloseTo(0, 3)
    expect(Math.abs(laid.second!)).toBeCloseTo(4, 2)
  })
})

// owner, 21.11.2026: «рукоятки встают неправильно на этом цевье… Так происходит со всеми рукоятками на этом цевье» (AS VAL, 6P29M)
describe('a foregrip on a side slot', () => {
  // the 6P29M: its only foregrip slot on the side (x 0.0294), turned a quarter about the barrel
  const mount = part({ w: 124, h: 68, o: [28, 34], s: { mod_foregrip: [0.0294, 0, -0.0607, -0.5, 0.5, -0.5, 0.5] } })
  // a grip's picture: upright, its root at the bottom
  const grip = part({ w: 58, h: 150, o: [31, 139] })
  const gun = part({ w: 300, s: { mod_handguard: [0.13, -0.06, 0.5, ...STRAIGHT] } })
  const sideIndex: PartsIndex = { ppm: 1000, parts: { gun, mount, grip } }
  const sideBuild = { weaponId: 'gun', root: { itemId: 'gun', children: { mod_handguard: { itemId: 'mount', children: { mod_foregrip: { itemId: 'grip', children: {} } } } } } }

  it('hangs down from below the mount instead of standing up over it', () => {
    const laid = layBuild(sideBuild, sideIndex)
    const placed = laid.parts.find((entry) => entry.tpl === 'grip')!
    // the picture turned upside down: its root (bottom) on top, the grip below
    expect(placed.m[4]).toBeLessThan(0)
    const [, top, , bottom] = laid.boxes['mod_handguard/mod_foregrip']!
    const [, mountTop, , mountBottom] = laid.boxes.mod_handguard!
    expect(top).toBeGreaterThan((mountTop + mountBottom) / 2)
    expect(bottom).toBeGreaterThan(mountBottom)
  })
})

describe('a new part with no picture of its own', () => {
  // report 225: the Scourge P90 was drawn as a bare P90 frame (its SMC-90 chassis has no picture)
  const scourge = {
    weaponId: '6a78b7f8c2016eb33e0027cd',
    root: { itemId: '6a78b7f8c2016eb33e0027cd', children: {
      mod_magazine: { itemId: '5cc70093e4a949033c734312', children: {} },
      mod_stock: { itemId: '6a6877f566f77e6757083db5', children: {
        mod_foregrip: { itemId: '6a688026daa5d47171082d6b', children: {} },
        mod_stock_000: { itemId: '6a69d239d038171e800696b0', children: {} },
      } },
      mod_reciever: { itemId: '5cc70102e4a949035e43ba74', children: { mod_mount_000: { itemId: '5cebec38d7f00c00110a652a', children: {} } } },
      mod_barrel: { itemId: '5cc701aae4a949000e1ea45c', children: {} },
      mod_charge: { itemId: '5cc6ea78e4a949000e1ea3c1', children: {} },
    } },
  }

  it('is drawn as the part it stands in for, and what is on it (made for it) is not drawn', () => {
    const laid = layBuild(scourge, realIndex as unknown as PartsIndex)
    const body = PICTURE_STAND_INS['6a6877f566f77e6757083db5']!
    expect(laid.parts.map((part) => part.tpl)).toContain(body)
    expect(laid.missing).toEqual(['6a688026daa5d47171082d6b', '6a69d239d038171e800696b0'])
    // the P90 body sits where it sits on the P90
    const p90 = layBuild({ ...scourge, weaponId: '5cc82d76e24e8d00134b4b83', root: { itemId: '5cc82d76e24e8d00134b4b83', children: { mod_stock: { itemId: body, children: {} } } } }, realIndex as unknown as PartsIndex)
    const placed = (from: typeof laid) => from.parts.find((part) => part.tpl === body)!
    expect(placed(laid).x).toBeCloseTo(placed(p90).x)
    // its frame keeps the real part's id
    expect(laid.frames.some((frame) => frame.tpl === '6a6877f566f77e6757083db5' && frame.path === 'mod_stock')).toBe(true)
  })

  it('every stand-in has a picture', () => {
    for (const standIn of Object.values(PICTURE_STAND_INS)) expect((realIndex as unknown as PartsIndex).parts[standIn]).toBeDefined()
  })
})
