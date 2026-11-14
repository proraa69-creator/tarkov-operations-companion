/**
 * «День и ночь» (owner, 15.11.2026: «ориентируется по времени компьютера и… плавно меняется цвет с дневного на ночной»): the
 * scheme's colours follow the clock of this device. Four moments of the day each have a palette (night, dawn, day, dusk); between
 * them every colour slides over a couple of hours, and the app takes the new mix every minute, too little to notice at once.
 * Three looks, until the owner picks one (styles/theme-daynight.css):
 * - `olive` «Олива»: the olive scheme, brighter and warmer by day, deep and quiet at night;
 * - `sky`   «Небо»: the light of the sky over the screen: peach dawn, blue day, violet dusk, navy night with a silver accent;
 * - `red`   «Ночное зрение»: olive by day, red light at night, as a red torch keeps the eyes used to the dark.
 */
export const DAY_NIGHT_VARIANTS = ['olive', 'sky', 'red'] as const
export type DayNightVariant = typeof DAY_NIGHT_VARIANTS[number]
export const DEFAULT_DAY_NIGHT_VARIANT: DayNightVariant = 'olive'
const VARIANT_KEY = 'raidos-daynight-variant'

type Palette = Record<string, string>
interface Look { night: Palette; dawn: Palette; day: Palette; dusk: Palette }

// The variables a palette sets: the scheme's own (styles/tokens.css) and the light over the screen (--dn-*).
const OLIVE: Look = {
  night: { bg: '#060a08', 'bg-elevated': '#0b110e', panel: '#0f1612', 'panel-2': '#131c17', 'panel-3': '#19241e', line: '#202d25', 'line-strong': '#2f4036', 'line-soft': '#26352c', text: '#dde5dd', 'text-muted': '#87958b', 'text-dim': '#5c695f', brass: '#a8925e', 'brass-strong': '#c2a466', green: '#6f8f73', 'surf-0': '#050907', 'surf-1': '#0c130f', 'surf-2': '#111a15', 'dn-sky': '#0b1418', 'dn-glow': 'rgb(150 175 215 / 7%)' },
  dawn: { bg: '#110f0b', 'bg-elevated': '#181510', panel: '#1d1a14', 'panel-2': '#231f18', 'panel-3': '#2c271e', line: '#383126', 'line-strong': '#4c4334', 'line-soft': '#41392c', text: '#f2ece2', 'text-muted': '#aea290', 'text-dim': '#7c7262', brass: '#d9a866', 'brass-strong': '#efc07c', green: '#8fa47c', 'surf-0': '#0e0c09', 'surf-1': '#16130e', 'surf-2': '#1c1913', 'dn-sky': '#3a2a20', 'dn-glow': 'rgb(255 176 112 / 15%)' },
  day: { bg: '#141c17', 'bg-elevated': '#1a241e', panel: '#202c25', 'panel-2': '#25332b', 'panel-3': '#2e3e34', line: '#3a4c41', 'line-strong': '#4e6457', 'line-soft': '#435649', text: '#f5f8f3', 'text-muted': '#b2bfb4', 'text-dim': '#85938a', brass: '#d4b46c', 'brass-strong': '#ecca7c', green: '#8db592', 'surf-0': '#111814', 'surf-1': '#18211c', 'surf-2': '#1e2a23', 'dn-sky': '#2c3b33', 'dn-glow': 'rgb(255 248 220 / 11%)' },
  dusk: { bg: '#130e0c', 'bg-elevated': '#1a1310', panel: '#201814', 'panel-2': '#271d18', 'panel-3': '#30241e', line: '#3c2d25', 'line-strong': '#523e33', 'line-soft': '#46352c', text: '#f0e6de', 'text-muted': '#ab9a8d', 'text-dim': '#7a6a5f', brass: '#e09650', 'brass-strong': '#f4ad68', green: '#94976e', 'surf-0': '#0f0b09', 'surf-1': '#17110e', 'surf-2': '#1d1612', 'dn-sky': '#4a2620', 'dn-glow': 'rgb(255 120 72 / 15%)' },
}

const SKY: Look = {
  night: { bg: '#060912', 'bg-elevated': '#0a0f1b', panel: '#0e1422', 'panel-2': '#121a2b', 'panel-3': '#182236', line: '#1f2a40', 'line-strong': '#2e3c58', 'line-soft': '#25314a', text: '#dfe5f0', 'text-muted': '#8b97ad', 'text-dim': '#5e6a80', brass: '#a9b9d8', 'brass-strong': '#c9d6ef', green: '#7f9fb5', 'surf-0': '#05080f', 'surf-1': '#0b1019', 'surf-2': '#101624', 'dn-sky': '#0d1a38', 'dn-glow': 'rgb(170 195 255 / 10%)' },
  dawn: { bg: '#140e14', 'bg-elevated': '#1b131b', panel: '#221822', 'panel-2': '#291d29', 'panel-3': '#332433', line: '#40303f', 'line-strong': '#584457', 'line-soft': '#4a3949', text: '#f6ecef', 'text-muted': '#b8a2ad', 'text-dim': '#86727c', brass: '#f2a37c', 'brass-strong': '#ffbf98', green: '#c09aa6', 'surf-0': '#100b10', 'surf-1': '#181118', 'surf-2': '#1f161f', 'dn-sky': '#6a3a4c', 'dn-glow': 'rgb(255 170 140 / 18%)' },
  day: { bg: '#0d1822', 'bg-elevated': '#12202c', panel: '#172735', 'panel-2': '#1c2e3e', 'panel-3': '#23384b', line: '#2d465b', 'line-strong': '#3f5e78', 'line-soft': '#355066', text: '#f3f7fb', 'text-muted': '#a9bccc', 'text-dim': '#7b8fa0', brass: '#e9c66c', 'brass-strong': '#ffdc84', green: '#86b6c9', 'surf-0': '#0a141c', 'surf-1': '#101d28', 'surf-2': '#152431', 'dn-sky': '#2f6a99', 'dn-glow': 'rgb(255 250 225 / 14%)' },
  dusk: { bg: '#120c1a', 'bg-elevated': '#181024', panel: '#1f152d', 'panel-2': '#251a36', 'panel-3': '#2e2142', line: '#3a2b52', 'line-strong': '#513d6e', 'line-soft': '#45345f', text: '#f1e8f4', 'text-muted': '#ad9cbd', 'text-dim': '#7c6c8c', brass: '#ff9a5c', 'brass-strong': '#ffb47c', green: '#b28fbf', 'surf-0': '#0e0914', 'surf-1': '#150e1e', 'surf-2': '#1c1328', 'dn-sky': '#6b2f55', 'dn-glow': 'rgb(255 130 90 / 18%)' },
}

const RED: Look = {
  night: { bg: '#080404', 'bg-elevated': '#0e0707', panel: '#130909', 'panel-2': '#180b0b', 'panel-3': '#200f0f', line: '#2a1313', 'line-strong': '#3d1c1b', 'line-soft': '#331717', text: '#e8c2bb', 'text-muted': '#a3786f', 'text-dim': '#6e4c46', brass: '#cf5444', 'brass-strong': '#e96c5a', green: '#b0584a', 'surf-0': '#060303', 'surf-1': '#0d0606', 'surf-2': '#120808', 'dn-sky': '#1c0606', 'dn-glow': 'rgb(255 60 40 / 8%)' },
  dawn: OLIVE.dawn,
  day: OLIVE.day,
  dusk: { ...OLIVE.dusk, brass: '#dc7a4a', 'brass-strong': '#f08e5e', 'dn-sky': '#3e1712', 'dn-glow': 'rgb(255 90 60 / 14%)' },
}

const LOOKS: Record<DayNightVariant, Look> = { olive: OLIVE, sky: SKY, red: RED }

/** The hours each palette holds (24-hour clock); the colours slide between neighbours. */
const STOPS: Array<[number, keyof Look]> = [[0, 'night'], [4.5, 'night'], [6.5, 'dawn'], [9, 'day'], [17, 'day'], [19.5, 'dusk'], [21.5, 'night'], [24, 'night']]

const smooth = (t: number) => t * t * (3 - 2 * t)

function parse(color: string): [number, number, number, number] {
  if (color.startsWith('#')) return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16), 1]
  const match = /rgb\((\d+) (\d+) (\d+) \/ (\d+)%\)/.exec(color)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]) / 100] : [0, 0, 0, 1]
}

function mix(a: string, b: string, t: number) {
  const [r1, g1, b1, a1] = parse(a)
  const [r2, g2, b2, a2] = parse(b)
  const at = (x: number, y: number) => Math.round(x + (y - x) * t)
  const alpha = a1 + (a2 - a1) * t
  return alpha >= 1 ? `rgb(${at(r1, r2)} ${at(g1, g2)} ${at(b1, b2)})` : `rgb(${at(r1, r2)} ${at(g1, g2)} ${at(b1, b2)} / ${Math.round(alpha * 1000) / 10}%)`
}

/** The colours at this hour of the day (0–24, fractions are minutes). */
export function dayNightPalette(hour: number, variant: DayNightVariant = DEFAULT_DAY_NIGHT_VARIANT): Palette {
  const look = LOOKS[variant]
  const h = ((hour % 24) + 24) % 24
  const next = STOPS.findIndex(([at]) => at > h)
  const [fromAt, from] = STOPS[Math.max(0, next - 1)]!
  const [toAt, to] = STOPS[next < 0 ? STOPS.length - 1 : next]!
  const t = toAt > fromAt ? smooth((h - fromAt) / (toAt - fromAt)) : 0
  const a = look[from]
  const b = look[to]
  return Object.fromEntries(Object.keys(a).map((name) => [name, mix(a[name]!, b[name] ?? a[name]!, t)]))
}

/** The scheme's look; the previews pick another through localStorage. */
export function dayNightVariant(): DayNightVariant {
  try {
    const saved = localStorage.getItem(VARIANT_KEY)
    if (DAY_NIGHT_VARIANTS.includes(saved as DayNightVariant)) return saved as DayNightVariant
  } catch { /* storage unavailable */ }
  return DEFAULT_DAY_NIGHT_VARIANT
}

/** The hour now on this device; a preview may set `window.__raidosDayNightHour` to show another one. */
function hourNow() {
  const forced = (window as Window & { __raidosDayNightHour?: number }).__raidosDayNightHour
  if (typeof forced === 'number' && Number.isFinite(forced)) return forced
  const now = new Date()
  return now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600
}

let applied: string[] = []
let timer: ReturnType<typeof setInterval> | undefined

/** Paints the colours of this moment on the page. */
export function paintDayNight(hour = hourNow(), variant = dayNightVariant()) {
  const root = document.documentElement
  const palette = dayNightPalette(hour, variant)
  root.setAttribute('data-daynight', variant)
  applied = Object.keys(palette).map((name) => `--${name}`)
  for (const [name, value] of Object.entries(palette)) root.style.setProperty(`--${name}`, value)
}

/** On while «День и ночь» is the scheme: the colours follow the clock, a new mix every minute and when the app comes back. */
export function startDayNight() {
  paintDayNight()
  if (timer) return
  timer = setInterval(() => paintDayNight(), 60_000)
  document.addEventListener('visibilitychange', onVisible)
}

function onVisible() {
  if (document.visibilityState === 'visible') paintDayNight()
}

export function stopDayNight() {
  if (timer) clearInterval(timer)
  timer = undefined
  document.removeEventListener('visibilitychange', onVisible)
  const root = document.documentElement
  for (const name of applied) root.style.removeProperty(name)
  applied = []
  root.removeAttribute('data-daynight')
}
