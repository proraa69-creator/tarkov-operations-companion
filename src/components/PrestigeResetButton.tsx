import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronsUp, Eraser, RefreshCw, RotateCcw, X } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { modeResetName, rebuildResetText, wipePrestigeText } from '../state/modeReset'
import { PrestigeIcon } from './PrestigeIcon'
import { PRESTIGE_CHOICES, PRESTIGE_MODES, prestigeLabel } from '../profile/prestige'
import '../styles/modeReset.css'

/**
 * «Вайп / Престиж» (one button, owner 04.11.2026: «просто через дробь») and «Сброс» (owner, 15.10.2026), next to the level
 * in «Текущий профиль», PC and phone. Each wipes a mode after a confirmation — its records in the app and on the server
 * (AppState.resetModeProgress, src/state/modeReset.ts). «Вайп / Престиж»: the player starts over, the old logs no longer
 * count; the window asks the mode and which of the two it was. «Сброс» finds the quests of the logs again, also what a
 * press by mistake hid. A wipe and «Сброс» keep the prestige (a game wipe does not reset it).
 */
export function ModeResetButtons() {
  const { raidMode, resetModeProgress } = useAppState()
  const { locale } = useLocale()
  const [open, setOpen] = useState<'wipe-prestige' | 'rebuild' | null>(null)
  const start = wipePrestigeText(raidMode, locale)
  const rebuild = rebuildResetText(raidMode, locale)
  return <div className="mode-reset-buttons">
    <button type="button" className="button small prestige-reset-button" onClick={() => setOpen('wipe-prestige')} aria-haspopup="dialog">
      <ChevronsUp size={14} aria-hidden="true" />{start.button}
    </button>
    <button type="button" className="button small rebuild-reset-button" onClick={() => setOpen('rebuild')} aria-haspopup="dialog">
      <RefreshCw size={14} aria-hidden="true" />{rebuild.button}
    </button>
    {/* No «Ожидаем престиж в журналах игры…» under the buttons (owner, 01.11.2026, crossed out on the profile). */}
    {open === 'wipe-prestige' && <WipePrestigeDialog locale={locale} onCancel={() => setOpen(null)} onConfirm={(mode, level) => {
      setOpen(null)
      if (level === null) resetModeProgress(mode, new Date().toISOString(), 'wipe')
      else resetModeProgress(mode, new Date().toISOString(), 'prestige', { prestige: level })
    }} />}
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

/** The modes the window asks between: the prestige's, and Season, which has wipes only. */
const RESET_MODES: readonly RaidMode[] = [...PRESTIGE_MODES, 'seasonal']

/**
 * «Вайп / Престиж» in two steps (owner, 16.10.2026: «при нажатии кнопки престиж появляется PVP или PVE и после выбора
 * появляется выбор уровня престижа»): first the mode, then the text for it and a required choice, a wipe (the prestige stays)
 * or the new prestige by its badge, nothing chosen at first; «Сбросить» is disabled until then. Season has no prestige: it
 * asks nothing more. `onConfirm`: the prestige chosen, null for a wipe.
 */
export function WipePrestigeDialog({ locale, onCancel, onConfirm }: { locale: AppLocale; onCancel: () => void; onConfirm: (mode: RaidMode, level: number | null) => void }) {
  const [mode, setMode] = useState<RaidMode | null>(null)
  const [chosen, setChosen] = useState<number | 'wipe' | null>(null)
  const start = wipePrestigeText(mode ?? 'pvp', locale)
  if (!mode) {
    return <ResetDialog id="wipe-prestige" title={start.title} question={start.chooseMode} close={start.close} onCancel={onCancel}>
      <div className="prestige-mode-choice" role="group" aria-label={start.chooseMode}>
        {RESET_MODES.map((entry) => <button key={entry} type="button" className="button prestige-mode-button" data-mode={entry} onClick={() => { setMode(entry); setChosen(entry === 'seasonal' ? 'wipe' : null) }}>
          {entry === 'seasonal' ? <Eraser size={56} aria-hidden="true" /> : <PrestigeIcon level={1} size={72} mode={entry} />}
          <span>{modeResetName(entry, locale)}</span>
        </button>)}
      </div>
      <div className="prestige-reset-actions">
        <button type="button" className="button ghost" onClick={onCancel} autoFocus>{start.cancel}</button>
      </div>
    </ResetDialog>
  }
  const text = wipePrestigeText(mode, locale)
  const choose = (value: number | 'wipe') => (event: { key: string; preventDefault: () => void }) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setChosen(value) }
  }
  return <ResetDialog id="wipe-prestige" title={text.title} question={text.question} close={text.close} onCancel={onCancel}>
    {mode !== 'seasonal' && <>
      <div className="prestige-picker-label" id="prestige-picker-label">{text.choose}</div>
      <ul className="prestige-picker" role="listbox" aria-labelledby="prestige-picker-label" data-mode={mode}>
        <li role="option" aria-selected={chosen === 'wipe'} aria-label={text.wipe} tabIndex={0} className={`prestige-picker-wipe${chosen === 'wipe' ? ' is-chosen' : ''}`} onClick={() => setChosen('wipe')} onKeyDown={choose('wipe')}>
          <Eraser size={30} aria-hidden="true" />
          <strong>{text.wipe}</strong>
          <small>{text.wipeNote}</small>
        </li>
        {PRESTIGE_CHOICES.map((level) => <li key={level} role="option" aria-selected={chosen === level} aria-label={prestigeLabel(level, locale)} tabIndex={0}
          className={chosen === level ? 'is-chosen' : undefined} onClick={() => setChosen(level)} onKeyDown={choose(level)}>
          <PrestigeIcon level={level} size={64} mode={mode} />
        </li>)}
      </ul>
    </>}
    <div className="prestige-reset-actions">
      <button type="button" className="button danger" disabled={chosen === null} onClick={() => { if (chosen !== null) onConfirm(mode, chosen === 'wipe' ? null : chosen) }}>{text.confirm}</button>
      <button type="button" className="button ghost" onClick={() => setMode(null)}>{text.back}</button>
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
