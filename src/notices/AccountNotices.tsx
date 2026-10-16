import { useEffect, useState, type ReactNode } from 'react'
import { CountryGateDialog } from '../account/CountryGate'
import { useCountryGate } from '../account/initialCountry'
import { useLocale } from '../i18n/LocaleProvider'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { logoutFromServer } from '../sync/serverSync'
import { closeNotice, noticeImage, putOffSurvey, reportSeen, useNoticeInbox, useNoticesFirst } from './noticeInbox'
import { NoticePopup } from './NoticePopup'
import { SurveyPopup } from './SurveyPopup'
import './notices.css'

/** How often a running raid is looked at again (a raid flag can grow stale without a new event, useRaidState.ts). */
const RAID_RECHECK_MS = 30_000

/**
 * What the server asks of the signed-in account, over the whole app (src/app/App.tsx: the PC and the phone, the locked
 * screens too), one window at a time:
 * 1. «Укажите страну» while the account has no country (account/CountryGate.tsx) — nothing else until it is answered;
 * 2. the owner's announcements, oldest first (NoticePopup.tsx), then the surveys (SurveyPopup.tsx) — never during a raid
 *    (the desktop app's raid signal from the game logs): they wait in the inbox and come after it. These are windows of
 *    the app, never anything over the game.
 */
export function AccountNotices() {
  const gate = useCountryGate()
  const { locale } = useLocale()
  const inbox = useNoticeInbox(gate.missing ? '' : gate.account, gate.signedIn)
  const inRaid = useInRaid()
  const notice = inbox.notices[0]
  const survey = notice ? undefined : inbox.surveys[0]
  // An announcement already on screen stays there when a raid starts: only the player's button closes it (owner,
  // 16.10.2026); a new one still waits for the raid's end.
  const [onScreen, setOnScreen] = useState<number | null>(null)
  const keep = Boolean(notice && notice.id === onScreen)
  const shown = gate.missing || (inRaid && !keep) ? undefined : notice ?? survey
  if (notice && shown === notice && onScreen !== notice.id) setOnScreen(notice.id)
  useEffect(() => { if (shown) reportSeen(shown.id) }, [shown])

  if (gate.missing) return <CountryGateDialog onSaved={gate.saved} onSignOut={() => { void logoutFromServer() }} />
  if (inRaid && !keep) return null
  if (notice) return <NoticePopup key={notice.id} notice={notice} locale={locale} loadImage={noticeImage} onClose={() => closeNotice(notice.id)} />
  if (survey) return <SurveyPopup key={survey.id} survey={survey} locale={locale} onLater={() => putOffSurvey(survey.id)} />
  return null
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
