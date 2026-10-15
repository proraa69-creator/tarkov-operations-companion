import { useEffect } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useLocale } from '../i18n/LocaleProvider'
import { dismissModeResetNotice, modeResetMessage, useModeResetNotices, type ModeResetNotice } from '../state/modeReset'
import '../styles/modeReset.css'

/** How long a reset notice stays (it can be closed before). */
const NOTICE_MS = 9_000

/**
 * The short notice after a reset of one mode (src/state/modeReset.ts): «Ник изменился — прогресс режима PvE сброшен» /
 * «Nickname changed — PvE progress was reset», or the same after «Престиж +». Mounted once (AppShell), PC and phone.
 */
export function ModeResetToast() {
  const notices = useModeResetNotices()
  if (!notices.length) return null
  return <div className="mode-reset-toasts" role="status" aria-live="polite">
    {notices.map((notice) => <Notice key={notice.id} notice={notice} />)}
  </div>
}

function Notice({ notice }: { notice: ModeResetNotice }) {
  const { locale } = useLocale()
  useEffect(() => {
    const timer = window.setTimeout(() => dismissModeResetNotice(notice.id), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [notice.id])
  return <div className="panel mode-reset-toast">
    <RotateCcw size={16} aria-hidden="true" />
    <span>{modeResetMessage(notice.reason, notice.mode, locale)}</span>
    <button type="button" className="icon-button" aria-label={locale === 'en' ? 'Close' : 'Закрыть'} onClick={() => dismissModeResetNotice(notice.id)}><X size={14} /></button>
  </div>
}
