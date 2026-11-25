/**
 * Raid OS's own content and the account's synced data behind the same access check as the game data (owner, 25.11.2026:
 * a client with its subscription check cut out must not get it for free). The server guards these paths with
 * `requireDataAccess` (server/src/routes/data.ts: session → access → active device of this session); the apps send them
 * with the session and the device id (electron/serviceGateway.ts, src/sync/webAccount.ts).
 *
 * What stays open on purpose: the account itself, sign-in, payments, «Нужна подписка», support, notices and surveys,
 * «Пригласи друга», the social events wait (`/v1/me/social-events`: friends, support answers, notices), the functions on
 * for the account (`/v1/me/features`), the website cabinet's counts (`/v1/me/summary`), the map-updates signal (a version
 * number only) and the map files (`/v1/map-tiles`: tarkov.dev's public maps, drawn by <img> without a session).
 *
 * The path without the query (the server tests `req.path`; the apps cut it off before testing).
 */
export const PAID_CONTENT_PATH = /^\/v1\/(?:quest-points|quest-texts|quest-requirements|map-bosses|event-quests|owner-builds|builds|me\/(?:quest-point-photos|progress|story|deferred-quests|collector|hideout|items|quest-mirror|position|settings|levels|objectives|state|game-mode))(?:\/|$)/

export function isPaidContentPath(path: string) {
  return PAID_CONTENT_PATH.test(path.split('?')[0] ?? '')
}
