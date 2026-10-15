import { useEffect, useState } from 'react'
import { CountryGateDialog, useCountryGate } from '../account/CountryGate'
import { useLocale } from '../i18n/LocaleProvider'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { logoutFromServer } from '../sync/serverSync'
import { closeNotice, putOffSurvey, reportSeen, useNoticeInbox } from './noticeInbox'
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
  const inbox = useNoticeInbox(gate.missing ? '' : gate.account)
  const inRaid = useInRaid()
  const notice = inbox.notices[0]
  const survey = notice ? undefined : inbox.surveys[0]
  const shown = gate.missing || inRaid ? undefined : notice ?? survey
  useEffect(() => { if (shown) reportSeen(shown.id) }, [shown])

  if (gate.missing) return <CountryGateDialog onSaved={gate.saved} onSignOut={() => { void logoutFromServer() }} />
  if (inRaid) return null
  if (notice) return <NoticePopup key={notice.id} notice={notice} locale={locale} onClose={() => closeNotice(notice.id)} />
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
