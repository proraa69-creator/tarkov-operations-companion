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

export function raidStateFromLogs(texts: string[], now = Date.now()): RaidState {
  let last: { at: number; start: boolean; location?: string } | undefined
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      const start = RAID_START.test(line)
      if (!start && !RAID_END.test(line)) continue
      const at = parseLogTime(line)
      if (at == null || (last && at < last.at)) continue
      const location = start ? LOCATION.exec(line)?.[1] ?? (last?.start ? last.location : undefined) : undefined
      last = { at, start, location }
    }
  }
  if (!last?.start || now - last.at > MAX_RAID_MS) return { inRaid: false }
  return { inRaid: true, since: last.at, location: last.location }
}
