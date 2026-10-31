import { createHash } from 'node:crypto'

/**
 * Functions the owner turns on for one account for a while, ending by themselves (owner, 31.10.2026: «добавь только ему
 * на 1 день такую функцию. после этого она отключится сама»). Accounts are named by the SHA-256 of their lowercase
 * e-mail, so no address is kept in the source.
 *
 * `questTableScan`: the app reads the game's «Задания» table from the screen even when the game's logs look complete
 * (src/components/StoryScreenScanner.tsx) — a player whose logs showed his finished quests and only 3 of his current ones.
 */
export interface TrialFeatures { questTableScan: string | null }

const TRIALS: Array<{ emailSha256: string; feature: keyof TrialFeatures; until: string }> = [
  { emailSha256: '1113b475e5bf253e2259ee7aed94afb3cf96e45b5328196da915c10b2eb1cd7e', feature: 'questTableScan', until: '2026-11-01T20:00:00.000Z' },
]

const digest = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex')

/** The account's trial functions still on at `now`: each one's end, or null. */
export function trialFeatures(email: string | undefined, now = Date.now()): TrialFeatures {
  const features: TrialFeatures = { questTableScan: null }
  if (!email) return features
  const own = digest(email)
  for (const trial of TRIALS) {
    if (trial.emailSha256 === own && Date.parse(trial.until) > now) features[trial.feature] = trial.until
  }
  return features
}
