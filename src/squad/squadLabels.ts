import type { RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import type { Nicknames } from './socialClient'

/** A member's name: the Escape from Tarkov nickname (one for all modes), or «Боец N» while none is bound. */
export function memberLabel(nickname: string | null | undefined, index: number) {
  return nickname || `${uiText('Боец')} ${index + 1}`
}

/**
 * A friend's Escape from Tarkov nickname — one for every mode (owner, 10.10.2026; the server repeats it under each mode).
 * A server from before kept one per mode: this mode's, else the first bound one. Else a neutral label.
 */
export function friendLabel(nicknames: Nicknames, mode: RaidMode) {
  return nicknames[mode] ?? (['pvp', 'pve', 'seasonal'] as const).map((entry) => nicknames[entry]).find((nickname): nickname is string => Boolean(nickname)) ?? uiText('Ник не привязан')
}

export function modeLabel(mode: RaidMode) {
  return mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()
}
