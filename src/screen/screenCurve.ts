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
  /** One of ours the player tuned by hand («Вернуть как было» brings our own back). */
  edited?: boolean
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
  /**
   * Filter «Убрать дымку в темноте», in screen steps (0…16): the black point. Rooms like the hideout have no true black —
   * their darkest tone is a haze about eight steps up; this many steps are taken off before the curve, so the haze is
   * not lifted into a grey veil over the whole screen (owner, 28.10.2026: «светло в глубине картинки, а не перед экраном»).
   */
  haze?: number
  /**
   * Filter «Убрать красно-бурый налёт» (0…1): red's black is moved down to green's. In Tarkov's dark scenes red sits
   * about three steps above green and blue, which any brightening turns brown or red.
   */
  cast?: number
}

export const NEUTRAL: Omit<ScreenProfile, 'id' | 'name'> = {
  gamma: 1, shadows: 0, highlights: 0, contrast: 0, brightness: 0, temperature: 0, tint: 0, curve: [],
}

export const LIMITS = {
  gamma: [0.5, 2.5], shadows: [0, 0.4], highlights: [-0.4, 0.1], contrast: [-0.5, 0.5], brightness: [-0.25, 0.25],
  temperature: [-1, 1], tint: [-1, 1], vibrance: [0, 100], haze: [0, 16], cast: [0, 1],
} as const

/** How many steps red's black sits above the others in the game's dark scenes (filter «Убрать красно-бурый налёт»). */
const RED_ABOVE_BLACK = 3

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
  const haze = clamp(profile.haze ?? 0, LIMITS.haze[0], LIMITS.haze[1])
  const shift = { r: RED_ABOVE_BLACK * clamp(profile.cast ?? 0), g: 0, b: 0 }
  const build = (channel: 'r' | 'g' | 'b') => {
    const own = curveFunction(profile.channels?.[channel])
    const table = new Float64Array(256)
    let previous = 0
    for (let index = 0; index < 256; index += 1) {
      // The filters first, on the step as the game drew it: red's black down to the others', then the haze taken off.
      const unshifted = Math.min(255, Math.max(0, (index - shift[channel]) / (255 - shift[channel]) * 255))
      const step = Math.max(0, (unshifted - haze) / (255 - haze) * 255)
      const value = clamp(own(tone(step / 255)) * gains[channel] / scale)
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
 * The look of the owner's example (28.10.2026, a video of a «подбор пресета ИИ» tool: a nearly black garage becomes a
 * lit one, «как днём»): measured frame against frame, its dark tones rise like a camera's exposure — a logarithm from
 * black, steep for the first steps and gently flattening, the black itself not lifted into a grey veil, the brightest
 * tones held a little. `knee`: the steps where the rise starts to flatten (smaller — stronger, «как днём» is 2);
 * `top`: where white lands.
 */
const EXPOSURE_STEPS = [1, 2, 3, 5, 8, 12, 18, 28, 45, 70, 110, 170]

export function exposureCurve(knee: number, top = 255): CurvePoint[] {
  const rise = (step: number) => top * Math.log(1 + step / knee) / Math.log(1 + 255 / knee)
  return steps([[0, 0], ...EXPOSURE_STEPS.map((step): [number, number] => [step, Math.round(rise(step))]), [255, top]])
}

/**
 * Our presets. Tried on the owner's screenshots (two hideout frames, Streets in the evening, a scope at night) next to
 * the example. Out in the open the curve alone does it. Rooms like the hideout have no true black — their darkest tone is
 * a reddish haze eight steps up, all the room within a few steps of it — so «помещения» takes the haze off (black point
 * 5) and the red cast out before the same curve; outside, those filters would tint a neutral night teal.
 */
export const BUILT_IN_PRESETS: ScreenProfile[] = [
  { id: 'builtin-off', name: 'Без изменений', builtIn: true, note: 'Экран как есть', ...NEUTRAL },
  // The owner's own three, tuned by hand in the app (28.10.2026, screen-tuning.json of the owner's PC).
  {
    id: 'builtin-owner-full-dark', name: 'Полная темнота', builtIn: true, note: 'Кромешная тьма в помещениях',
    ...NEUTRAL, gamma: 1.03, highlights: 0.08, contrast: 0.05, brightness: 0.025, haze: 6, cast: 1, vibrance: 51,
    curve: [
      { x: 0, y: 0 }, { x: 0.026, y: 0.047 }, { x: 0.046, y: 0.1501 }, { x: 0.1157, y: 0.2734 }, { x: 0.2591, y: 0.3406 },
      { x: 0.4294, y: 0.4392 }, { x: 0.8754, y: 0.8583 }, { x: 1, y: 1 },
    ],
  },
  {
    id: 'builtin-owner-bright-room', name: 'Светлое помещение', builtIn: true, note: 'Убежище, подвалы, бункеры, Лаборатория',
    ...NEUTRAL, gamma: 1.04, contrast: 0.02, haze: 5, cast: 1, vibrance: 67,
    curve: [
      { x: 0, y: 0.086 }, { x: 0.0078, y: 0.1412 }, { x: 0.0118, y: 0.1882 }, { x: 0.0196, y: 0.2588 }, { x: 0.0314, y: 0.3333 },
      { x: 0.0471, y: 0.4 }, { x: 0.0706, y: 0.4745 }, { x: 0.1098, y: 0.5569 }, { x: 0.1765, y: 0.651 }, { x: 0.2727, y: 0.7527 },
      { x: 0.4314, y: 0.8275 }, { x: 0.6667, y: 0.9176 }, { x: 1, y: 1 },
    ],
  },
  {
    id: 'builtin-owner-bright', name: 'Светло и мягко', builtIn: true, note: 'Ярче вся картинка, мягкий контраст',
    ...NEUTRAL, gamma: 1.8, shadows: 0.22, highlights: -0.04, contrast: 0.06, vibrance: 70,
    curve: [{ x: 0, y: 0 }, { x: 0.2576, y: 0.2678 }, { x: 0.5242, y: 0.5587 }, { x: 1, y: 1 }],
  },
  { id: 'builtin-soft', name: 'Мягко', builtIn: true, note: 'Тени светлее, картинка спокойная', ...NEUTRAL, curve: exposureCurve(4) },
  { id: 'builtin-daylight', name: 'Как днём', builtIn: true, note: 'Ночь и сумерки на улице: светло и видно', ...NEUTRAL, curve: exposureCurve(2) },
  {
    id: 'builtin-daylight-rooms', name: 'Как днём — помещения', builtIn: true, note: 'Убежище, подвалы, бункеры, Лаборатория',
    ...NEUTRAL, curve: exposureCurve(2), haze: 5, cast: 1,
  },
  { id: 'builtin-strong', name: 'Сильно', builtIn: true, note: 'Очень тёмная ночь', ...NEUTRAL, curve: exposureCurve(1.2) },
  { id: 'builtin-max', name: 'Максимум', builtIn: true, note: 'Кромешная тьма', ...NEUTRAL, curve: exposureCurve(0.6, 240) },
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
    ...(number('haze', 0) ? { haze: Math.round(number('haze', 0)) } : {}),
    ...(number('cast', 0) ? { cast: number('cast', 0) } : {}),
  }
}
