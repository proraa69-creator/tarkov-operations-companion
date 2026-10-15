import type { ServerAccountStatus } from '../electron'

/**
 * The first-run guide (owner, 12.10.2026: «при первом запуске каждого окна должно быть всплывающее окно, это только когда
 * аккаунт только зарегистрировали и первый раз вошли в приложение»): one tip per section, shown on the section's first
 * visit, until the player presses «Принял». Kept per account on this computer; nothing goes to the server.
 */
export type GuideStep = SectionStep | 'quest-sync'
/** The tips that belong to a section of the app (guideStepFor). */
export type SectionStep = 'quests' | 'maps' | 'kappa'

/** An account registered this recently is new: its owner gets the guide on the computer they sign in on. */
export const NEW_ACCOUNT_MS = 7 * 24 * 60 * 60 * 1000

const PREFIX = 'raidos-first-run-guide-v1:'
/** When the tips may show (src/onboarding/FirstRunGuide.tsx). */
export const GUIDE_TIMING = {
  /** The subscription and update notices open within the first seconds: the guide comes after them. */
  startupGraceMs: 5000,
  /** The page draws its content (and the part a tip points at) after the route changes. */
  settleMs: 700,
  /** How long a tip looks for the part it points at; then it shows without the pointer. */
  targetWaitMs: 4000,
}

/** Fired on this window when a record changes (a step accepted, «Показать снова»). */
export const GUIDE_CHANGED_EVENT = 'raidos-first-run-guide-changed'

export interface GuideRecord {
  /** When the guide started for this account on this computer. */
  started: string
  accepted: GuideStep[]
}

const keyOf = (email: string) => `${PREFIX}${email.trim().toLowerCase()}`
const STEPS: SectionStep[] = ['quests', 'maps', 'kappa']
/** Every step a record may hold: the sections' tips and the quest sync tip of the Overview (QuestSyncTip.tsx). */
const KNOWN_STEPS: GuideStep[] = [...STEPS, 'quest-sync']

export function readGuide(email: string): GuideRecord | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(keyOf(email)) ?? 'null') as Partial<GuideRecord> | null
    if (!parsed || typeof parsed.started !== 'string') return null
    return { started: parsed.started, accepted: Array.isArray(parsed.accepted) ? parsed.accepted.filter((step): step is GuideStep => KNOWN_STEPS.includes(step as GuideStep)) : [] }
  } catch {
    return null
  }
}

function writeGuide(email: string, record: GuideRecord) {
  try { localStorage.setItem(keyOf(email), JSON.stringify(record)) } catch { /* storage unavailable: the tip may show again */ }
  window.dispatchEvent(new Event(GUIDE_CHANGED_EVENT))
}

/**
 * «Показать снова»: every section's tip once more, whatever the account's age. The quest sync tip stays accepted: it is
 * shown once per account on this computer, ever (owner, 15.10.2026: «только один раз при первичном входе в аккаунт»).
 */
export function restartGuide(email: string, now = new Date()) {
  const kept = readGuide(email)?.accepted.includes('quest-sync') ? ['quest-sync' as const] : []
  writeGuide(email, { started: now.toISOString(), accepted: kept })
}

export function acceptStep(email: string, step: GuideStep) {
  const record = readGuide(email)
  if (!record || record.accepted.includes(step)) return
  writeGuide(email, { ...record, accepted: [...record.accepted, step] })
}

/**
 * A new account: registered within a week, or one whose free day still waits for its first sign-in in an app (the
 * server reports `trialPendingDays` until then — an older account signing in for the first time).
 */
export function isNewAccount(status: Pick<ServerAccountStatus, 'createdAt' | 'subscription'>, now = Date.now()) {
  if (status.subscription?.trialPendingDays) return true
  const created = status.createdAt ? Date.parse(status.createdAt) : Number.NaN
  return Number.isFinite(created) && now - created >= -60_000 && now - created <= NEW_ACCOUNT_MS
}

/**
 * The guide of the signed-in account: its record, started now when the account is new and has none here. Older accounts
 * get none (and nothing is stored for them).
 */
export function guideForAccount(status: ServerAccountStatus | null, now = new Date()): { email: string; record: GuideRecord } | null {
  const email = status?.signedIn ? status.email : undefined
  if (!email) return null
  const record = readGuide(email)
  if (record) return { email, record }
  if (!isNewAccount(status!, now.getTime())) return null
  const started = { started: now.toISOString(), accepted: [] }
  try { localStorage.setItem(keyOf(email), JSON.stringify(started)) } catch { /* the guide still shows this time */ }
  return { email, record: started }
}

/**
 * The section a path belongs to. The PC app (desktop layout) has all three tips; the phone has no story sync, so only
 * the map checkmarks and the Kappa items. The «Мини Карта» tip went with the in-game overlays (15.10.2026).
 */
export function guideStepFor(pathname: string, phone: boolean): SectionStep | null {
  if (pathname === '/quests') return phone ? null : 'quests'
  if (pathname === '/maps' || pathname.startsWith('/maps/')) return 'maps'
  if (pathname === '/kappa-items') return 'kappa'
  return null
}

/**
 * The quest sync tip of the old releases was accepted on this computer under this key: it never shows here again. New
 * acceptances are kept per account, in the guide record (step `quest-sync`).
 */
export const QUEST_SYNC_TIP_KEY = 'raidos-quest-sync-tip-v1'

export interface QuestSyncTipInput {
  desktop: boolean
  phone: boolean
  pathname: string
  /** Accepted already: in this account's guide record, or under the old key on this computer. */
  seen: boolean
  /**
   * The signed-in account is a new one on its first sign-ins here: it has a guide record (guideForAccount). An existing
   * account (no record, not new) never gets the tip (owner, 15.10.2026: «это окно должно появляться только один раз при
   * первичном входе в аккаунт, после этого не должно быть снова»).
   */
  newAccount: boolean
  /** The catalog is still loading («Загружаем актуальную базу»): never over that screen. */
  loading: boolean
  logsCover?: boolean
  mode?: string
}

/**
 * The quest sync tip is due: the PC app, on its Overview with the catalog loaded, for a new account that has not accepted
 * it on this computer — and the game's logs do not already hold the whole quest history of the mode shown (`logsCover`,
 * src/import/logCoverage.ts): the tip asks to open «Задания» and scroll through it, which then adds nothing.
 */
export function questSyncTipDue({ desktop, phone, pathname, seen, newAccount, loading, logsCover = false, mode }: QuestSyncTipInput) {
  // The Tasks table is read in PvE only (owner, 15.10.2026): PvP and Season players are never asked to open it.
  return desktop && !phone && pathname === '/' && newAccount && !loading && !seen && !logsCover && mode !== 'pvp' && mode !== 'seasonal'
}

/** Every tip this layout has, accepted: the guide is over. */
export function guideFinished(record: GuideRecord, phone: boolean) {
  const steps: SectionStep[] = phone ? ['maps', 'kappa'] : STEPS
  return steps.every((step) => record.accepted.includes(step))
}
