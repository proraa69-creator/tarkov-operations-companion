import type { RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import type { Nicknames } from './socialClient'

/** A member's name: the nickname of this mode, or «Боец N» when that mode has no nickname bound. */
export function memberLabel(nickname: string | null | undefined, index: number) {
  return nickname || `${uiText('Боец')} ${index + 1}`
}

/** A friend's nickname for this mode, else any bound nickname with its mode, else a neutral label. */
export function friendLabel(nicknames: Nicknames, mode: RaidMode) {
  if (nicknames[mode]) return nicknames[mode]!
  const other = (['pvp', 'pve', 'seasonal'] as const).find((entry) => nicknames[entry])
  return other ? `${nicknames[other]} (${other === 'seasonal' ? uiText('Сезон') : other.toUpperCase()})` : uiText('Ник не привязан')
}

export function modeLabel(mode: RaidMode) {
  return mode === 'seasonal' ? uiText('Сезон') : mode.toUpperCase()
}
