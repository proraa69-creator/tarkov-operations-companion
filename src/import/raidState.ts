import { parseLogTime } from './eftLogTimeline.js'

export interface RaidState {
  inRaid: boolean
  since?: number
  location?: string
  /** The game's logs are followed, so `inRaid: false` means «not in a raid» (no logs: unknown). */
  tracked?: boolean
}

/** Loading into a raid: location load, matching, network game creation, spawn. */
const RAID_START = /\|application\|(?:LocationLoaded|MatchingCompleted|TRACE-NetworkGameCreate|GameSpawn|GameStarting|GameStarted)/
/** Back in the menu: raid over notification, cancelled matching, profile re-selected, new launch. */
const RAID_END = /userMatchOver|Network game matching (?:cancelled|aborted)|\|application\|(?:Session mode:|PrepareSelectedProfileLocally|CompleteSelectedProfile|SelectProfile )/i
const LOCATION = /Location:\s*([A-Za-z0-9_-]+)/
/**
 * Other application lines that name the map being loaded (owner, 20.10.2026: a PvE raid — «LOCAL | PvE» — on Factory
 * opened Interchange): a local PvE raid creates no network game, so its «TRACE-NetworkGameCreate … Location:» line may
 * never come. The scene the game loads names the map too: «scene preset path:maps/factory_rework_day_preset.bundle
 * rcid:…ScenesPreset.asset», a «"location":"factory4_day"» in a JSON body. Read as hints: one only counts when it names a
 * map the app knows (raidMapToken).
 */
const LOCATION_HINTS = [
  /scene preset path:\s*maps\/([A-Za-z0-9_-]+)/i,
  /rcid:\s*([A-Za-z0-9_-]+)\.ScenesPreset/i,
  /"location"\s*:\s*"([A-Za-z0-9_-]+)"/i,
  /\bLocation:\s*([A-Za-z0-9_-]+)/,
]
/** A raid end this soon after the raid started is part of its loading (see raidStateFromEvents). */
const LOADING_END_MS = 5 * 60 * 1000
/** A hint older than this before the raid starts belongs to another raid. */
const HINT_WINDOW_MS = 15 * 60 * 1000

/**
 * The game's name of a map, as a log line gives it (a location id «factory4_day», «bigmap», a display name «Interchange»,
 * a scene bundle «shopping_mall», «factory_rework_day_preset»), in the app's location naming (canonicalMapId reads it);
 * undefined for anything else (the hideout, the menu).
 */
export function raidMapToken(value: string | undefined): string | undefined {
  const key = (value ?? '').trim().toLowerCase().replace(/_preset$/, '').replace(/\.bundle$/, '')
  if (!key) return undefined
  const rules: Array<[RegExp, string]> = [
    [/^factory|^factory4/, 'factory4_day'],
    [/^bigmap$|^customs/, 'bigmap'],
    [/^woods/, 'Woods'],
    [/^shoreline/, 'Shoreline'],
    [/^interchange|^shopping_?mall/, 'Interchange'],
    [/^rezerv|^reserve/, 'RezervBase'],
    [/^laboratory|^the_?lab$|^labs?$/, 'laboratory'],
    [/^labyrinth/, 'Labyrinth'],
    [/^lighthouse/, 'Lighthouse'],
    [/^tarkovstreets|^streets|^city/, 'TarkovStreets'],
    [/^sandbox|^ground_?zero/, 'Sandbox'],
    [/^terminal/, 'Terminal'],
  ]
  return rules.find(([pattern]) => pattern.test(key))?.[1]
}
/** A crashed client never logs the raid end; no raid lasts this long including loading. */
const MAX_RAID_MS = 3 * 60 * 60 * 1000

/**
 * A raid start or raid end line of a log; `location` is what a start line itself names. `hint`: a line that only names
 * the map being loaded (LOCATION_HINTS) — neither start nor end; it names the raid in progress or the one about to start.
 */
export interface RaidLogEvent {
  at: number
  start: boolean
  location?: string
  hint?: true
}

export function raidStateFromLogs(texts: string[], now = Date.now()): RaidState {
  return raidStateFromEvents(texts.map(raidEventsFromText), now)
}

/** The raid start / end lines of a piece of log text, in order. Lines are independent, so pieces may be read separately. */
export function raidEventsFromText(text: string): RaidLogEvent[] {
  const events: RaidLogEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    const start = RAID_START.test(line)
    const end = !start && RAID_END.test(line)
    const named = start || end ? undefined : hintOf(line)
    if (!start && !end && !named) continue
    const at = parseLogTime(line)
    if (at == null) continue
    if (named) events.push({ at, start: false, hint: true, location: named })
    else events.push(start ? { at, start, location: raidMapToken(LOCATION.exec(line)?.[1]) ?? LOCATION.exec(line)?.[1] ?? hintOf(line) } : { at, start })
  }
  return events
}

/** The map a line names besides the raid start lines (LOCATION_HINTS), when it is a map the app knows. */
function hintOf(line: string) {
  // Application lines only: the end-of-raid notification («UserMatchOver», push-notifications) names the map just left.
  if (!line.includes('|application|')) return undefined
  for (const pattern of LOCATION_HINTS) {
    const token = raidMapToken(pattern.exec(line)?.[1])
    if (token) return token
  }
  return undefined
}

/**
 * Raid state from the events of each log file (files in the order they are read, like raidStateFromLogs). The raid's map:
 * what its start lines name, else the latest hint (LOCATION_HINTS) from the raid itself or from the HINT_WINDOW_MS before
 * it started — a PvE raid may log the map only while loading the scene, before or between the lines that start it. A
 * hint is spent by the raid that took it: the next raid never inherits it.
 */
export function raidStateFromEvents(files: RaidLogEvent[][], now = Date.now()): RaidState {
  const all = files.flat().sort((a, b) => a.at - b.at)
  let last: RaidLogEvent | undefined
  let pending: { location: string; at: number } | undefined
  let since: number | undefined
  for (const event of all) {
    if (event.hint) {
      if (last?.start) last = { ...last, location: event.location }
      else pending = { location: event.location!, at: event.at }
      continue
    }
    if (event.start) {
      if (!last?.start) since = event.at
      const fromHint = pending && event.at - pending.at <= HINT_WINDOW_MS ? pending.location : undefined
      const location = event.location ?? (last?.start ? last.location : undefined) ?? fromHint
      if (fromHint && location === fromHint) pending = undefined
      last = { at: event.at, start: true, location }
    } else {
      // A raid that «ends» minutes after it started is the loading of a local (PvE) raid re-selecting the profile, or an
      // aborted matching: its map waits for the raid that starts next, within HINT_WINDOW_MS.
      if (last?.start && last.location && since !== undefined && event.at - since <= LOADING_END_MS) pending = { location: last.location, at: event.at }
      last = { at: event.at, start: false }
    }
  }
  if (!last?.start || now - last.at > MAX_RAID_MS) return { inRaid: false }
  return { inRaid: true, since: since ?? last.at, location: last.location }
}
