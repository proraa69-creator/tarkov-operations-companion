/**
 * «Настройка экрана» (owner, 27.10.2026: «настройка экрана в игре… более глубокая, чем PostFX: по кривой, по основному
 * цвету… тёмные коридоры, ночные рейды сделать светлее»). A profile is turned into one table per colour channel: value
 * on screen → value sent to the monitor. The same table colours the before / after preview (src/screen/ScreenTuningPage)
 * and, in the PC app, becomes the display's gamma ramp (electron/screenTuning.ts) — the picture the player sees, never
 * the game: nothing is read from or written to the game process.
 *
 * No imports: the main process compiles this file too.
 */

export interface CurvePoint { x: number; y: number }

export type ChannelCurves = Partial<Record<'r' | 'g' | 'b', CurvePoint[]>>

export interface ScreenProfile {
  id: string
  name: string
  /** One of ours (cannot be changed or deleted, only copied). */
  builtIn?: boolean
  /** A line under the name: where the preset helps. */
  note?: string
  /** Mid-tones: above 1 brighter, below 1 darker (0.5…2.5). */
  gamma: number
  /** Raises the dark tones and keeps black black (0…0.4). */
  shadows: number
  /** Below 0 softens the brightest tones: a lamp or the sky stays readable after the shadows are raised (−0.4…0.1). */
  highlights: number
  /** −0.5…0.5 around the middle grey. */
  contrast: number
  /** An even shift of every tone (−0.25…0.25). */
  brightness: number
  /** The main colour: −1 cold (blue) … 1 warm (yellow). */
  temperature: number
  /** −1 green … 1 magenta. */
  tint: number
  /** The master curve, 0…1 both ways; [] or two end points is a straight line. */
  curve: CurvePoint[]
  /** Optional curve per channel, after the master curve. */
  channels?: ChannelCurves
  /** NVIDIA «Цифровая интенсивность» in % (50 is the driver's default); undefined: not touched. */
  vibrance?: number
}

export const NEUTRAL: Omit<ScreenProfile, 'id' | 'name'> = {
  gamma: 1, shadows: 0, highlights: 0, contrast: 0, brightness: 0, temperature: 0, tint: 0, curve: [],
}

export const LIMITS = {
  gamma: [0.5, 2.5], shadows: [0, 0.4], highlights: [-0.4, 0.1], contrast: [-0.5, 0.5], brightness: [-0.25, 0.25],
  temperature: [-1, 1], tint: [-1, 1], vibrance: [0, 100],
} as const

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : 0))

/**
 * A smooth curve through the points that never overshoots between them (monotone cubic, Fritsch–Carlson): a rising set of
 * points gives a rising curve, so no tone ever turns darker than a darker one.
 */
export function curveFunction(points: readonly CurvePoint[] | undefined): (x: number) => number {
  const sorted = [...(points ?? [])]
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => ({ x: clamp(point.x), y: clamp(point.y) }))
    .sort((a, b) => a.x - b.x)
    .filter((point, index, all) => index === 0 || point.x - all[index - 1]!.x > 1e-4)
  if (!sorted.length || sorted[0]!.x > 0) sorted.unshift({ x: 0, y: sorted.length ? Math.min(sorted[0]!.y, 0) : 0 })
  if (sorted[sorted.length - 1]!.x < 1) sorted.push({ x: 1, y: Math.max(sorted[sorted.length - 1]!.y, 1) })
  if (sorted.length === 2 && sorted[0]!.y === 0 && sorted[1]!.y === 1) return (x) => clamp(x)
  const n = sorted.length
  const xs = sorted.map((point) => point.x), ys = sorted.map((point) => point.y)
  const slopes = xs.slice(0, -1).map((x, index) => (ys[index + 1]! - ys[index]!) / (xs[index + 1]! - x))
  const tangents = xs.map((_, index) => {
    if (index === 0) return slopes[0]!
    if (index === n - 1) return slopes[n - 2]!
    const before = slopes[index - 1]!, after = slopes[index]!
    return before * after <= 0 ? 0 : (before + after) / 2
  })
  for (let index = 0; index < n - 1; index += 1) {
    const slope = slopes[index]!
    if (slope === 0) { tangents[index] = 0; tangents[index + 1] = 0; continue }
    const a = tangents[index]! / slope, b = tangents[index + 1]! / slope
    const length = a * a + b * b
    if (length > 9) {
      const scale = 3 / Math.sqrt(length)
      tangents[index] = scale * a * slope
      tangents[index + 1] = scale * b * slope
    }
  }
  return (value) => {
    const x = clamp(value)
    let index = 0
    while (index < n - 2 && x > xs[index + 1]!) index += 1
    const h = xs[index + 1]! - xs[index]!
    const t = (x - xs[index]!) / h
    const t2 = t * t, t3 = t2 * t
    return clamp((2 * t3 - 3 * t2 + 1) * ys[index]! + (t3 - 2 * t2 + t) * h * tangents[index]! + (-2 * t3 + 3 * t2) * ys[index + 1]! + (t3 - t2) * h * tangents[index + 1]!)
  }
}

/** The tone part of a profile (every channel alike), 0…1 → 0…1. */
export function toneFunction(profile: Omit<ScreenProfile, 'id' | 'name'>): (x: number) => number {
  const gamma = clamp(profile.gamma || 1, LIMITS.gamma[0], LIMITS.gamma[1])
  const shadows = clamp(profile.shadows, LIMITS.shadows[0], LIMITS.shadows[1])
  const highlights = clamp(profile.highlights, LIMITS.highlights[0], LIMITS.highlights[1])
  const contrast = clamp(profile.contrast, LIMITS.contrast[0], LIMITS.contrast[1])
  const brightness = clamp(profile.brightness, LIMITS.brightness[0], LIMITS.brightness[1])
  const curve = curveFunction(profile.curve)
  return (input) => {
    let x = Math.pow(clamp(input), 1 / gamma)
    // A bump over the dark third (0 stays 0): what is in a dark corner shows, black stays black.
    x += shadows * 4 * x * (1 - x) * (1 - x)
    // Above 0.7: pulled towards 1 or pushed down, so raised shadows do not burn out a window or the sky.
    if (x > 0.7) x = 0.7 + (x - 0.7) * (1 + highlights)
    x = (x - 0.5) * (1 + contrast) + 0.5 + brightness
    return curve(clamp(x))
  }
}

export interface ScreenTables {
  /** 256 values per channel, 0…1, never falling. */
  r: Float64Array
  g: Float64Array
  b: Float64Array
}

/** The profile as three tables of 256 steps (red, green, blue). */
export function screenTables(profile: Omit<ScreenProfile, 'id' | 'name'>): ScreenTables {
  const tone = toneFunction(profile)
  const temperature = clamp(profile.temperature, -1, 1), tint = clamp(profile.tint, -1, 1)
  // The main colour as a white balance: warm adds red and takes blue, tint takes green (magenta) or adds it.
  const gains = {
    r: 1 + 0.12 * Math.max(temperature, 0) - 0.04 * Math.max(-temperature, 0) + 0.03 * Math.max(tint, 0),
    g: 1 - 0.08 * Math.max(tint, 0) + 0.06 * Math.max(-tint, 0) + 0.02 * Math.max(temperature, 0),
    b: 1 - 0.14 * Math.max(temperature, 0) + 0.12 * Math.max(-temperature, 0) + 0.03 * Math.max(tint, 0),
  }
  const scale = Math.max(gains.r, gains.g, gains.b)
  const build = (channel: 'r' | 'g' | 'b') => {
    const own = curveFunction(profile.channels?.[channel])
    const table = new Float64Array(256)
    let previous = 0
    for (let index = 0; index < 256; index += 1) {
      const value = clamp(own(tone(index / 255)) * gains[channel] / scale)
      previous = Math.max(previous, value)
      table[index] = previous
    }
    return table
  }
  return { r: build('r'), g: build('g'), b: build('b') }
}

/** The tables for a picture: 0…255 per channel. */
export function byteTables(tables: ScreenTables) {
  const bytes = (table: Float64Array) => Uint8ClampedArray.from(table, (value) => Math.round(value * 255))
  return { r: bytes(tables.r), g: bytes(tables.g), b: bytes(tables.b) }
}

/** The tables as a Windows gamma ramp: 3 × 256 WORD values (red, then green, then blue). */
export function gammaRamp(tables: ScreenTables): Uint16Array {
  const ramp = new Uint16Array(768)
  ;(['r', 'g', 'b'] as const).forEach((channel, offset) => {
    for (let index = 0; index < 256; index += 1) ramp[offset * 256 + index] = Math.round(tables[channel][index]! * 65535)
  })
  return ramp
}

/** `amount` of the way from the straight line to the tables (Windows refuses ramps far from it on some systems). */
export function weakerTables(tables: ScreenTables, amount: number): ScreenTables {
  const k = clamp(amount)
  const mix = (table: Float64Array) => Float64Array.from(table, (value, index) => index / 255 + (value - index / 255) * k)
  return { r: mix(tables.r), g: mix(tables.g), b: mix(tables.b) }
}

/** Whether the profile changes nothing on the screen. */
export function isNeutral(profile: Omit<ScreenProfile, 'id' | 'name'>) {
  const tables = screenTables(profile)
  return (['r', 'g', 'b'] as const).every((channel) => tables[channel].every((value, index) => Math.abs(value - index / 255) < 0.5 / 255))
}

/** Colours a picture's pixels (RGBA, in place) with the tables. */
export function applyTables(pixels: Uint8ClampedArray | Uint8Array, tables: ReturnType<typeof byteTables>) {
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = tables.r[pixels[index]!]!
    pixels[index + 1] = tables.g[pixels[index + 1]!]!
    pixels[index + 2] = tables.b[pixels[index + 2]!]!
  }
  return pixels
}

/** Curve points written in screen steps 0…255, as an image editor shows them. */
const steps = (pairs: Array<[number, number]>): CurvePoint[] => pairs.map(([x, y]) => ({ x: x / 255, y: y / 255 }))

/**
 * Night and indoor scenes keep a little colour tint in their darkest steps (red a step above blue); a steep rise of those
 * steps turns it brown. These two channel curves take it back.
 */
const NEUTRAL_SHADOWS: ChannelCurves = { r: steps([[0, 0], [40, 35], [255, 255]]), b: steps([[0, 0], [40, 47], [255, 255]]) }

/**
 * Our presets, tuned on the owner's dark hideout screenshot (27.10.2026: «не просто выкрутить яркость… настраивай с
 * помощью кривой… и не слишком ярко, и чтобы было видно пространство»). In Tarkov's dark scenes nearly everything sits in
 * steps 8…16 of 255: the curve rises steeply exactly there, stays near black below (black stays black, no fog), then
 * flattens so the middle rises less and a lamp or the sky are not burnt out. Brightness alone would lift it all into fog.
 */
export const BUILT_IN_PRESETS: ScreenProfile[] = [
  { id: 'builtin-off', name: 'Без изменений', builtIn: true, note: 'Экран как есть', ...NEUTRAL },
  {
    id: 'builtin-light', name: 'Лёгкий', builtIn: true, note: 'Чуть светлее тени, картинка почти как в игре',
    ...NEUTRAL, curve: steps([[0, 0], [5, 7], [9, 24], [14, 36], [24, 52], [48, 84], [96, 132], [170, 192], [255, 255]]), channels: NEUTRAL_SHADOWS,
  },
  {
    id: 'builtin-indoors', name: 'Помещения и убежище', builtIn: true, note: 'Коридоры, подвалы, бункеры, Лаборатория',
    ...NEUTRAL, curve: steps([[0, 0], [5, 9], [9, 32], [14, 48], [24, 66], [48, 98], [96, 145], [170, 200], [255, 255]]), channels: NEUTRAL_SHADOWS,
  },
  {
    id: 'builtin-night-soft', name: 'Ночь', builtIn: true, note: 'Ночной рейд: видно, куда идти, без тумана',
    ...NEUTRAL, curve: steps([[0, 0], [5, 10], [9, 36], [14, 54], [24, 74], [48, 108], [96, 152], [170, 205], [255, 252]]), channels: NEUTRAL_SHADOWS,
  },
  {
    id: 'builtin-night-max', name: 'Ночь — максимум', builtIn: true, note: 'Самые тёмные ночи без ПНВ',
    ...NEUTRAL, curve: steps([[0, 0], [5, 12], [9, 42], [14, 62], [24, 84], [48, 120], [96, 163], [170, 210], [255, 255]]), channels: NEUTRAL_SHADOWS,
  },
  {
    id: 'builtin-corners', name: 'Тёмные углы', builtIn: true, note: 'Только самые тёмные места, остальное как в игре',
    ...NEUTRAL, curve: steps([[0, 0], [5, 8], [9, 26], [16, 40], [32, 56], [64, 82], [128, 136], [255, 255]]), channels: NEUTRAL_SHADOWS,
  },
  {
    id: 'builtin-dusk', name: 'Сумерки и рассвет', builtIn: true, note: 'Переход дня и ночи, туман',
    ...NEUTRAL, curve: steps([[0, 0], [6, 10], [16, 28], [40, 60], [100, 120], [180, 192], [255, 255]]),
  },
  {
    id: 'builtin-foliage', name: 'Лес и тени', builtIn: true, note: 'Игрок в кустах и в тени деревьев',
    ...NEUTRAL, curve: steps([[0, 0], [10, 18], [30, 46], [80, 98], [160, 170], [255, 255]]), temperature: -0.1, vibrance: 65,
  },
  {
    id: 'builtin-day', name: 'День — чётко', builtIn: true, note: 'Яркий день: больше контраста и цвета',
    ...NEUTRAL, curve: steps([[0, 0], [24, 26], [64, 72], [128, 138], [200, 212], [255, 255]]), vibrance: 65,
  },
]

/** A profile read from storage or a page: every field in its range, unknown fields dropped. Null when it is not one. */
export function cleanProfile(value: unknown): ScreenProfile | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : ''
  const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 48) : ''
  if (!id || !name) return null
  const number = (key: keyof typeof LIMITS, fallback: number) => {
    const found = Number(raw[key])
    return Number.isFinite(found) ? clamp(found, LIMITS[key][0], LIMITS[key][1]) : fallback
  }
  const points = (list: unknown) => Array.isArray(list)
    ? list.slice(0, 16).map((point) => ({ x: clamp(Number((point as CurvePoint)?.x)), y: clamp(Number((point as CurvePoint)?.y)) }))
    : []
  const channels: ChannelCurves = {}
  const rawChannels = raw.channels && typeof raw.channels === 'object' ? raw.channels as Record<string, unknown> : {}
  for (const channel of ['r', 'g', 'b'] as const) if (Array.isArray(rawChannels[channel]) && (rawChannels[channel] as unknown[]).length) channels[channel] = points(rawChannels[channel])
  const vibrance = raw.vibrance === undefined || raw.vibrance === null ? undefined : number('vibrance', 50)
  return {
    id, name,
    ...(typeof raw.note === 'string' && raw.note.trim() ? { note: raw.note.trim().slice(0, 80) } : {}),
    gamma: number('gamma', 1), shadows: number('shadows', 0), highlights: number('highlights', 0), contrast: number('contrast', 0),
    brightness: number('brightness', 0), temperature: number('temperature', 0), tint: number('tint', 0),
    curve: points(raw.curve),
    ...(Object.keys(channels).length ? { channels } : {}),
    ...(vibrance === undefined ? {} : { vibrance }),
  }
}
