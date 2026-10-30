import { useEffect } from 'react'
import { screenLiveRequest, useServerStatus } from '../sync/serverSync'
import type { ScreenTuningApi, ScreenTuningView } from './screenApi'
import { screenApi } from './screenApi'
import type { ScreenProfile } from './screenCurve'

/**
 * «Пресеты экрана» from the phone (owner, 31.10.2026: «при настройке на телефоне, в режиме онлайн моментально меняются
 * настройки пресетов на пк. и можно выбирать пресеты с телефона… включать и выключать их»). Through the server's
 * relay (server/src/routes/live.ts, services/screenRelay.ts), nothing stored:
 *
 * - the PC app publishes what «Настройка экрана» has — the presets, the chosen one, on / off, a raid now — whenever it
 *   changes and at least once a minute (so the phone knows the PC is there);
 * - it waits for the phone's commands and applies each at once through the same calls as its own page (choose, on /
 *   off, a tuned preset saved), then publishes again.
 */
export interface RemoteScreenState {
  presets: ScreenProfile[]
  activeId: string
  enabled: boolean
  /** The chosen preset is on the screen now (switched on and in a raid). */
  on: boolean
  inRaid: boolean
  /** The PC can change the monitors' gamma (Windows). */
  available: boolean
}

export type ScreenCommand =
  | { type: 'select'; activeId: string }
  | { type: 'enabled'; enabled: boolean }
  | { type: 'save'; preset: ScreenProfile }

/** The PC heard from in this time is «на связи» (it publishes at least every HEARTBEAT_MS). */
export const PC_ONLINE_MS = 90_000
const HEARTBEAT_MS = 60_000
const CHECK_MS = 3_000
const RETRY_MS = 5_000

/** Only the fields the server takes (server/src/routes/live.ts screenPresetSchema). */
export function remotePreset(profile: ScreenProfile): ScreenProfile {
  const { id, name, builtIn, edited, note, gamma, shadows, highlights, contrast, brightness, temperature, tint, curve, channels, vibrance, haze, cast, zones } = profile
  return {
    id, name, gamma, shadows, highlights, contrast, brightness, temperature, tint, curve,
    ...(builtIn ? { builtIn } : {}), ...(edited ? { edited } : {}), ...(note ? { note } : {}),
    ...(channels ? { channels } : {}), ...(vibrance === undefined ? {} : { vibrance }), ...(haze ? { haze } : {}),
    ...(cast ? { cast } : {}), ...(zones ? { zones } : {}),
  }
}

export function remoteState(view: ScreenTuningView): RemoteScreenState {
  return {
    presets: view.presets.slice(0, 140).map(remotePreset),
    activeId: view.settings.activeId,
    enabled: view.settings.enabled,
    on: view.status.on,
    inRaid: view.status.inRaid,
    available: view.status.available,
  }
}

/** One command of the phone, applied on the PC as its own page would. */
export async function applyScreenCommand(api: ScreenTuningApi, command: ScreenCommand) {
  if (command.type === 'select') return api.update({ activeId: command.activeId })
  if (command.type === 'enabled') return api.update({ enabled: command.enabled })
  return api.savePreset(command.preset)
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** The PC app: publishes its presets and applies the phone's commands while signed in. Renders nothing. */
export function ScreenRemoteRunner() {
  const status = useServerStatus()
  const ready = status?.signedIn === true && status.online === true
  useEffect(() => {
    const api = screenApi()
    if (!api || !ready) return
    let active = true
    let sent = ''
    let sentAt = 0
    const publish = async (force = false) => {
      const state = remoteState(await api.state())
      const json = JSON.stringify(state)
      if (!force && json === sent && Date.now() - sentAt < HEARTBEAT_MS) return
      if (await screenLiveRequest('PUT', '/v1/live/screen/state', state) !== null) { sent = json; sentAt = Date.now() }
    }
    const timer = window.setInterval(() => { void publish().catch(() => {}) }, CHECK_MS)
    void publish(true).catch(() => {})
    void (async () => {
      let since: number | undefined
      while (active) {
        const answer = await screenLiveRequest<{ last?: unknown; commands?: unknown }>('GET', `/v1/live/screen/pc${since === undefined ? '' : `?since=${since}`}`).catch(() => null)
        if (!active) break
        const last = Number(answer?.last)
        if (!answer || !Number.isSafeInteger(last) || !Array.isArray(answer.commands)) { await sleep(RETRY_MS); continue }
        // The server started over (its numbers are lower now): wait from its number.
        since = since !== undefined && last < since ? undefined : last
        for (const command of answer.commands as ScreenCommand[]) {
          try { await applyScreenCommand(api, command) } catch { /* a preset the PC refused: the phone sees the PC's state */ }
        }
        if (answer.commands.length) await publish(true).catch(() => {})
      }
    })()
    return () => {
      active = false
      window.clearInterval(timer)
    }
  }, [ready])
  return null
}
