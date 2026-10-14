import { logScanSignature, type ModeLogScanResult } from './eftLogTimeline'

/**
 * The desktop's log scans reach the page through `logs:updated` only (electron/logWatcher.ts), and the page asks for the
 * latest one each time it opens (src/app/AppShell.tsx). A scan is applied once per local profile (P20): the latest one
 * again on a remount — the interface language changed — or twice at the start must not apply it, push it to the server
 * and switch the mode again. Kept outside React, across remounts.
 */
const applied = new Map<string, string>()

/** True the first time this scan comes for this local profile (then it is applied); false for the same one again. */
export function firstApplication(result: ModeLogScanResult, profileId: string) {
  const signature = result.signature ?? logScanSignature(result)
  if (applied.get(profileId) === signature) return false
  applied.set(profileId, signature)
  return true
}

/** «Очистить все данные» and the tests: every scan counts as new again. */
export function forgetAppliedLogResults() {
  applied.clear()
}
