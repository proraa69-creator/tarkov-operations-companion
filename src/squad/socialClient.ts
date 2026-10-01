/**
 * «Отряд» and friends in the app: calls to /v1/squads and /v1/friends through the same whitelisted gateway as the rest
 * of the account (electron/serviceGateway.ts on the PC, sync/webAccount.ts on the phone). The server decides
 * everything (membership, friendship, subscription); answers are shape-checked before the UI uses them.
 */
import type { RaidMode } from '../domain/types'
import { serviceClient } from '../account/nicknameBinding'
import { cleanIpcError, refreshServerStatus } from '../sync/serverSync'
import { apiBaseUrl } from '../sync/webAccount'
import type { SharedObjectiveProgress, SquadComputed } from './squadOverview'

export type Nicknames = Partial<Record<RaidMode, string>>

export interface SquadMember {
  memberId: string
  nickname: string | null
  isYou: boolean
  isOwner: boolean
  joinedAt: string
  hidden?: boolean
  activeQuestIds?: string[]
  objectives?: Record<string, SharedObjectiveProgress[]>
  completedCount?: number
  lastSyncAt?: string | null
}
export interface SquadInfo { id: string; name: string; maxMembers: number; isOwner: boolean; createdAt: string; members: SquadMember[] }
export interface SquadInvitation { invitationId: string; squadName: string; from: string | null; members: number; expiresAt: string }
export interface SquadMine { squad: SquadInfo | null; access: boolean; invitations: SquadInvitation[] }
export interface SquadOverview extends Partial<Omit<SquadComputed, 'sharedQuests'>> { squad: SquadInfo; mode: RaidMode; sharedQuests: SquadComputed['sharedQuests']; generatedAt: string }

export interface Friend { friendId: string; nicknames: Nicknames; since: string; hideMyProgress: boolean; sharesProgress: boolean }
export interface FriendsOverview {
  code: string
  access: boolean
  friends: Friend[]
  incoming: Array<{ requestId: string; friendId: string; nicknames: Nicknames; createdAt: string }>
  outgoing: Array<{ requestId: string; label: string; createdAt: string }>
  blocked: Array<{ friendId: string; nicknames: Nicknames }>
}
export interface PlannerPerson { id: string; nickname: string | null; hidden: boolean; isYou?: boolean; activeQuestIds: string[]; objectives: Record<string, SharedObjectiveProgress[]>; completedCount: number; lastSyncAt: string | null }

export const SQUAD_ID = /^[a-f0-9]{32}$/
const HEX24 = /^[a-f0-9]{24}$/
const TASK_ID = /^[A-Za-z0-9:_-]{1,64}$/

export class SignedOutError extends Error {
  constructor() { super('Войдите в аккаунт сервера') }
}

async function request<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const send = serviceClient()
  if (!send) throw new SignedOutError()
  let answer: unknown
  try {
    answer = await send(method, path, body)
  } catch (error) {
    const message = cleanIpcError(error)
    if (/недоступен|Сессия истекла/i.test(message)) void refreshServerStatus()
    throw new Error(message, { cause: error })
  }
  // null: signed out (the gateway refuses personal paths without a session) — or 204 No Content for actions.
  if (answer === null && method === 'GET') throw new SignedOutError()
  return answer as T
}

const ids = (value: unknown, pattern = TASK_ID) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && pattern.test(entry)) : [])

function cleanMember(raw: unknown): SquadMember | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!value || typeof value.memberId !== 'string' || !HEX24.test(value.memberId)) return null
  return {
    memberId: value.memberId,
    nickname: typeof value.nickname === 'string' ? value.nickname : null,
    isYou: value.isYou === true,
    isOwner: value.isOwner === true,
    joinedAt: String(value.joinedAt ?? ''),
    ...(value.hidden === true ? { hidden: true } : {}),
    ...(Array.isArray(value.activeQuestIds) ? { activeQuestIds: ids(value.activeQuestIds) } : {}),
    ...(value.objectives && typeof value.objectives === 'object' ? { objectives: value.objectives as Record<string, SharedObjectiveProgress[]> } : {}),
    ...(typeof value.completedCount === 'number' ? { completedCount: value.completedCount } : {}),
    ...('lastSyncAt' in value ? { lastSyncAt: typeof value.lastSyncAt === 'string' ? value.lastSyncAt : null } : {}),
  }
}

function cleanSquad(raw: unknown): SquadInfo | null {
  const value = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!value || typeof value.id !== 'string' || !SQUAD_ID.test(value.id)) return null
  return {
    id: value.id,
    name: typeof value.name === 'string' ? value.name.slice(0, 32) : '',
    maxMembers: typeof value.maxMembers === 'number' ? value.maxMembers : 5,
    isOwner: value.isOwner === true,
    createdAt: String(value.createdAt ?? ''),
    members: (Array.isArray(value.members) ? value.members : []).map(cleanMember).filter((member): member is SquadMember => member !== null),
  }
}

export async function fetchMySquad(mode: RaidMode): Promise<SquadMine> {
  const answer = await request<Record<string, unknown>>('GET', `/v1/squads/mine/${mode}`)
  const invitations = (Array.isArray(answer.invitations) ? answer.invitations : []).flatMap((raw): SquadInvitation[] => {
    const value = raw as Record<string, unknown>
    if (typeof value?.invitationId !== 'string' || !HEX24.test(value.invitationId)) return []
    return [{ invitationId: value.invitationId, squadName: String(value.squadName ?? '').slice(0, 32), from: typeof value.from === 'string' ? value.from : null, members: Number(value.members) || 0, expiresAt: String(value.expiresAt ?? '') }]
  })
  return { squad: cleanSquad(answer.squad), access: answer.access === true, invitations }
}

export async function fetchSquadOverview(squadId: string, mode: RaidMode): Promise<SquadOverview | null> {
  if (!SQUAD_ID.test(squadId)) return null
  const answer = await request<Record<string, unknown>>('GET', `/v1/squads/${squadId}/overview/${mode}`)
  const squad = cleanSquad(answer.squad)
  if (!squad) return null
  return { ...(answer as unknown as SquadOverview), squad, mode }
}

export const createSquad = (name: string) => request('POST', '/v1/squads', name.trim() ? { name: name.trim() } : {})
export const joinSquad = (code: string) => request('POST', '/v1/squads/join', { code })
export const squadAction = (squadId: string, action: 'leave' | 'disband') => request('POST', `/v1/squads/${squadId}/${action}`)
export const kickMember = (squadId: string, memberId: string) => request('POST', `/v1/squads/${squadId}/kick`, { memberId })
export const inviteFriendToSquad = (squadId: string, friendId: string) => request('POST', `/v1/squads/${squadId}/invite-friend`, { friendId })
export const answerSquadInvitation = (invitationId: string, accept: boolean) => request('POST', `/v1/squads/invitations/${invitationId}/${accept ? 'accept' : 'decline'}`)
export async function createSquadInvite(squadId: string) {
  const answer = await request<{ code?: unknown; expiresAt?: unknown }>('POST', `/v1/squads/${squadId}/invites`)
  if (typeof answer?.code !== 'string' || !/^[0-9A-Z]{5}-[0-9A-Z]{5}$/.test(answer.code)) throw new Error('Сервер вернул неожиданный ответ')
  return { code: answer.code, expiresAt: String(answer.expiresAt ?? '') }
}

export async function fetchFriends(): Promise<FriendsOverview> {
  const answer = await request<FriendsOverview>('GET', '/v1/friends')
  const list = <T,>(value: unknown) => (Array.isArray(value) ? value as T[] : [])
  return {
    code: typeof answer.code === 'string' ? answer.code : '',
    access: answer.access === true,
    friends: list<Friend>(answer.friends).filter((friend) => HEX24.test(String(friend?.friendId))),
    incoming: list<FriendsOverview['incoming'][number]>(answer.incoming).filter((entry) => HEX24.test(String(entry?.requestId))),
    outgoing: list<FriendsOverview['outgoing'][number]>(answer.outgoing).filter((entry) => HEX24.test(String(entry?.requestId))),
    blocked: list<FriendsOverview['blocked'][number]>(answer.blocked).filter((entry) => HEX24.test(String(entry?.friendId))),
  }
}
export const sendFriendRequest = (target: { code: string } | { mode: RaidMode; nickname: string }) => request<{ status?: string }>('POST', '/v1/friends/requests', target)
export const answerFriendRequest = (requestId: string, action: 'accept' | 'decline' | 'cancel') => request('POST', `/v1/friends/requests/${requestId}/${action}`)
export const friendAction = (friendId: string, action: 'remove' | 'block' | 'unblock') => request('POST', `/v1/friends/${friendId}/${action}`)
export const setHideProgress = (friendId: string, hideProgress: boolean) => request('PUT', `/v1/friends/${friendId}/privacy`, { hideProgress })
export const regenerateFriendCode = () => request<{ code: string }>('POST', '/v1/friends/code')

export async function fetchPlannerPeople(mode: RaidMode, friendIds: string[]): Promise<PlannerPerson[]> {
  const answer = await request<{ people?: unknown }>('POST', `/v1/friends/progress/${mode}`, { friendIds: friendIds.filter((id) => HEX24.test(id)).slice(0, 10) })
  return (Array.isArray(answer?.people) ? answer.people : []).flatMap((raw): PlannerPerson[] => {
    const value = raw as Record<string, unknown>
    if (typeof value?.id !== 'string' || !(value.id === 'me' || HEX24.test(value.id))) return []
    return [{ id: value.id, nickname: typeof value.nickname === 'string' ? value.nickname : null, hidden: value.hidden === true, isYou: value.isYou === true, activeQuestIds: ids(value.activeQuestIds), objectives: value.objectives && typeof value.objectives === 'object' ? value.objectives as Record<string, SharedObjectiveProgress[]> : {}, completedCount: Number(value.completedCount) || 0, lastSyncAt: typeof value.lastSyncAt === 'string' ? value.lastSyncAt : null }]
  })
}

/** What the friends need, as bare ids (no names): item ids when the server has a catalog, else their quest ids. */
export async function fetchFriendNeeds(mode: RaidMode) {
  const answer = await request<{ itemIds?: unknown; questIds?: unknown }>('GET', `/v1/friends/needs/${mode}`)
  return { itemIds: Array.isArray(answer?.itemIds) ? ids(answer.itemIds, /^[A-Za-z0-9_-]{1,64}$/) : null, questIds: ids(answer?.questIds) }
}

/** A squad code from what the user typed or pasted: the code itself or a link …/squad/<code>. */
export function extractSquadCode(input: string) {
  const trimmed = input.trim()
  const fromLink = /\/squad\/([0-9A-Za-z-]{10,11})(?:[/?#]|$)/.exec(trimmed)?.[1]
  const raw = (fromLink ?? trimmed).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{10}$/.test(raw) ? `${raw.slice(0, 5)}-${raw.slice(5)}` : null
}

/** A friend code from the code itself or a link …/friend/<code>. */
export function extractFriendCode(input: string) {
  const trimmed = input.trim()
  const fromLink = /\/friend\/([0-9A-Za-z-]{8,9})(?:[/?#]|$)/.exec(trimmed)?.[1]
  const raw = (fromLink ?? trimmed).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1')
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(raw) ? `${raw.slice(0, 4)}-${raw.slice(4)}` : null
}

/** The website address for invite links (/squad/<code>, /friend/<code>). */
export async function siteAddress() {
  const desktop = window.tarkovDesktop?.account?.websiteUrl
  if (desktop) { try { return await desktop() } catch { return '' } }
  try { return new URL(apiBaseUrl()).origin } catch { return '' }
}
