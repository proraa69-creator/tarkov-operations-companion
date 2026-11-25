import { parseLogTime } from './eftLogTimeline.js'

export interface RaidState {
  inRaid: boolean
  since?: number
  location?: string
  /** The game's logs are followed, so `inRaid: false` means «not in a raid» (no logs: unknown). */
  tracked?: boolean
  /**
   * When the raid itself began (the game's «GameStarted» line), after the loading and matching `since` counts in (owner,
   * 15.11.2026: «человек… ждет, пока у него идет загрузка. Как только рейд начинается, должно всплывать уведомление»).
   */
  begun?: number
  /**
   * Whose raid it is, when the logs tell (owner, 25.11.2026, report 231: a Scav joins a raid already running, so the train's
   * countdown from the raid's start is for a PMC only). Undefined: the logs do not say — a solo local PvE raid logs no profile.
   * Read from (the game's own logs, 1.3.x):
   *  - a group's «Got notification | GroupMatchRaidSettings» body: `"side": "Pmc"` (or `"Savage"`), sent before the matching;
   *  - an online raid's «TRACE-NetworkGameCreate profileStatus: 'Profileid: …'» against the profile the menu selected
   *    («PrepareSelectedProfileLocally / CompleteSelectedProfile ProfileId:…»): the same id is the PMC; a Scav plays under its
   *    own profile, so another id is read as the Scav (no Scav raid in the logs seen so far: inferred, not seen).
   */
  side?: RaidSide
}

export type RaidSide = 'pmc' | 'savage'

/** Loading into a raid: location load, matching, network game creation, spawn. */
const RAID_START = /\|application\|(?:LocationLoaded|MatchingCompleted|TRACE-NetworkGameCreate|GameSpawn|GameStarting|GameStarted)/
/** The raid itself begins: the players are in, the loading screen is gone. */
const RAID_BEGINS = /\|application\|GameStarted\b/
/** Back in the menu: raid over notification, cancelled matching, profile re-selected, new launch. */
const RAID_END = /userMatchOver|Network game matching (?:cancelled|aborted)|\|application\|(?:Session mode:|PrepareSelectedProfileLocally|CompleteSelectedProfile|SelectProfile )/i
const LOCATION = /Location:\s*([A-Za-z0-9_-]+)/
/** The profile a network game is created (or rejoined) for: «TRACE-NetworkGameCreate profileStatus: 'Profileid: <id>, …'». */
const RAID_PROFILE = /\|application\|TRACE-NetworkGame(?:Create|Reconnect) profileStatus: 'Profileid: ([0-9a-f]{24})/i
/** The profile the menu selected: the PMC of the mode played. */
const SELECTED_PROFILE = /\|application\|(?:PrepareSelectedProfileLocally|CompleteSelectedProfile) ProfileId:([0-9a-f]{24})/i
/** A record's first line (its time); the lines after it, up to the next one, are its body. */
const RECORD_START = /^\d{4}-\d\d-\d\d /
const RAID_SETTINGS = /Got notification \| GroupMatchRaidSettings\b/
const SETTINGS_SIDE = /^\s*"side"\s*:\s*"(Pmc|Savage)"/i
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
    [/^factory|^factory4|^infected_?factory/, 'factory4_day'],
    [/^bigmap$|^customs/, 'bigmap'],
    [/^woods/, 'Woods'],
    [/^shoreline/, 'Shoreline'],
    [/^interchange|^shopping_?mall/, 'Interchange'],
    [/^rezerv|^reserve/, 'RezervBase'],
    [/^laboratory|^the_?lab$|^labs?$|^infected_?lab/, 'laboratory'],
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
  /** A start line that is the raid itself beginning («GameStarted»), not its loading. */
  begins?: true
  /** The profile id the raid's network game is for (RAID_PROFILE). */
  profile?: string
  /** An end line that selects a profile in the menu (SELECTED_PROFILE): its id. */
  selected?: string
  /** A side-only event, neither start nor end: a group's raid settings name the side of the raid about to start. */
  side?: RaidSide
}

export function raidStateFromLogs(texts: string[], now = Date.now()): RaidState {
  return raidStateFromEvents(texts.map(raidEventsFromText), now)
}

/** The raid start / end lines of a piece of log text, in order. Lines are independent, so pieces may be read separately. */
export function raidEventsFromText(text: string): RaidLogEvent[] {
  const events: RaidLogEvent[] = []
  // the body of a «GroupMatchRaidSettings» notification: its lines have no time of their own
  let settingsAt: number | undefined
  for (const line of text.split(/\r?\n/)) {
    if (settingsAt !== undefined) {
      if (!RECORD_START.test(line)) {
        const side = SETTINGS_SIDE.exec(line)?.[1]
        if (side) { events.push({ at: settingsAt, start: false, side: side.toLowerCase() === 'pmc' ? 'pmc' : 'savage' }); settingsAt = undefined }
        continue
      }
      settingsAt = undefined
    }
    if (RAID_SETTINGS.test(line)) { settingsAt = parseLogTime(line); continue }
    const start = RAID_START.test(line)
    const end = !start && RAID_END.test(line)
    const named = start || end ? undefined : hintOf(line)
    const profile = RAID_PROFILE.exec(line)?.[1]?.toLowerCase()
    if (!start && !end && !named && !profile) continue
    const at = parseLogTime(line)
    if (at == null) continue
    if (named || (profile && !start)) events.push({ at, start: false, hint: true, ...(named ? { location: named } : {}), ...(profile ? { profile } : {}) })
    else if (start) events.push({ at, start, location: raidMapToken(LOCATION.exec(line)?.[1]) ?? LOCATION.exec(line)?.[1] ?? hintOf(line), ...(RAID_BEGINS.test(line) ? { begins: true as const } : {}), ...(profile ? { profile } : {}) })
    else {
      const selected = SELECTED_PROFILE.exec(line)?.[1]?.toLowerCase()
      events.push({ at, start, ...(selected ? { selected } : {}) })
    }
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
  let begun: number | undefined
  // the side (RaidState.side): the menu's selected profile, a group's settings waiting for their raid, the raid's own
  let selected: string | undefined
  let pendingSide: { side: RaidSide; at: number } | undefined
  let side: RaidSide | undefined
  let profileSide: RaidSide | undefined
  const sideOfProfile = (profile: string) => selected ? (profile === selected ? 'pmc' : 'savage') : undefined
  for (const event of all) {
    if (event.side) {
      if (last?.start) side = event.side
      else pendingSide = { side: event.side, at: event.at }
      continue
    }
    if (event.hint) {
      if (event.profile && last?.start) profileSide = sideOfProfile(event.profile) ?? profileSide
      if (!event.location) continue
      if (last?.start) last = { ...last, location: event.location }
      else pending = { location: event.location, at: event.at }
      continue
    }
    if (event.start) {
      if (!last?.start) {
        since = event.at; begun = undefined; profileSide = undefined
        side = pendingSide && event.at - pendingSide.at <= HINT_WINDOW_MS ? pendingSide.side : undefined
        pendingSide = undefined
      }
      if (event.begins && begun === undefined) begun = event.at
      if (event.profile) profileSide = sideOfProfile(event.profile) ?? profileSide
      const fromHint = pending && event.at - pending.at <= HINT_WINDOW_MS ? pending.location : undefined
      const location = event.location ?? (last?.start ? last.location : undefined) ?? fromHint
      if (fromHint && location === fromHint) pending = undefined
      last = { at: event.at, start: true, location }
    } else {
      if (event.selected) selected = event.selected
      // A raid that «ends» minutes after it started is the loading of a local (PvE) raid re-selecting the profile, or an
      // aborted matching: its map waits for the raid that starts next, within HINT_WINDOW_MS.
      if (last?.start && since !== undefined && event.at - since <= LOADING_END_MS) {
        if (last.location) pending = { location: last.location, at: event.at }
        if (side) pendingSide = { side, at: event.at }
      }
      last = { at: event.at, start: false }
    }
  }
  if (!last?.start || now - last.at > MAX_RAID_MS) return { inRaid: false }
  const raidSide = side ?? profileSide
  return { inRaid: true, since: since ?? last.at, location: last.location, ...(begun !== undefined ? { begun } : {}), ...(raidSide ? { side: raidSide } : {}) }
}
