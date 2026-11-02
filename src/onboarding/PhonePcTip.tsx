import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useWindowTurn } from '../app/windowTurn'
import { isNative } from '../platform'
import { useAppState } from '../state/AppState'
import { useServerStatus } from '../sync/serverSync'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown on this phone under this key: never again. */
export const PHONE_PC_TIP_KEY = 'raidos-phone-pc-tip-v1'
/** The PC's copy of the quests reaches the phone in the first seconds after the sign-in: the tip waits for it. */
export const PHONE_PC_DATA_WAIT_MS = 12_000

// owner, 03.11.2026: «в приложении для телефонов добавь подсказку, для новых пользователей, что бы данные
// синхронизировались с игрой, нужно установить версию для пк».
export const PHONE_PC_TIP: GuideTipContent = {
  title: { ru: 'Синхронизация с игрой', en: 'Sync with the game' },
  text: () => ({
    ru: 'Чтобы квесты, уровень и прогресс подтягивались из игры, установите Raid OS на компьютер, где вы играете, и войдите в тот же аккаунт: raidos.app/download. Игру читает приложение на ПК, а телефон показывает то же самое.',
    en: 'For your quests, level and progress to come from the game, install Raid OS on the PC you play on and sign in to the same account: raidos.app/download. The PC app reads the game; the phone shows the same.',
  }),
}

// Storage unavailable: taken as seen, so the tip never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(PHONE_PC_TIP_KEY) !== null } catch { return true } }
const markSeen = () => { try { localStorage.setItem(PHONE_PC_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ } }

/**
 * The phone app (Android, iPhone), once: a new player whose account has nothing from a PC yet — no quests in any mode a
 * few seconds after the sign-in, the PC's copy included — learns that the game is read by the PC app. An account with
 * the PC's data never sees it. Like the other tips it waits its turn (app/windowTurn.ts).
 */
export function PhonePcTip() {
  const { pathname } = useLocation()
  const status = useServerStatus()
  const { activeProfile } = useAppState()
  const [seenBefore] = useState(readSeen)
  const [accepted, setAccepted] = useState(false)
  const [waited, setWaited] = useState(false)
  useEffect(() => {
    const timer = window.setTimeout(() => setWaited(true), PHONE_PC_DATA_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [])
  const hasData = Object.values(activeProfile.modes).some((progress) => Object.keys(progress.taskProgress).length > 0)
  // The PC's data is here: this player has the PC app, the tip is never needed on this phone.
  useEffect(() => { if (hasData && !seenBefore) markSeen() }, [hasData, seenBefore])
  const seen = seenBefore || accepted || hasData
  const due = isNative() && Boolean(status?.signedIn) && !seen && waited
  const ready = useGuideReady(due ? 'phone-pc' : null, pathname)
  const [shown, setShown] = useState<'no' | 'open' | 'closed'>('no')
  const turn = useWindowTurn('phone-pc', (shown === 'no' && due && ready) || shown === 'open')
  if (shown === 'no' && due && ready && turn) setShown('open')
  useEffect(() => { if (shown === 'open') markSeen() }, [shown])
  if (shown !== 'open') return null
  return <GuideTip id="phone-pc" tip={PHONE_PC_TIP} phone onAccept={() => { setShown('closed'); setAccepted(true) }} />
}
