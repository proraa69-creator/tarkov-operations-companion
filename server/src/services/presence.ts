/**
 * «Онлайн сейчас» (owner, 14.10.2026: «сколько человек сейчас в приложении онлайн», in the owner app under «Ваши
 * предложения» and in the website's admin panel): the distinct accounts that used a Raid OS app — the PC app or the
 * phone app — within the last PRESENCE_WINDOW_MS.
 *
 * The signal is the apps' heartbeat POST /v1/me/presence (routes/presence.ts), sent about once a minute while an app
 * runs and its user is signed in, with the app's device id. The device must be an active device of the account bound to
 * this very session (as for the paid data routes); its name, chosen by the app at sign-in (services/entitlement.ts),
 * tells the PC («Windows · …», «macOS · …», «Linux · …», electron/entitlement.ts) from the phone («Android · Raid OS»,
 * «iOS · Raid OS», src/sync/webEntitlement.ts). The browser preview («Браузер · Raid OS») and the website do not count.
 *
 * Kept in memory only: no database write per heartbeat (the device check is one primary-key read). A restarted server
 * counts from zero until the apps' next heartbeat, at most a minute later. The DB columns `accounts.last_seen_at` and
 * `account_devices.last_seen_at` are written at most every 5 minutes and also by the website, so they cannot answer
 * «who is in the app right now».
 */
export const PRESENCE_WINDOW_MS = 5 * 60 * 1000
/** How often the apps send the heartbeat (src/sync/presence.ts). */
export const PRESENCE_HEARTBEAT_MS = 60 * 1000

export type PresenceClient = 'pc' | 'phone'

/** The app behind a device name (see the file comment), or undefined for the browser and anything unknown. */
export function presenceClientOf(deviceName: string): PresenceClient | undefined {
  if (/^(?:Windows|macOS|Linux)(?:\s|$)/.test(deviceName)) return 'pc'
  if (/^(?:Android|iOS)(?:\s|$)/.test(deviceName)) return 'phone'
  return undefined
}

export interface OnlineCount {
  /** Distinct accounts seen in an app within the window. */
  online: number
  /** Of them: seen in the PC app / in the phone app (an account in both counts in both, and once in `online`). */
  pc: number
  phone: number
  windowMinutes: number
  at: string
}

export class PresenceTracker {
  private readonly seen = new Map<string, Partial<Record<PresenceClient, number>>>()
  private readonly now: () => number
  private readonly windowMs: number
  private prunedAt = 0

  constructor(options: { now?: () => number; windowMs?: number } = {}) {
    this.now = options.now ?? Date.now
    this.windowMs = options.windowMs ?? PRESENCE_WINDOW_MS
  }

  /** This account is in the app of this kind right now. */
  note(accountId: string, client: PresenceClient) {
    const now = this.now()
    const entry = this.seen.get(accountId) ?? {}
    entry[client] = now
    this.seen.set(accountId, entry)
    // Accounts gone for longer than the window are dropped now and then, so the map holds about the online ones only.
    if (now - this.prunedAt >= this.windowMs) this.prune(now)
  }

  count(): OnlineCount {
    const now = this.now()
    this.prune(now)
    let online = 0
    let pc = 0
    let phone = 0
    for (const entry of this.seen.values()) {
      const inPc = entry.pc !== undefined && now - entry.pc < this.windowMs
      const inPhone = entry.phone !== undefined && now - entry.phone < this.windowMs
      if (inPc) pc++
      if (inPhone) phone++
      if (inPc || inPhone) online++
    }
    return { online, pc, phone, windowMinutes: Math.round(this.windowMs / 60_000), at: new Date(now).toISOString() }
  }

  private prune(now: number) {
    this.prunedAt = now
    for (const [accountId, entry] of this.seen) {
      const latest = Math.max(entry.pc ?? 0, entry.phone ?? 0)
      if (now - latest >= this.windowMs) this.seen.delete(accountId)
    }
  }
}
