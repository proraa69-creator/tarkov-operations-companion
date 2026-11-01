import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useServerStatus } from '../sync/serverSync'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown for this account on this computer under this key + e-mail: never again (v2: on the map, owner, 01.11.2026). */
export const SCREENSHOT_KEY_TIP_PREFIX = 'raidos-screenshot-key-tip-v2:'

// owner, 31.10.2026: «добавь для тех людей кто в первый раз авторизуется в приложении, в пробный период и больше не надо
// будет, при открытии будет окно на фоне обзора : для работы местоположения, настройте клавишу скриншота в игре»; then
// (01.11.2026) «сделай подсказку для новых игроков, когда они заходят на карту… это единоразовое уведомление при первом
// входе».
export const SCREENSHOT_KEY_TIP: GuideTipContent = {
  title: { ru: 'Местоположение на карте', en: 'Your position on the map' },
  text: () => ({
    ru: 'Чтобы точка показывала, где вы на карте, настройте клавишу скриншота в самой игре: «Настройки» → «Управление» → в самом низу «Сделать скриншот» → назначьте клавишу. В рейде нажимайте эту клавишу — приложение покажет ваше местоположение на ПК и в телефоне. Скриншот нужно делать именно клавишей игры, а не средствами Windows или других программ.',
    en: 'For the dot to show where you are on the map, set the screenshot key in the game itself: Settings → Controls → at the very bottom “Take screenshot” → bind a key. Press that key in a raid — the app shows your position on the PC and on the phone. Take the screenshot with the game’s key, not with Windows or another program.',
  }),
}

const readSeen = (email: string) => { try { return localStorage.getItem(SCREENSHOT_KEY_TIP_PREFIX + email) !== null } catch { return true } }

/**
 * The PC app (the position comes from the game's screenshots on this computer): once, the first time the map is opened,
 * for an account in its free period — a new player — a window over the map about the game's screenshot key. Like the
 * other tips it waits until no other one is open, and it is kept as shown the moment it opens.
 */
export function ScreenshotKeyTip() {
  const { pathname } = useLocation()
  const status = useServerStatus()
  const email = status?.signedIn && status.email ? status.email.toLowerCase() : ''
  const trial = status?.subscription?.status === 'trial'
  const desktop = Boolean(window.tarkovDesktop)
  const due = desktop && trial && Boolean(email) && !readSeen(email) && pathname.startsWith('/maps')
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
