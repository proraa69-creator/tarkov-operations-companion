import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Original embroidered patches stuck on the sidebar's loop field: a faction patch (USEC / BEAR from the selected mode's
 * profile, drawn for this app — not the game's logos; «PMC» while the faction is unknown), a name tape with the
 * selected mode's nickname, a blood-type tab and a round morale patch (moon over a ridge line). Text follows the
 * interface language.
 * They sit in the sidebar's foot (SidebarOperator) under the last menu items, so new menu items push them down (and the
 * menu scrolls) instead of hiding behind them; without the foot they fall back to a fixed corner of the window.
 */
export const GearPatches = memo(function GearPatches({ locale, callsign, faction = 'unknown' }: { locale: 'ru' | 'en'; callsign: string; faction?: 'usec' | 'bear' | 'unknown' }) {
  const en = locale === 'en'
  const blood = en ? 'O POS' : '0(I) RH+'
  const motto = en ? 'NIGHT SHIFT' : 'НОЧНАЯ СМЕНА'
  const name = callsign.trim().toUpperCase().slice(0, 14) || (en ? 'OPERATOR' : 'ОПЕРАТОР')
  const host = useSidebarFoot()
  return createPortal(
    <div className="gear-patches" aria-hidden="true">
      <FactionPatch faction={faction} />
      <svg className="gear-patch gear-patch-name" viewBox="0 0 150 30" width="150" height="30">
        <defs>
          <pattern id="gp-twill" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
            <rect width="3" height="3" fill="#353a2b" />
            <rect width="1.2" height="3" fill="#2c3124" />
          </pattern>
          <linearGradient id="gp-lift" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity=".16" />
            <stop offset=".5" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity=".3" />
          </linearGradient>
          <pattern id="gp-thread" width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(-20)">
            <rect width="1.4" height="1.4" fill="#d9c79c" />
            <rect width="1.4" height=".45" fill="#b8a377" />
          </pattern>
        </defs>
        <rect x="1" y="1" width="148" height="28" rx="2.5" fill="url(#gp-twill)" />
        <rect x="1" y="1" width="148" height="28" rx="2.5" fill="url(#gp-lift)" />
        <rect x="2.6" y="2.6" width="144.8" height="24.8" rx="1.5" fill="none" stroke="#1b1e15" strokeWidth="2.6" strokeDasharray=".9 .6" />
        <rect x="2.6" y="2.6" width="144.8" height="24.8" rx="1.5" fill="none" stroke="#56593f" strokeWidth="1" strokeDasharray=".7 .8" />
        <text x="75" y="20.6" textAnchor="middle" className="gear-patch-text" fontSize="14" letterSpacing="2.2" fill="url(#gp-thread)">{name}</text>
      </svg>
      <div className="gear-patch-row">
        <svg className="gear-patch gear-patch-blood" viewBox="0 0 84 30" width="84" height="30">
          <rect x="1" y="1" width="82" height="28" rx="3" fill="#23261c" />
          <rect x="1" y="1" width="82" height="28" rx="3" fill="url(#gp-lift)" />
          <path d="M16 6.5c3.6 4.6 5.6 7.8 5.6 10.5a5.6 5.6 0 0 1-11.2 0c0-2.7 2-5.9 5.6-10.5z" fill="#8f2f25" />
          <path d="M13.6 14.6c-.7 1-.9 2-.7 3" stroke="#e5a08c" strokeWidth="1.1" strokeLinecap="round" fill="none" opacity=".75" />
          <text x="52" y="19.6" textAnchor="middle" className="gear-patch-text" fontSize={en ? 13 : 11.5} letterSpacing="1" fill="url(#gp-thread)">{blood}</text>
          <rect x="2.5" y="2.5" width="79" height="25" rx="2" fill="none" stroke="#14160f" strokeWidth="2.4" strokeDasharray=".9 .6" />
          <rect x="2.5" y="2.5" width="79" height="25" rx="2" fill="none" stroke="#55583f" strokeWidth=".9" strokeDasharray=".7 .8" />
        </svg>
        <svg className="gear-patch gear-patch-moon" viewBox="0 0 56 56" width="56" height="56">
          <defs>
            <path id="gp-arc" d="M9 28a19 19 0 0 1 38 0" />
            <radialGradient id="gp-sky" cx=".35" cy=".3" r=".8">
              <stop offset="0" stopColor="#3b4152" />
              <stop offset="1" stopColor="#1d2029" />
            </radialGradient>
          </defs>
          <circle cx="28" cy="28" r="27" fill="#16181a" />
          <circle cx="28" cy="28" r="24.5" fill="url(#gp-sky)" />
          <circle cx="33" cy="25.5" r="6.3" fill="#e7dcb8" />
          <circle cx="35.6" cy="23.6" r="5.4" fill="url(#gp-sky)" />
          <path d="M5 40l8-7 5 4 8-10 7 7 5-4 13 10v2c-4 6-11 10-19 10S9 48 5 42z" fill="#58603f" />
          <path d="M13 33l5 4 8-10 7 7" stroke="#8e9763" strokeWidth=".9" fill="none" />
          <circle cx="15" cy="17" r=".7" fill="#e7dcb8" /><circle cx="21" cy="11.5" r=".5" fill="#e7dcb8" /><circle cx="42" cy="15" r=".6" fill="#e7dcb8" />
          <text className="gear-patch-text" fontSize={en ? 6.4 : 5.4} letterSpacing=".6" fill="#d9c79c"><textPath href="#gp-arc" startOffset="50%" textAnchor="middle">{motto}</textPath></text>
          <circle cx="28" cy="28" r="26" fill="none" stroke="#0e0f0c" strokeWidth="2.8" strokeDasharray="1 .55" />
          <circle cx="28" cy="28" r="26" fill="none" stroke="#6d6a52" strokeWidth=".9" strokeDasharray=".7 .8" />
          <circle cx="28" cy="28" r="27" fill="url(#gp-lift)" opacity=".7" />
        </svg>
      </div>
    </div>,
    host ?? document.body,
  )
})

/** The sidebar's foot (SidebarOperator), once it is in the page; re-checked while the sidebar re-mounts. */
function useSidebarFoot() {
  const [host, setHost] = useState<Element | null>(() => document.querySelector('.sidebar-operator'))
  useEffect(() => {
    const find = () => setHost((current) => {
      const next = document.querySelector('.sidebar-operator')
      return current && current.isConnected && current === next ? current : next
    })
    find()
    const observer = new MutationObserver(find)
    const sidebar = document.querySelector('.sidebar')
    observer.observe(sidebar ?? document.body, { childList: true, subtree: !sidebar })
    return () => observer.disconnect()
  }, [])
  return host
}

/** Sewn faction patch; uses the twill, lift and thread fills defined by the name tape above it. */
function FactionPatch({ faction }: { faction: 'usec' | 'bear' | 'unknown' }) {
  if (faction === 'bear') {
    return (
      <svg className="gear-patch gear-patch-faction" viewBox="0 0 76 46" width="76" height="46">
        <rect x="1" y="1" width="74" height="44" rx="7" fill="#2b2419" />
        <rect x="1" y="1" width="74" height="44" rx="7" fill="url(#gp-lift)" />
        <circle cx="21" cy="17" r="4.2" fill="#8a6a3f" /><circle cx="37" cy="17" r="4.2" fill="#8a6a3f" />
        <path d="M29 15.5c6.8 0 10.6 4.3 10.6 9.4 0 5.6-4.7 9.6-10.6 9.6s-10.6-4-10.6-9.6c0-5.1 3.8-9.4 10.6-9.4z" fill="#a5814c" />
        <ellipse cx="29" cy="28.5" rx="4.2" ry="3" fill="#d9c79c" />
        <ellipse cx="29" cy="27.2" rx="1.8" ry="1.2" fill="#1b1611" />
        <circle cx="25" cy="23" r="1.1" fill="#1b1611" /><circle cx="33" cy="23" r="1.1" fill="#1b1611" />
        <text x="58" y="27.5" textAnchor="middle" className="gear-patch-text" fontSize="11.5" letterSpacing="1.2" fill="url(#gp-thread)">BEAR</text>
        <rect x="2.6" y="2.6" width="70.8" height="40.8" rx="5.6" fill="none" stroke="#130f0a" strokeWidth="2.4" strokeDasharray=".9 .6" />
        <rect x="2.6" y="2.6" width="70.8" height="40.8" rx="5.6" fill="none" stroke="#6d5a3a" strokeWidth=".9" strokeDasharray=".7 .8" />
      </svg>
    )
  }
  const usec = faction === 'usec'
  return (
    <svg className="gear-patch gear-patch-faction" viewBox="0 0 48 56" width="48" height="56">
      <path d="M24 1.5 46 7v15.5C46 37 37 48.5 24 54.5 11 48.5 2 37 2 22.5V7z" fill="url(#gp-twill)" />
      <path d="M24 1.5 46 7v15.5C46 37 37 48.5 24 54.5 11 48.5 2 37 2 22.5V7z" fill="url(#gp-lift)" />
      <text x="24" y="19" textAnchor="middle" className="gear-patch-text" fontSize={usec ? 10.5 : 11} letterSpacing="1" fill="url(#gp-thread)">{usec ? 'USEC' : 'PMC'}</text>
      {usec
        ? <path d="m13.5 30 10.5-6.5L34.5 30M13.5 38.5 24 32l10.5 6.5" fill="none" stroke="#d9c79c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        : <g fill="none" stroke="#d9c79c" strokeWidth="2" strokeLinecap="round"><circle cx="24" cy="33" r="6.5" /><path d="M24 23.5v4M24 38.5v4M14.5 33h4M29.5 33h4" /></g>}
      <path d="M24 3.4 44.2 8.5v14C44.2 36 35.8 46.8 24 52.4 12.2 46.8 3.8 36 3.8 22.5v-14z" fill="none" stroke="#1b1e15" strokeWidth="2.4" strokeDasharray=".9 .6" />
      <path d="M24 3.4 44.2 8.5v14C44.2 36 35.8 46.8 24 52.4 12.2 46.8 3.8 36 3.8 22.5v-14z" fill="none" stroke="#56593f" strokeWidth=".9" strokeDasharray=".7 .8" />
    </svg>
  )
}
