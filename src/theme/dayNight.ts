/**
 * «Смена дня и ночи» (owner, 15.11.2026: «ориентируется по времени компьютера и… плавно меняется цвет с дневного на ночной»; the
 * olive look chosen of three): the olive scheme follows the clock of this device, brighter and warmer by day, orange at dawn and
 * dusk, deep and quiet at night. Four moments of the day each have a palette; between them every colour slides over a couple of
 * hours, and the app takes the new mix every minute, too little to notice at once (styles/theme-daynight.css). Owner, 19.11.2026:
 * «сделай как-то выраженно… где ночь, где день… Ночью… ближе к такому фиолетовому цвету»: the night is violet, the day lighter and warmer.
 */
type Palette = Record<string, string>
interface Look { night: Palette; dawn: Palette; day: Palette; dusk: Palette }

// The variables a palette sets: the scheme's own (styles/tokens.css) and the light over the screen (--dn-*).
const OLIVE: Look = {
  // Owner, 24.11.2026: «нужно поменять фиолетовый цвет. Сделай его более темным, он слишком светлый… ночью у нас будет очень
  // темно-фиолетовый цвет»: the sky over the screen and the menu nearly black violet, the lavender accents dimmed.
  night: { bg: '#07050d', 'bg-elevated': '#0b0814', panel: '#0e0a19', 'panel-2': '#120d20', 'panel-3': '#191329', line: '#221a35', 'line-strong': '#32274a', 'line-soft': '#2a203f', text: '#e6e1f2', 'text-muted': '#9f97b8', 'text-dim': '#6c6488', brass: '#9580cf', 'brass-strong': '#b29ee8', green: '#7f93c4', 'surf-0': '#050309', 'surf-1': '#090611', 'surf-2': '#0d0918', 'dn-sky': '#140a28', 'dn-glow': 'rgb(120 80 220 / 10%)' },
  dawn: { bg: '#110f0b', 'bg-elevated': '#181510', panel: '#1d1a14', 'panel-2': '#231f18', 'panel-3': '#2c271e', line: '#383126', 'line-strong': '#4c4334', 'line-soft': '#41392c', text: '#f2ece2', 'text-muted': '#aea290', 'text-dim': '#7c7262', brass: '#d9a866', 'brass-strong': '#efc07c', green: '#8fa47c', 'surf-0': '#0e0c09', 'surf-1': '#16130e', 'surf-2': '#1c1913', 'dn-sky': '#3a2a20', 'dn-glow': 'rgb(255 176 112 / 15%)' },
  // Owner, 24.11.2026, of four day variants: «пасмурно» — an overcast day, steel grey with a cool sky and warm gold accents.
  day: { bg: '#1c2024', 'bg-elevated': '#23282d', panel: '#2a3036', 'panel-2': '#313840', 'panel-3': '#3b434c', line: '#48515b', 'line-strong': '#626d79', 'line-soft': '#545e69', text: '#f5f7f9', 'text-muted': '#c0c7ce', 'text-dim': '#8f979f', brass: '#e2bd72', 'brass-strong': '#f2d290', green: '#9ec3a8', 'surf-0': '#181b1f', 'surf-1': '#1f2328', 'surf-2': '#262b31', 'dn-sky': '#6d8093', 'dn-glow': 'rgb(235 242 255 / 18%)' },
  dusk: { bg: '#130e0c', 'bg-elevated': '#1a1310', panel: '#201814', 'panel-2': '#271d18', 'panel-3': '#30241e', line: '#3c2d25', 'line-strong': '#523e33', 'line-soft': '#46352c', text: '#f0e6de', 'text-muted': '#ab9a8d', 'text-dim': '#7a6a5f', brass: '#e09650', 'brass-strong': '#f4ad68', green: '#94976e', 'surf-0': '#0f0b09', 'surf-1': '#17110e', 'surf-2': '#1d1612', 'dn-sky': '#4a2620', 'dn-glow': 'rgb(255 120 72 / 15%)' },
}



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
export function dayNightPalette(hour: number): Palette {
  const look = OLIVE
  const h = ((hour % 24) + 24) % 24
  const next = STOPS.findIndex(([at]) => at > h)
  const [fromAt, from] = STOPS[Math.max(0, next - 1)]!
  const [toAt, to] = STOPS[next < 0 ? STOPS.length - 1 : next]!
  const t = toAt > fromAt ? smooth((h - fromAt) / (toAt - fromAt)) : 0
  const a = look[from]
  const b = look[to]
  return Object.fromEntries(Object.keys(a).map((name) => [name, mix(a[name]!, b[name] ?? a[name]!, t)]))
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
export function paintDayNight(hour = hourNow()) {
  const root = document.documentElement
  const palette = dayNightPalette(hour)
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
}
