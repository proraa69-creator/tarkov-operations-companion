/**
 * The owner's announcements and surveys for this account (server/src/routes/notices.ts, src/shared/notices.ts): asked
 * when the app starts or the account signs in, once a minute while the app is open, at once when the server says
 * something changed for the account (GET /v1/me/social-events → SOCIAL_UPDATE_EVENT: a new notice targets it, or it was
 * closed on another device) and when the window gets the focus back. The popup (src/notices/AccountNotices.tsx) shows
 * them one at a time; nothing here throws into the UI.
 */
import { useEffect, useSyncExternalStore } from 'react'
import type { PlayerNotice, PlayerSurvey, SurveyAnswers } from '../shared/notices'
import { serviceClient } from '../account/nicknameBinding'
import { SOCIAL_UPDATE_EVENT } from '../squad/useSocialEvents'

export interface NoticeInbox { notices: PlayerNotice[]; surveys: PlayerSurvey[] }

export const INBOX_POLL_MS = 60_000
/** The focus asks again at most this often. */
const FOCUS_GAP_MS = 20_000
const EMPTY: NoticeInbox = { notices: [], surveys: [] }

let inbox: NoticeInbox = EMPTY
let owner = ''
/** Closed or put off in this run of the app: hidden at once, whatever an answer in flight still says. */
const dismissed = new Set<number>()
/** Shown in this run (the server is told once). */
const reported = new Set<number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const publish = (next: NoticeInbox) => { inbox = next; for (const listener of listeners) listener() }

const visible = (value: NoticeInbox): NoticeInbox => ({
  notices: value.notices.filter((notice) => !dismissed.has(notice.id)),
  surveys: value.surveys.filter((survey) => !dismissed.has(survey.id)),
})

/** The answer, shape-checked (the server is trusted, the network is not). */
export function parseInbox(value: unknown): NoticeInbox | null {
  if (!value || typeof value !== 'object') return null
  const answer = value as { notices?: unknown; surveys?: unknown }
  if (!Array.isArray(answer.notices) || !Array.isArray(answer.surveys)) return null
  const notices = answer.notices.filter((item): item is PlayerNotice => Boolean(item && typeof item === 'object' && typeof (item as PlayerNotice).id === 'number' && typeof (item as PlayerNotice).title === 'string' && typeof (item as PlayerNotice).text === 'string'))
  const surveys = answer.surveys.filter((item): item is PlayerSurvey => Boolean(item && typeof item === 'object' && typeof (item as PlayerSurvey).id === 'number' && typeof (item as PlayerSurvey).title === 'string' && Array.isArray((item as PlayerSurvey).questions)))
  return { notices, surveys }
}

let loading: Promise<void> | null = null
let lastLoadAt = 0

/** Asks the server now (one request at a time). */
export function loadInbox() {
  const request = serviceClient()
  if (!request || !owner) return Promise.resolve()
  if (loading) return loading
  const account = owner
  lastLoadAt = Date.now()
  loading = request('GET', '/v1/me/notices').then((raw) => {
    const parsed = parseInbox(raw)
    if (parsed && account === owner) publish(visible(parsed))
  }).catch(() => { /* offline or an older server: what is shown stays */ }).finally(() => { loading = null })
  return loading
}

const post = (path: string, body?: unknown) => {
  const request = serviceClient()
  return request ? request('POST', path, body ?? {}) : Promise.resolve(null)
}

/** The popup is on screen: the owner's «просмотрели» counts it (once per run). */
export function reportSeen(id: number) {
  if (reported.has(id)) return
  reported.add(id)
  void post(`/v1/me/notices/${id}/seen`).catch(() => {})
}

/** «Понятно»: gone at once here, and on the other devices of the account through the server. */
export function closeNotice(id: number) {
  dismissed.add(id)
  publish(visible(inbox))
  void post(`/v1/me/notices/${id}/close`).catch(() => {})
}

/** «Позже»: gone until the next start of the app (the server counts it, SURVEY_LATER_MAX times at most). */
export function putOffSurvey(id: number) {
  dismissed.add(id)
  publish(visible(inbox))
  void post(`/v1/me/surveys/${id}/later`).catch(() => {})
}

/** «Отправить»: the answers; the server's refusal (what is wrong) is thrown for the form to show. */
export async function answerSurvey(id: number, answers: SurveyAnswers) {
  const request = serviceClient()
  if (!request) throw new Error('Сервер недоступен')
  const result = await request('POST', `/v1/me/surveys/${id}/responses`, { answers })
  if (!result) throw new Error('Сервер недоступен')
  dismissed.add(id)
  publish(visible(inbox))
}

/** One photo of an announcement as a data: URL (the app's gateway forwards JSON only). */
export async function noticeImage(id: number, idx: number) {
  const request = serviceClient()
  const answer = request ? await request('GET', `/v1/me/notices/${id}/images/${idx}`) as { mime?: unknown; data?: unknown } | null : null
  if (!answer || typeof answer.data !== 'string' || !/^image\/(?:png|jpeg|webp)$/.test(String(answer.mime))) throw new Error('Фото недоступно')
  return `data:${String(answer.mime)};base64,${answer.data}`
}

/**
 * The inbox of the signed-in account `account` ('' while nobody is signed in or the server is not reachable): asked at
 * once, then once a minute, on every social event and on the focus.
 */
export function useNoticeInbox(account: string) {
  useEffect(() => {
    if (owner !== account) {
      owner = account
      dismissed.clear()
      reported.clear()
      publish(EMPTY)
    }
    if (!account) return
    void loadInbox()
    const timer = window.setInterval(() => { void loadInbox() }, INBOX_POLL_MS)
    const onSocial = () => { void loadInbox() }
    const onFocus = () => { if (Date.now() - lastLoadAt >= FOCUS_GAP_MS) void loadInbox() }
    window.addEventListener(SOCIAL_UPDATE_EVENT, onSocial)
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener(SOCIAL_UPDATE_EVENT, onSocial)
      window.removeEventListener('focus', onFocus)
    }
  }, [account])
  return useSyncExternalStore(subscribe, () => inbox, () => inbox)
}

/** Tests: forget everything between cases. */
export function resetNoticeInbox() {
  owner = ''
  dismissed.clear()
  reported.clear()
  loading = null
  lastLoadAt = 0
  publish(EMPTY)
}
