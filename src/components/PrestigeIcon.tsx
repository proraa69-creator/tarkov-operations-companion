import type { RaidMode } from '../domain/types'
import { MAX_PRESTIGE } from '../profile/prestige'

/**
 * The game's prestige badges the owner sent (16.10.2026): one set for PvP (and Season), one for PvE — files
 * `src/assets/prestige/{pvp,pve}-<level>.webp`, the white background cut away. A level without its picture yet keeps the
 * badge drawn for this app below.
 */
const BADGES = import.meta.glob<string>('../assets/prestige/*.webp', { eager: true, query: '?url', import: 'default' })
const badgeOf = (level: number, mode: RaidMode | undefined) => BADGES[`../assets/prestige/${mode === 'pve' ? 'pve' : 'pvp'}-${level}.webp`]

/** A small badge per prestige level (src/profile/prestige.ts), drawn for this app: its own colour and mark, no number. */
const TIER_COLORS = ['#c08a5b', '#b9c2c9', '#e2c35a', '#6fd0e0', '#e0645e', '#9d7be0', '#5fd38d', '#f09a3e', '#e7e2d3', '#ff5c8a']

/** The chevrons of a level: one to five, a second row (a laurel ring) from level 6. */
function marks(level: number) {
  const chevrons = ((level - 1) % 5) + 1
  return { chevrons, ring: level > 5 }
}

/** One prestige level's badge. `label`: the accessible name (none when a text next to it already says it). */
export function PrestigeIcon({ level, size = 28, label, mode }: { level: number; size?: number; label?: string; mode?: RaidMode }) {
  if (!Number.isInteger(level) || level < 1) return null
  const shown = Math.min(level, MAX_PRESTIGE)
  const badge = badgeOf(shown, mode)
  if (badge) {
    return <img className={`prestige-icon prestige-badge-image level-${shown}`} src={badge} width={size} height={size} data-level={shown} data-mode={mode === 'pve' ? 'pve' : 'pvp'}
      draggable={false} {...(label ? { alt: label, title: label } : { alt: '', 'aria-hidden': true })} />
  }
  const color = TIER_COLORS[shown - 1]!
  const { chevrons, ring } = marks(shown)
  const top = 14.6 - (chevrons - 1) * 1.5
  return (
    <svg className={`prestige-icon level-${shown}`} viewBox="0 0 32 32" width={size} height={size} data-level={shown}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} style={{ color }}>
      {label && <title>{label}</title>}
      {ring && <g fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity=".85">
        <path d="M6.2 24.5C3.4 21.4 2.6 16.6 4.4 12.4" />
        <path d="M25.8 24.5c2.8-3.1 3.6-7.9 1.8-12.1" />
        <path d="M4.3 18.2 2.4 17.1M5.2 21.6l-2 .1M4.4 14.8 2.6 13.4M26.8 21.6l2 .1M27.7 18.2l1.9-1.1M27.6 14.8l1.8-1.4" />
      </g>}
      <path d="M16 2.8 26 6.6v8.2c0 6.6-4.3 11.6-10 14.4-5.7-2.8-10-7.8-10-14.4V6.6z" style={{ fill: 'color-mix(in srgb, currentColor 22%, #0e120f)' }} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        {Array.from({ length: chevrons }, (_, index) => {
          const y = top + index * 3
          return <path key={index} d={`M10.4 ${y + 2.6} 16 ${y} l5.6 2.6`} />
        })}
      </g>
      {shown === MAX_PRESTIGE && <circle cx="16" cy="8.4" r="1.4" fill="currentColor" />}
    </svg>
  )
}
