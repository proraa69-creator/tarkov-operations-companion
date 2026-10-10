import { useAppVersion } from '../app/appVersion'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { profileNickname } from '../account/nicknameBinding'
import '../styles/sidebarOperator.css'

type Faction = 'usec' | 'bear' | 'unknown'

/**
 * Small faction mark drawn for this app (not the game's logos): USEC — a pointed shield with two chevrons, BEAR — a
 * round badge with a bear's head, unknown faction — a PMC crosshair. Painted in the theme's colour (currentColor).
 */
export function FactionMark({ faction, size = 22 }: { faction: Faction; size?: number }) {
  if (faction === 'usec') {
    return (
      <svg className="faction-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <path d="M12 1.8 21 4.6v6.2c0 5.4-3.7 9.6-9 11.4-5.3-1.8-9-6-9-11.4V4.6z" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
        <path d="m7.2 10.4 4.8-3.1 4.8 3.1M7.2 14.6l4.8-3.1 4.8 3.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (faction === 'bear') {
    return (
      <svg className="faction-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
        <circle cx="12" cy="12" r="10.3" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="7.9" cy="8.2" r="2.1" fill="currentColor" />
        <circle cx="16.1" cy="8.2" r="2.1" fill="currentColor" />
        <path d="M12 7.6c3.3 0 5.4 2.3 5.4 5 0 2.9-2.4 5-5.4 5s-5.4-2.1-5.4-5c0-2.7 2.1-5 5.4-5z" fill="currentColor" />
        <ellipse cx="12" cy="14.3" rx="1.9" ry="1.3" fill="var(--faction-cut, #000)" opacity=".55" />
      </svg>
    )
  }
  return (
    <svg className="faction-mark" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
      <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 1.5v6M12 16.5v6M1.5 12h6M16.5 12h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
    </svg>
  )
}

/**
 * Foot of the desktop sidebar: the nickname of the selected mode (PvP / PvE / Season) as a patch in the current
 * theme's style (sidebarOperator.css; the «Снаряжение» theme has its own sewn patches, GearPatches) and the app version.
 */
export function SidebarOperator() {
  const { activeProfile, raidMode } = useAppState()
  const { locale } = useLocale()
  const version = useAppVersion()
  const mode = activeProfile.modes[raidMode]
  // One nickname for every mode (owner, 10.10.2026): shown in a mode whose profile is not bound yet, too.
  const linked = profileNickname(activeProfile, raidMode)
  const nick = linked ?? uiText(activeProfile.displayName)
  const faction: Faction = mode.faction === 'usec' || mode.faction === 'bear' ? mode.faction : 'unknown'
  const modeLabel = raidMode === 'pvp' ? 'PvP' : raidMode === 'pve' ? 'PvE' : locale === 'en' ? 'Season' : 'Сезон'
  const title = `${modeLabel} · ${nick}${linked ? '' : ` · ${uiText('Ник не привязан')}`}`
  return (
    // a <footer>, not a <div>: theme CSS picks the sidebar's last .nav-label with :last-of-type
    <footer className="sidebar-operator" data-faction={faction} data-mode={raidMode}>
      <div className={`op-patch${linked ? '' : ' is-unlinked'}`} title={title}>
        <span className="op-patch-mark"><FactionMark faction={faction} /></span>
        <span className="op-patch-text">
          <small>{modeLabel}{faction !== 'unknown' ? ` · ${faction.toUpperCase()}` : ''}</small>
          <strong>{nick}</strong>
        </span>
        <i className="op-patch-led" aria-hidden="true" />
      </div>
      <div className="sidebar-version" title={`Raid OS ${version}`}>v{version}</div>
    </footer>
  )
}
