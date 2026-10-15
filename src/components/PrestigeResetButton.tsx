import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsUp, RotateCcw, X } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { prestigeResetText } from '../state/modeReset'
import '../styles/modeReset.css'

/**
 * «Престиж +» (owner, 15.10.2026: «по этой кнопке просто обнуляется прогресс в выбраном режиме»), next to the level in
 * «Текущий профиль»: after a confirmation, every progress record of the mode the app shows goes
 * (AppState.resetModeProgress, src/state/modeReset.ts). The prestige number is not raised here: the app shows only the one
 * Tarkov.dev reads from the game, and the next real reading gives it.
 */
export function PrestigeResetButton() {
  const { raidMode, resetModeProgress } = useAppState()
  const { locale } = useLocale()
  const [open, setOpen] = useState(false)
  const text = prestigeResetText(raidMode, locale)
  return <>
    <button type="button" className="button small prestige-reset-button" onClick={() => setOpen(true)} aria-haspopup="dialog">
      <ChevronsUp size={14} aria-hidden="true" />{text.button}
    </button>
    {open && <PrestigeResetDialog mode={raidMode} locale={locale} onCancel={() => setOpen(false)} onConfirm={() => { setOpen(false); resetModeProgress(raidMode, new Date().toISOString(), 'prestige') }} />}
  </>
}

/** The app's dialog (the overlay of «Информация о друге» and the QR dialogs): «Сбросить» (danger) or «Отмена». */
export function PrestigeResetDialog({ mode, locale, onCancel, onConfirm }: { mode: RaidMode; locale: AppLocale; onCancel: () => void; onConfirm: () => void }) {
  const text = prestigeResetText(mode, locale)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(<div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className="panel registration-dialog prestige-reset-dialog" role="alertdialog" aria-modal="true" aria-labelledby="prestige-reset-title" aria-describedby="prestige-reset-text" onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="registration-close" onClick={onCancel} aria-label={text.close}><X size={18} /></button>
      <span className="prestige-reset-icon" aria-hidden="true"><RotateCcw size={22} /></span>
      <h2 id="prestige-reset-title">{text.title}</h2>
      <p id="prestige-reset-text" className="prestige-reset-question">{text.question}</p>
      <div className="prestige-reset-actions">
        <button type="button" className="button danger" onClick={onConfirm}>{text.confirm}</button>
        <button type="button" className="button ghost" onClick={onCancel} autoFocus>{text.cancel}</button>
      </div>
    </section>
  </div>, document.body)
}
