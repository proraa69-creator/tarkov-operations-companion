import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsUp, Eraser, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { pendingMarkerText, prestigeResetText, rebuildResetText, wipeResetText } from '../state/modeReset'
import { PrestigeIcon } from './PrestigeIcon'
import { PRESTIGE_CHOICES, PRESTIGE_MODES, prestigeLabel } from '../profile/prestige'
import '../styles/modeReset.css'

/**
 * «Престиж +», «Вайп» right below it and «Сброс» (owner, 15.10.2026), next to the level in «Текущий профиль», PC and
 * phone. Each wipes the mode the app shows after a confirmation — its records in the app and on the server — and finds
 * it again from every game log at once (AppState.resetModeProgress, src/state/modeReset.ts): no press hides a quest
 * that is still current in the game. «Престиж +» asks which prestige the player now has and, like «Вайп», leaves a
 * pending marker: the game's own reset in the logs after it becomes the floor, and the older quests drop out then.
 * «Сброс» only rebuilds. «Вайп» and «Сброс» keep the prestige (a game wipe does not reset it).
 */
export function ModeResetButtons() {
  const { raidMode, resetModeProgress, activeProfile } = useAppState()
  const { locale } = useLocale()
  const [open, setOpen] = useState<'prestige' | 'wipe' | 'rebuild' | null>(null)
  const prestige = prestigeResetText(raidMode, locale)
  const wipe = wipeResetText(raidMode, locale)
  const rebuild = rebuildResetText(raidMode, locale)
  const marker = activeProfile.modes[raidMode].resetMarker
  return <div className="mode-reset-buttons">
    <button type="button" className="button small prestige-reset-button" onClick={() => setOpen('prestige')} aria-haspopup="dialog">
      <ChevronsUp size={14} aria-hidden="true" />{prestige.button}
    </button>
    <button type="button" className="button small wipe-reset-button" onClick={() => setOpen('wipe')} aria-haspopup="dialog">
      <Eraser size={14} aria-hidden="true" />{wipe.button}
    </button>
    <button type="button" className="button small rebuild-reset-button" onClick={() => setOpen('rebuild')} aria-haspopup="dialog">
      <RefreshCw size={14} aria-hidden="true" />{rebuild.button}
    </button>
    {marker && !marker.resolvedAt && <small className="mode-reset-pending" data-testid="reset-pending">{pendingMarkerText(marker.kind, locale)}</small>}
    {open === 'prestige' && <PrestigeResetDialog locale={locale} onCancel={() => setOpen(null)} onConfirm={(level, mode) => { setOpen(null); resetModeProgress(mode, new Date().toISOString(), 'prestige', { prestige: level }) }} />}
    {open === 'wipe' && <WipeResetDialog mode={raidMode} locale={locale} onCancel={() => setOpen(null)} onConfirm={() => { setOpen(null); resetModeProgress(raidMode, new Date().toISOString(), 'wipe') }} />}
    {open === 'rebuild' && <RebuildResetDialog mode={raidMode} locale={locale} onCancel={() => setOpen(null)} onConfirm={() => { setOpen(null); resetModeProgress(raidMode, new Date().toISOString(), 'rebuild') }} />}
  </div>
}

/** The app's dialog frame (the overlay of «Информация о друге» and the QR dialogs); Escape and the backdrop cancel. */
function ResetDialog({ id, title, question, close, onCancel, children }: { id: string; title: string; question: string; close: string; onCancel: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])
  return createPortal(<div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel() }}>
    <section className={`panel registration-dialog prestige-reset-dialog ${id}-dialog`} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-text`} onMouseDown={(event) => event.stopPropagation()}>
      <button type="button" className="registration-close" onClick={onCancel} aria-label={close}><X size={18} /></button>
      <span className="prestige-reset-icon" aria-hidden="true"><RotateCcw size={22} /></span>
      <h2 id={`${id}-title`}>{title}</h2>
      <p id={`${id}-text`} className="prestige-reset-question">{question}</p>
      {children}
    </section>
  </div>, document.body)
}

/**
 * «Престиж +» in two steps (owner, 16.10.2026: «при нажатии кнопки престиж появляется PVP или PVE и после выбора появляется
 * выбор уровня престижа»): first PvP or PvE, then the text for that mode and a required choice of the prestige — the
 * mode's badges, nothing chosen at first — and «Сбросить», disabled until a badge is chosen.
 */
export function PrestigeResetDialog({ locale, onCancel, onConfirm }: { locale: AppLocale; onCancel: () => void; onConfirm: (level: number, mode: RaidMode) => void }) {
  const [mode, setMode] = useState<RaidMode | null>(null)
  const [chosen, setChosen] = useState<number | null>(null)
  const start = prestigeResetText(mode ?? 'pvp', locale)
  if (!mode) {
    return <ResetDialog id="prestige-reset" title={start.title} question={start.chooseMode} close={start.close} onCancel={onCancel}>
      <div className="prestige-mode-choice" role="group" aria-label={start.chooseMode}>
        {PRESTIGE_MODES.map((entry) => <button key={entry} type="button" className="button prestige-mode-button" data-mode={entry} onClick={() => { setMode(entry); setChosen(null) }}>
          <PrestigeIcon level={1} size={72} mode={entry} />
          <span>{entry === 'pve' ? 'PvE' : 'PvP'}</span>
        </button>)}
      </div>
      <div className="prestige-reset-actions">
        <button type="button" className="button ghost" onClick={onCancel} autoFocus>{start.cancel}</button>
      </div>
    </ResetDialog>
  }
  const text = prestigeResetText(mode, locale)
  return <ResetDialog id="prestige-reset" title={text.title} question={text.question} close={text.close} onCancel={onCancel}>
    <div className="prestige-picker-label" id="prestige-picker-label">{text.choose}</div>
    <ul className="prestige-picker" role="listbox" aria-labelledby="prestige-picker-label" data-mode={mode}>
      {PRESTIGE_CHOICES.map((level) => <li key={level} role="option" aria-selected={chosen === level} aria-label={prestigeLabel(level, locale)} tabIndex={0}
        className={chosen === level ? 'is-chosen' : undefined} onClick={() => setChosen(level)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosen(level) } }}>
        <PrestigeIcon level={level} size={64} mode={mode} />
      </li>)}
    </ul>
    <div className="prestige-reset-actions">
      <button type="button" className="button danger" disabled={chosen === null} onClick={() => { if (chosen !== null) onConfirm(chosen, mode) }}>{text.confirm}</button>
      <button type="button" className="button ghost" onClick={() => setMode(null)}>{text.back}</button>
      <button type="button" className="button ghost" onClick={onCancel} autoFocus>{text.cancel}</button>
    </div>
  </ResetDialog>
}

/** «Вайп»: the text and «Сделать вайп» / «Отмена». */
export function WipeResetDialog({ mode, locale, onCancel, onConfirm }: { mode: RaidMode; locale: AppLocale; onCancel: () => void; onConfirm: () => void }) {
  const text = wipeResetText(mode, locale)
  return <ResetDialog id="wipe-reset" title={text.title} question={text.question} close={text.close} onCancel={onCancel}>
    <div className="prestige-reset-actions">
      <button type="button" className="button danger" onClick={onConfirm}>{text.confirm}</button>
      <button type="button" className="button ghost" onClick={onCancel} autoFocus>{text.cancel}</button>
    </div>
  </ResetDialog>
}

/** «Сброс»: the text and «Сбросить и найти заново» / «Отмена». */
export function RebuildResetDialog({ mode, locale, onCancel, onConfirm }: { mode: RaidMode; locale: AppLocale; onCancel: () => void; onConfirm: () => void }) {
  const text = rebuildResetText(mode, locale)
  return <ResetDialog id="rebuild-reset" title={text.title} question={text.question} close={text.close} onCancel={onCancel}>
    <div className="prestige-reset-actions">
      <button type="button" className="button danger" onClick={onConfirm}>{text.confirm}</button>
      <button type="button" className="button ghost" onClick={onCancel} autoFocus>{text.cancel}</button>
    </div>
  </ResetDialog>
}

/** «Престиж N» with its icon in «Текущий профиль»; «Без престижа» at 0. */
export function PrestigeLine({ level, locale, mode }: { level: number; locale: AppLocale; mode?: RaidMode }) {
  if (!level) return <span className="profile-prestige is-none">{locale === 'en' ? 'No prestige' : 'Без престижа'}</span>
  return <span className="profile-prestige" data-testid="profile-prestige"><PrestigeIcon level={level} size={28} mode={mode} />{prestigeLabel(level, locale)}</span>
}
