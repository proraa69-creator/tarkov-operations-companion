import type { RaidSmokeOptions } from './raidSmokeSetting'

/** The colour the settings dots show for a hue at the chosen tone (RaidSmokeSettings `light`), as #rrggbb. */
export function smokeHex(hue: number, tone: number) {
  const s = 0.8, l = Math.round(52 + tone * (tone > 0 ? 33 : 36)) / 100
  const k = (n: number) => (n + hue / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return `#${[f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('')}`
}

/** One line with every value, for a message or a screenshot (the next build hard-codes the chosen smoke). */
export function smokeSummary(options: RaidSmokeOptions) {
  return `width=${options.width.toFixed(2)} speed=${options.speed.toFixed(2)} hue=${options.hue} (${smokeHex(options.hue, options.tone)}) tone=${options.tone.toFixed(2)} gradient=${options.gradient ? 'on' : 'off'} topHue=${options.topHue} (${smokeHex(options.topHue, options.tone)})`
}
