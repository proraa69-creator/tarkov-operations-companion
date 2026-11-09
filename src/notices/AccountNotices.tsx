import { useEffect, useState, type ReactNode } from 'react'
import { CountryGateDialog } from '../account/CountryGate'
import { useCountryGate } from '../account/initialCountry'
import { useLocale } from '../i18n/LocaleProvider'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { logoutFromServer } from '../sync/serverSync'
import { closeNotice, noticeImage, putOffSurvey, reportSeen, useNoticeInbox, useNoticesFirst } from './noticeInbox'
import { ToastDock } from '../notifications/ToastDock'
import { NoticeToast } from './NoticeToast'
import { SurveyPopup } from './SurveyPopup'
import { isIosApp } from '../platform'
import { noticeWithoutPayment, surveyWithoutPayment } from './iosNoticeFilter'
import './notices.css'

/** How often a running raid is looked at again (a raid flag can grow stale without a new event, useRaidState.ts). */
const RAID_RECHECK_MS = 30_000

/**
 * What the server asks of the signed-in account, over the whole app (src/app/App.tsx: the PC and the phone, the locked
 * screens too), one window at a time:
 * 1. «Укажите страну» while the account has no country (account/CountryGate.tsx) — nothing else until it is answered;
 * 2. the messages, the owner's announcements and the personal ones (owner, 07.11.2026: «справа снизу, не перекрывая весь экран… само
 *    закрывается там через 7 секунд»; «Абсолютно все объявления не должны перекрывать интерфейс»): in the corner (NoticeToast.tsx), the oldest
 *    first, a few at a time, over nothing. Then the surveys (SurveyPopup.tsx), in the corner too; those ask for an answer, so they stay until
 *    it or «Позже». None of it during a raid (the desktop app's raid signal from the game logs): they wait in the inbox and come after it.
 */
/** At once in the corner; the others take their place as these go. */
const TOASTS_AT_ONCE = 3

export function AccountNotices() {
  const gate = useCountryGate()
  const { locale } = useLocale()
  const all = useNoticeInbox(gate.missing ? '' : gate.account, gate.signedIn)
  // The iPhone app says nothing about paying (src/notices/iosNoticeFilter.ts).
  const ios = isIosApp()
  const inbox = ios ? { notices: all.notices.filter(noticeWithoutPayment), surveys: all.surveys.filter(surveyWithoutPayment) } : all
  const inRaid = useInRaid()
  const toasts = gate.missing || inRaid ? [] : inbox.notices.slice(0, TOASTS_AT_ONCE)
  const survey = gate.missing || inRaid || inbox.notices.length ? undefined : inbox.surveys[0]
  useEffect(() => { if (survey) reportSeen(survey.id) }, [survey])

  if (gate.missing) return <CountryGateDialog onSaved={gate.saved} onSignOut={() => { void logoutFromServer() }} />
  return <>
    {toasts.length > 0 && <ToastDock>{toasts.map((notice) => <NoticeToast key={notice.id} notice={notice} locale={locale} loadImage={noticeImage} onSeen={() => reportSeen(notice.id)} onClose={() => closeNotice(notice.id)} />)}</ToastDock>}
    {survey && <ToastDock><SurveyPopup key={survey.id} survey={survey} locale={locale} onLater={() => putOffSurvey(survey.id)} /></ToastDock>}
  </>
}

/** A raid is running now by the game logs (desktop app); false on the phone and in a browser. */
function useInRaid() {
  const raid = useRaidState()
  const [now, setNow] = useState(() => Date.now())
  const flagged = Boolean(raid?.inRaid)
  useEffect(() => {
    if (!flagged) return
    const timer = window.setInterval(() => setNow(Date.now()), RAID_RECHECK_MS)
    return () => window.clearInterval(timer)
  }, [flagged])
  return raidRunning(raid, now)
}

/** How long the tips wait at most for the first inbox answer (no server, no account, an old server). */
const TIPS_WAIT_MS = 6_000

/** The onboarding tips and event windows, after the owner's announcement (useNoticesFirst in noticeInbox.ts). */
export function AfterNotices({ children }: { children: ReactNode }) {
  const { unanswered, pending } = useNoticesFirst()
  const [timedOut, setTimedOut] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), TIPS_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  // An announcement to read keeps its turn whatever the wait: the tips come once it is closed.
  return pending || (unanswered && !timedOut) ? null : <>{children}</>
}
