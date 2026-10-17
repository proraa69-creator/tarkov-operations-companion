/**
 * «Вторжение Scourge» (owner, 16.10.2026): the in-game event of the Arena champion Scourge in the Lab. The game runs it
 * until 20 October 2026, 08:00 BST (07:00 UTC); after that the app hides everything about it by itself — the Overview
 * button, the startup video and its popups, Scourge on the Lab's raid card. The boss stays in «Боссы».
 */
export const SCOURGE_EVENT_END = Date.UTC(2026, 9, 20, 7, 0, 0)

export function scourgeEventActive(now: number = Date.now()): boolean {
  return now < SCOURGE_EVENT_END
}

/**
 * The event video (the owner's clip «Champion_s3_Laba»), served by the website so the app does not carry 20 MB for a
 * four-day event; the desktop app allows media from raidos.app (src/app/contentSecurityPolicy.ts).
 */
export const SCOURGE_EVENT_VIDEO = 'https://raidos.app/media/scourge-invasion.mp4'

/** The boss key in the boss lists (src/data/bossFigures.ts, bossInfo.ts, bossLoadout.ts). */
export const SCOURGE_BOSS_KEY = 'scourge'

/** Watched on this device: the startup intro (ScourgeEventIntro.tsx) never comes back; the Overview button still opens it. */
export const SCOURGE_INTRO_KEY = 'raidos-scourge-event-v1'
/** The Overview button asks for the intro with this window event. */
export const SCOURGE_OPEN_EVENT = 'raidos:scourge-event-open'

export const openScourgeEvent = () => window.dispatchEvent(new Event(SCOURGE_OPEN_EVENT))
