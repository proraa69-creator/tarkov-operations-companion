import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown on this device under this key: the tip never shows here again. */
export const GOONS_REST_TIP_KEY = 'raidos-goons-rest-tip-v1'

/** Only the empty «Сбор на рейд», where the Goons sit (src/overview/QuestConditionsCard.tsx). */
const TARGET = '.quest-conditions-card.is-empty'
// owner, 16.10.2026: «сделай одноразовый показ указателя на добавленных кочевников, именно покажи только блок сбор на
// рейд, напиши от лица кочевников: у тебя тут квестов нету, мы посидим пока»
export const GOONS_REST_TIP: GuideTipContent = {
  title: { ru: 'Кочевники', en: 'The Goons' },
  text: () => ({ ru: 'У тебя тут квестов нету, мы посидим пока.', en: 'No quests for you here, so we’ll sit a while.' }),
  target: TARGET,
}

// Storage unavailable: taken as seen, so the tip never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(GOONS_REST_TIP_KEY) !== null } catch { return true } }

/**
 * Once per device: on the Overview, the first time «Сбор на рейд» is empty and the Goons sit in it, a pointer at that
 * block alone with their words. Like the other tips it waits until no other one is open, and it is kept as shown the
 * moment it opens.
 */
export function GoonsRestTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const [seen] = useState(readSeen)
  const due = !seen && pathname === '/'
  const ready = useGuideReady(due ? 'goons-rest' : null, pathname, TARGET)
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step="goons-rest"])'))
    const first = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(first); window.clearInterval(timer); setClear(false) }
  }, [ready])
  const [shown, setShown] = useState<'no' | 'open' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown('open')
  if (shown === 'open' && pathname !== '/') setShown('closed')
  useEffect(() => {
    if (shown !== 'open') return
    try { localStorage.setItem(GOONS_REST_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [shown])
  if (shown !== 'open') return null
  return <GuideTip id="goons-rest" tip={GOONS_REST_TIP} phone={phone} onAccept={() => setShown('closed')} />
}
