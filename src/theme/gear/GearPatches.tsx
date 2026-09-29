import { memo } from 'react'
import { createPortal } from 'react-dom'

/**
 * Original embroidered patches stuck on the sidebar's loop field: a name tape, a blood-type tab and a round
 * morale patch (moon over a ridge line). Text follows the interface language.
 */
export const GearPatches = memo(function GearPatches({ locale, callsign }: { locale: 'ru' | 'en'; callsign: string }) {
  const en = locale === 'en'
  const blood = en ? 'O POS' : '0(I) RH+'
  const motto = en ? 'NIGHT SHIFT' : 'НОЧНАЯ СМЕНА'
  const name = callsign.trim().toUpperCase().slice(0, 14) || (en ? 'OPERATOR' : 'ОПЕРАТОР')
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
    document.body,
  )
})
