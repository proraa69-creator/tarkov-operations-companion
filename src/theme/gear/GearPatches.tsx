import { memo, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Original embroidered patches stuck on the sidebar's loop field: a name tape with the selected mode's nickname and a
 * blood-type tab. Text follows the interface language.
 * They sit in the sidebar's foot (SidebarOperator) under the last menu items, so new menu items push them down (and the
 * menu scrolls) instead of hiding behind them; without the foot they fall back to a fixed corner of the window.
 */
// No faction patch and no round morale patch (owner, 10.11.2026, crossed out on a screenshot); `faction` is kept for the callers.
export const GearPatches = memo(function GearPatches({ locale, callsign }: { locale: 'ru' | 'en'; callsign: string; faction?: 'usec' | 'bear' | 'unknown' }) {
  const en = locale === 'en'
  const blood = en ? 'O POS' : '0(I) RH+'
  const name = callsign.trim().toUpperCase().slice(0, 14) || (en ? 'OPERATOR' : 'ОПЕРАТОР')
  const host = useSidebarFoot()
  return createPortal(
    <div className="gear-patches" aria-hidden="true">
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
