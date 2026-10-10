import type { Response } from 'express'
import type { FriendStore } from './friendStore.js'
import type { SquadStore } from './squadStore.js'

/**
 * «Заявки в друзья и в отряд — моментально» (owner, 10.10.2026): every account has a version that moves whenever
 * something it shows changed — a friend request to or from it, an answer, a squad invitation, somebody joining or
 * leaving its squad, a friend's or squad mate's quest progress. The app waits on GET /v1/me/social-events (long
 * polling, like /v1/map-updates) and reloads its friends and squad the moment the version moves.
 *
 * In memory: a restarted server starts from its start time, so every app counts that as «changed» once.
 */
export const SOCIAL_WAIT_MS = 25_000
const MAX_WAITING = 5_000
const MAX_WAITING_PER_ACCOUNT = 6

interface Waiter { res: Response; accountId: string; timer: ReturnType<typeof setTimeout> }

export class SocialSignals {
  private readonly versions = new Map<string, number>()
  private readonly waiters = new Map<string, Set<Waiter>>()
  private total = 0

  constructor(private readonly start = Date.now(), private readonly waitMs = SOCIAL_WAIT_MS) {}

  version(accountId: string) { return this.versions.get(accountId) ?? this.start }
  get waiting() { return this.total }

  /** These accounts have something new to show: their waiting apps get the new version now. */
  changed(accountIds: Iterable<string>) {
    for (const accountId of new Set(accountIds)) {
      this.versions.set(accountId, this.version(accountId) + 1)
      for (const waiter of [...(this.waiters.get(accountId) ?? [])]) this.answer(waiter)
    }
  }

  /** Answers now (version differs, or no room to wait) or when this account's version moves / the wait runs out. */
  wait(res: Response, accountId: string, since: number | undefined) {
    const mine = this.waiters.get(accountId)
    if (since === undefined || since !== this.version(accountId) || this.total >= MAX_WAITING || (mine?.size ?? 0) >= MAX_WAITING_PER_ACCOUNT) {
      res.json({ version: this.version(accountId) })
      return
    }
    const waiter: Waiter = { res, accountId, timer: setTimeout(() => this.answer(waiter), this.waitMs) }
    const set = mine ?? new Set<Waiter>()
    set.add(waiter)
    this.waiters.set(accountId, set)
    this.total += 1
    res.on('close', () => this.forget(waiter))
  }

  private answer(waiter: Waiter) {
    if (!this.forget(waiter)) return
    if (!waiter.res.writableEnded && !waiter.res.destroyed) waiter.res.json({ version: this.version(waiter.accountId) })
  }

  private forget(waiter: Waiter) {
    const set = this.waiters.get(waiter.accountId)
    if (!set?.delete(waiter)) return false
    if (!set.size) this.waiters.delete(waiter.accountId)
    this.total -= 1
    clearTimeout(waiter.timer)
    return true
  }
}

/**
 * Everybody who sees something of this account: itself, its friends, both ends of its friend requests, its squad mates,
 * the friends its squad invited and the squads that invited it.
 */
export function socialCircle(friends: FriendStore, squads: SquadStore, accountId: string): string[] {
  const ids = new Set<string>([accountId])
  for (const friend of friends.friends(accountId)) ids.add(friend.accountId)
  for (const other of friends.requestCounterparts(accountId)) ids.add(other)
  const squad = squads.squadOf(accountId)
  for (const member of squad?.members ?? []) ids.add(member.accountId)
  if (squad) for (const invited of squads.invitedAccounts(squad.id)) ids.add(invited)
  for (const invitation of squads.invitationsFor(accountId)) for (const member of invitation.squad.members) ids.add(member.accountId)
  return [...ids]
}

/** Runs a change and signals everybody who saw this account before or sees it after (an answer removes the request). */
export function signalAround(signals: SocialSignals | undefined, circle: ((accountId: string) => string[]) | undefined, accountId: string) {
  if (!signals || !circle) return <T>(work: () => T) => work()
  return <T>(work: () => T): T => {
    const before = circle(accountId)
    const result = work()
    signals.changed([...before, ...circle(accountId)])
    return result
  }
}
