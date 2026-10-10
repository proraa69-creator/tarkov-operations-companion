import { useAppState } from '../../state/AppState'
import { profileNickname } from '../../account/nicknameBinding'
import { useLocale } from '../../i18n/LocaleProvider'
import { GearHangers } from './GearHangers'
import { GearPatches } from './GearPatches'
import { useGearActive, useReducedMotion } from './useGearActive'

/**
 * Decorations of the «Снаряжение» / "Gear" theme: swinging kit and the sidebar patches (the 3D mask by
 * «Обзор» is in every theme, see HelmetBadge). Mounted only while `<html data-theme="gear">` is set; everything unmounts (and the WebGL context
 * is released) when another theme is picked.
 */
export function GearDecor() {
  const active = useGearActive()
  if (!active) return null
  return <GearDecorActive />
}

function GearDecorActive() {
  const reduced = useReducedMotion()
  const { locale } = useLocale()
  const { activeProfile, raidMode } = useAppState()
  const callsign = profileNickname(activeProfile, raidMode) ?? activeProfile.displayName
  const en = locale === 'en'
  const tagLines: [string[], string[]] = [
    [callsign.toUpperCase().slice(0, 10), en ? 'O POS' : '0(I) RH+', en ? 'NO PREF' : 'Б/Р', '7734-19'],
    [callsign.toUpperCase().slice(0, 10), '7734-19', en ? 'NKA' : 'АЛЛ: НЕТ', en ? 'O POS' : '0(I) RH+'],
  ]
  return (
    <>
      <GearHangers reduced={reduced} tagLines={tagLines} />
      <GearPatches locale={locale} callsign={callsign} faction={activeProfile.modes[raidMode].faction} />
    </>
  )
}
