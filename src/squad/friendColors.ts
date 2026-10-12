/**
 * Each friend's colour (owner, 12.10.2026: «подсвечиваются эти точки согласно присвоеному цвету в разделе друзья»): shown
 * by the friend's name in «Друзья», on their chips in «План рейда» and on their quest points on the map. Given once, in
 * the order friends first appear, and kept on this computer, so a friend keeps the colour when others come and go.
 */
export const YOU_COLOR = '#c4a665'
export const FRIEND_COLORS = ['#7fb08a', '#a78bfa', '#6fa8c9', '#d48b80', '#e2c35a', '#5fc9c0', '#e88bc4', '#d9874a'] as const

const KEY = 'raidos-friend-colors-v1'

function readAssigned(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && (entry[1] as number) >= 0))
  } catch {
    return {}
  }
}

/** The colour of every friend id given: the one it has, else the least used one (new friends spread over the palette). */
export function friendColors(friendIds: string[]): Map<string, string> {
  const assigned = readAssigned()
  let changed = false
  for (const id of friendIds) {
    if (assigned[id] !== undefined) continue
    const used = FRIEND_COLORS.map((_, index) => friendIds.filter((other) => assigned[other] === index).length)
    assigned[id] = used.indexOf(Math.min(...used))
    changed = true
  }
  if (changed) {
    try { localStorage.setItem(KEY, JSON.stringify(assigned)) } catch { /* storage unavailable: colours are worked out again next time */ }
  }
  return new Map(friendIds.map((id) => [id, FRIEND_COLORS[assigned[id] % FRIEND_COLORS.length]]))
}
