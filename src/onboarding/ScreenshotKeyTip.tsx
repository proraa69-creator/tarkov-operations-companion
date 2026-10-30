import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useServerStatus } from '../sync/serverSync'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown for this account on this computer under this key + e-mail: never again. */
export const SCREENSHOT_KEY_TIP_PREFIX = 'raidos-screenshot-key-tip-v1:'

// owner, 31.10.2026: «добавь для тех людей кто в первый раз авторизуется в приложении, в пробный период и больше не надо
// будет, при открытии будет окно на фоне обзора : для работы местоположения, настройте клавишу скриншота в игре».
export const SCREENSHOT_KEY_TIP: GuideTipContent = {
  title: { ru: 'Местоположение на карте', en: 'Your position on the map' },
  text: () => ({
    ru: 'Для работы местоположения настройте клавишу скриншота в игре: «Настройки» → «Управление» → «Скриншот» (по умолчанию PrtSc). В рейде нажимайте её — приложение покажет, где вы на карте, и на ПК, и в телефоне.',
    en: 'For your position to work, set the screenshot key in the game: Settings → Controls → “Screenshot” (PrtSc by default). Press it in a raid — the app shows where you are on the map, on the PC and on the phone.',
  }),
}

const readSeen = (email: string) => { try { return localStorage.getItem(SCREENSHOT_KEY_TIP_PREFIX + email) !== null } catch { return true } }

/**
 * The PC app (the position comes from the game's screenshots on this computer): once, on the Overview, for an account in
 * its free period — the first sign-in of a new player — a window over the page about the game's screenshot key. Like the
 * other tips it waits until no other one is open, and it is kept as shown the moment it opens.
 */
export function ScreenshotKeyTip() {
  const { pathname } = useLocation()
  const status = useServerStatus()
  const email = status?.signedIn && status.email ? status.email.toLowerCase() : ''
  const trial = status?.subscription?.status === 'trial'
  const desktop = Boolean(window.tarkovDesktop)
  const due = desktop && trial && Boolean(email) && !readSeen(email) && pathname === '/'
  const ready = useGuideReady(due ? 'screenshot-key' : null, pathname)
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step^="screenshot-key"])'))
    const firstCheck = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(firstCheck); window.clearInterval(timer); setClear(false) }
  }, [ready])
  const [shown, setShown] = useState<'no' | 'open' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown('open')
  useEffect(() => {
    if (shown !== 'open' || !email) return
    try { localStorage.setItem(SCREENSHOT_KEY_TIP_PREFIX + email, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [shown, email])
  if (shown !== 'open') return null
  return <GuideTip id="screenshot-key" tip={SCREENSHOT_KEY_TIP} phone={false} onAccept={() => setShown('closed')} />
}
