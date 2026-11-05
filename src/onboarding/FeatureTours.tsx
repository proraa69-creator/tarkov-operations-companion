import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMobileLayout } from '../platform'
import { useServerStatus } from '../sync/serverSync'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useWindowTurn } from '../app/windowTurn'
import { useMinuteClock } from '../trading/tradingClock'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'
import { isNewAccount } from './guideProgress'
import { answerTours, dueTips, markNewsDone, markTipSeen, readTours, startTours, TOURS_CHANGED_EVENT, type ToursRecord } from './tours'

const QUESTION: GuideTipContent = {
  title: { ru: 'Показать возможности Raid OS?', en: 'Show what Raid OS can do?' },
  text: () => ({ ru: 'Коротко покажем главное на каждой вкладке, когда вы её откроете.', en: 'We’ll briefly show the main things on each tab when you open it.' }),
}
const SHOW = { ru: 'Показать', en: 'Show' }
const NO = { ru: 'Нет, спасибо', en: 'No, thanks' }
const NEXT = { ru: 'Далее', en: 'Next' }
const DONE = { ru: 'Понятно', en: 'Got it' }
const OPEN = { ru: 'Открыть', en: 'Open' }

/** A page drawn (not the «Загружаем актуальную базу» screen before it): the tips wait for it. */
const PAGE = 'main.content .page'

/**
 * The tips about the app's functions (src/onboarding/tours.ts): a new player's question once, then on each section's
 * first visit its few tips one after another, and the latest release's news once in its own section. One window at a
 * time with the app's other windows (app/windowTurn.ts); each tip counts as seen when «Далее» / «Понятно» is pressed, so
 * one the player left by changing the page comes on the next visit.
 */
export function FeatureTours() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const phone = useMobileLayout()
  const desktop = typeof window !== 'undefined' && Boolean(window.tarkovDesktop)
  const status = useServerStatus()
  const raid = useRaidState()
  const clock = useMinuteClock()
  const inRaid = raidRunning(raid, clock)
  const [record, setRecord] = useState<ToursRecord | null>(readTours)
  useEffect(() => {
    const read = () => setRecord(readTours())
    window.addEventListener(TOURS_CHANGED_EVENT, read)
    return () => window.removeEventListener(TOURS_CHANGED_EVENT, read)
  }, [])
  // The first look decides once the account is known: a new account is asked, an existing one is not. The record it
  // writes comes back through the event above.
  useEffect(() => {
    if (!record && status) startTours(Boolean(status.signedIn && isNewAccount(status)))
  }, [record, status])
  useEffect(() => {
    if (record) markNewsDone(pathname)
  }, [record, pathname])
  const tips = record ? dueTips(pathname, record, { phone, desktop, inRaid }) : []
  const pending = record?.choice === 'ask' ? 'question' : tips[0]?.key ?? null
  const ready = useGuideReady(pending ? `tours:${pending}` : null, pathname, PAGE)
  const [open, setOpen] = useState<string | null>(null)
  const turn = useWindowTurn('feature-tours', Boolean(open) || Boolean(pending && ready))
  if (!open && pending && ready && turn) setOpen(pending)
  // Another page, or the tip is not due any more: it closes and waits for its page.
  if (open && open !== pending && open !== 'question') setOpen(null)
  if (!open) return null
  if (open === 'question') {
    const answer = (choice: 'yes' | 'no') => { answerTours(choice); setOpen(null) }
    return <GuideTip key="question" id="tours-question" tip={QUESTION} phone={phone} acceptLabel={SHOW} onAccept={() => answer('yes')} decline={{ label: NO, onDecline: () => answer('no') }} />
  }
  const current = tips[0]
  // «Далее»: the next tip of this page opens at once; the last one closes the tour of the page.
  const close = () => { markTipSeen(current.key); setOpen(tips[1]?.key ?? null) }
  const { opens } = current.tip
  if (opens) return <GuideTip key={current.key} id={`tours-${current.key}`} tip={current.tip} phone={phone} acceptLabel={OPEN} onAccept={() => { close(); navigate(opens) }} decline={{ label: DONE, onDecline: close }} />
  return <GuideTip key={current.key} id={`tours-${current.key}`} tip={current.tip} phone={phone} acceptLabel={tips.length > 1 ? NEXT : DONE} onAccept={close} />
}
