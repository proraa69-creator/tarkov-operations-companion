import { useAppState } from '../../state/AppState'
import { useLocale } from '../../i18n/LocaleProvider'
import { GearHangers } from './GearHangers'
import { GearPatches } from './GearPatches'
import { HelmetBadge } from './HelmetBadge'
import { useGearActive, useReducedMotion } from './useGearActive'

/**
 * Decorations of the «Снаряжение» / "Gear" theme: swinging kit, the 3D helmet by «Обзор» and the sidebar
 * patches. Mounted only while `<html data-theme="gear">` is set; everything unmounts (and the WebGL context
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
  const callsign = activeProfile.modes[raidMode].registration.nickname ?? activeProfile.displayName
  const en = locale === 'en'
  const tagLines: [string[], string[]] = [
    [callsign.toUpperCase().slice(0, 10), en ? 'O POS' : '0(I) RH+', en ? 'NO PREF' : 'Б/Р', '7734-19'],
    [callsign.toUpperCase().slice(0, 10), '7734-19', en ? 'NKA' : 'АЛЛ: НЕТ', en ? 'O POS' : '0(I) RH+'],
  ]
  return (
    <>
      <GearHangers reduced={reduced} tagLines={tagLines} />
      <HelmetBadge reduced={reduced} />
      <GearPatches locale={locale} callsign={callsign} />
    </>
  )
}
