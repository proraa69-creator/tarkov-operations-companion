import { parseLogTime } from './eftLogTimeline.js'

export interface RaidState {
  inRaid: boolean
  since?: number
  location?: string
}

/** Loading into a raid: location load, matching, network game creation, spawn. */
const RAID_START = /\|application\|(?:LocationLoaded|MatchingCompleted|TRACE-NetworkGameCreate|GameSpawn|GameStarting|GameStarted)/
/** Back in the menu: raid over notification, cancelled matching, profile re-selected, new launch. */
const RAID_END = /userMatchOver|Network game matching (?:cancelled|aborted)|\|application\|(?:Session mode:|PrepareSelectedProfileLocally|CompleteSelectedProfile|SelectProfile )/i
const LOCATION = /Location:\s*([A-Za-z0-9_]+)/
/** A crashed client never logs the raid end; no raid lasts this long including loading. */
const MAX_RAID_MS = 3 * 60 * 60 * 1000

/** A raid start or raid end line of a log; `location` is what a start line itself names. */
export interface RaidLogEvent {
  at: number
  start: boolean
  location?: string
}

export function raidStateFromLogs(texts: string[], now = Date.now()): RaidState {
  return raidStateFromEvents(texts.map(raidEventsFromText), now)
}

/** The raid start / end lines of a piece of log text, in order. Lines are independent, so pieces may be read separately. */
export function raidEventsFromText(text: string): RaidLogEvent[] {
  const events: RaidLogEvent[] = []
  for (const line of text.split(/\r?\n/)) {
    const start = RAID_START.test(line)
    if (!start && !RAID_END.test(line)) continue
    const at = parseLogTime(line)
    if (at == null) continue
    events.push(start ? { at, start, location: LOCATION.exec(line)?.[1] } : { at, start })
  }
  return events
}

/** Raid state from the events of each log file (files in the order they are read, like raidStateFromLogs). */
export function raidStateFromEvents(files: RaidLogEvent[][], now = Date.now()): RaidState {
  let last: RaidLogEvent | undefined
  for (const events of files) {
    for (const event of events) {
      if (last && event.at < last.at) continue
      const location = event.start ? event.location ?? (last?.start ? last.location : undefined) : undefined
      last = { at: event.at, start: event.start, location }
    }
  }
  if (!last?.start || now - last.at > MAX_RAID_MS) return { inRaid: false }
  return { inRaid: true, since: last.at, location: last.location }
}
