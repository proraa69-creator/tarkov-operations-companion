import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import '../styles/kappaCongrats.css'

const seenKey = (profileId: string, mode: string) => `tarkov-kappa-congrats-v1:${profileId}:${mode}`

function wasShown(key: string) {
  try { return localStorage.getItem(key) === '1' } catch { return false }
}
function markShown(key: string) {
  try { localStorage.setItem(key, '1') } catch { /* storage unavailable: it may show again */ }
}

/**
 * «Поздравляем, Каппа ваша!» — shown once per profile and mode the moment every item for «Коллекционер» is found or
 * marked (Kappa items page). The container is drawn for this app; the sparks are a few CSS particles
 * (none with reduced motion).
 */
export function KappaCongrats({ profileId, mode, complete, total }: { profileId: string; mode: string; complete: boolean; total: number }) {
  const key = seenKey(profileId, mode)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [closedKey, setClosedKey] = useState<string | null>(null)
  // opens once: the first render that sees the list complete remembers the key, storage keeps it for later visits
  if (complete && total > 0 && openKey !== key && closedKey !== key && !wasShown(key)) setOpenKey(key)
  const open = openKey === key && closedKey !== key
  useEffect(() => { if (open) markShown(key) }, [open, key])
  if (!open) return null
  return <KappaCongratsDialog mode={mode} total={total} onClose={() => setClosedKey(key)} />
}

export function KappaCongratsDialog({ mode, total, onClose }: { mode: string; total: number; onClose: () => void }) {
  const { locale } = useLocale()
  const en = locale === 'en'
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    button.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // sparks: fixed pseudo-random spread so every opening looks the same
  const sparks = useMemo(() => Array.from({ length: 26 }, (_, index) => {
    const a = (index * 137.5) % 360, r = 90 + ((index * 53) % 70)
    return { '--dx': `${Math.cos(a * Math.PI / 180) * r}px`, '--dy': `${Math.sin(a * Math.PI / 180) * r * 0.8 - 30}px`, '--delay': `${(index % 7) * 0.09}s`, '--hue': index % 3 } as CSSProperties
  }), [])
  const modeLabel = mode === 'pvp' ? 'PvP' : mode === 'pve' ? 'PvE' : en ? 'Season' : 'Сезон'
  return createPortal(
    <div className="kappa-congrats-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="kappa-congrats" role="dialog" aria-modal="true" aria-labelledby="kappa-congrats-title">
        <button type="button" className="icon-button kappa-congrats-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={15} /></button>
        <div className="kappa-congrats-stage" aria-hidden="true">
          <span className="kappa-congrats-glow" />
          {sparks.map((style, index) => <i key={index} className="kappa-congrats-spark" style={style} />)}
          <KappaContainerArt />
        </div>
        <div className="kappa-congrats-eyebrow">{uiText('Коллекционер')} · {modeLabel}</div>
        <h2 id="kappa-congrats-title">{uiText('Поздравляем, Каппа ваша!')}</h2>
        <p>{en
          ? `All ${total} Collector items are found. Hand them in to Fence and the Kappa container takes its place in your secure slot. Tarkov legends started exactly like this.`
          : `Все ${total} предметов для «Коллекционера» собраны. Осталось сдать их Скупщику — и «Каппа» займёт место в защищённом слоте. Легенды Таркова начинались именно так.`}</p>
        <button ref={button} type="button" className="button primary kappa-congrats-ok" onClick={onClose}>{uiText('Забрать контейнер')}</button>
      </div>
    </div>,
    document.body,
  )
}

/** A rugged secure container with a κ plate — an original drawing, not the game's model. */
function KappaContainerArt() {
  return (
    <svg className="kappa-congrats-case" viewBox="0 0 160 120" width="160" height="120">
      <defs>
        <linearGradient id="kc-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a4f47" /><stop offset=".55" stopColor="#2b2f2a" /><stop offset="1" stopColor="#1a1c19" />
        </linearGradient>
        <linearGradient id="kc-lid" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5b6157" /><stop offset="1" stopColor="#353a33" />
        </linearGradient>
        <linearGradient id="kc-plate" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f1d98f" /><stop offset=".5" stopColor="#c9a24f" /><stop offset="1" stopColor="#8c6a2a" />
        </linearGradient>
      </defs>
      <ellipse cx="80" cy="112" rx="62" ry="6" fill="#000" opacity=".45" />
      <rect x="22" y="36" width="116" height="72" rx="9" fill="url(#kc-body)" stroke="#0d0e0c" strokeWidth="2" />
      <rect x="18" y="26" width="124" height="22" rx="7" fill="url(#kc-lid)" stroke="#0d0e0c" strokeWidth="2" />
      <path d="M58 26v-8a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v8" fill="none" stroke="#1f221e" strokeWidth="6" strokeLinecap="round" />
      <path d="M58 26v-8a4 4 0 0 1 4-4h36a4 4 0 0 1 4 4v8" fill="none" stroke="#5b6157" strokeWidth="2" strokeLinecap="round" />
      {/* ribs and latches */}
      <path d="M30 58h100M30 96h100" stroke="#0f110e" strokeWidth="2" opacity=".6" />
      <rect x="28" y="44" width="14" height="14" rx="2" fill="#6f766a" stroke="#0d0e0c" strokeWidth="1.5" />
      <rect x="118" y="44" width="14" height="14" rx="2" fill="#6f766a" stroke="#0d0e0c" strokeWidth="1.5" />
      {/* κ plate */}
      <rect x="60" y="60" width="40" height="32" rx="4" fill="url(#kc-plate)" stroke="#5a431b" strokeWidth="1.5" />
      <text x="80" y="86" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="28" fontWeight="700" fill="#3a2a0e">κ</text>
      <path d="M26 40h108" stroke="#fff" strokeOpacity=".12" strokeWidth="1.5" />
    </svg>
  )
}
