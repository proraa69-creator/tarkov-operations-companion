import { useEffect, useLayoutEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, X } from 'lucide-react'
import { raidRunning, useRaidState } from '../app/useRaidState'
import { useLocale } from '../i18n/LocaleProvider'
import { useMinuteClock } from './tradingClock'
import '../styles/trading-intro.css'

/** Once per installation. A new key would show it again; nothing else does. */
export const TRADING_INTRO_KEY = 'raidos-trading-intro-v1'
const TRADING_PATH = '/economy/trading'
const SPOTLIGHT = 'nav-link-spotlight'
const CARD_GAP = 26

const readSeen = () => {
  try { return Boolean(window.localStorage.getItem(TRADING_INTRO_KEY)) } catch { return false }
}
const rememberSeen = () => {
  try { window.localStorage.setItem(TRADING_INTRO_KEY, '1') } catch { /* it comes once more at the next start */ }
}

/** The menu's link: on the phone there is none, the message then stands by itself. */
const menuLink = () => document.querySelector<HTMLElement>(`.nav-link[href$="${TRADING_PATH}"]`)

/**
 * What is new, at the start after the update (owner, 05.11.2026: «при запуске укажи на блок торговли указатели покажи и напиши
 * уведомление… только коротко»): an arrow to «Торговля» in the menu, the item lit up, a few lines beside it. Not in a raid, and
 * not for who is already on the page: opening it counts as seen.
 */
export function TradingIntro() {
  const { locale } = useLocale()
  const navigate = useNavigate()
  const onPage = useLocation().pathname === TRADING_PATH
  const raid = useRaidState()
  const clock = useMinuteClock()
  const inRaid = raidRunning(raid, clock)
  const [closed, setClosed] = useState(false)
  const [top, setTop] = useState<number | null>(null)
  const [left, setLeft] = useState(0)
  const shown = !closed && !inRaid && !onPage && !readSeen()

  useEffect(() => {
    if (onPage) rememberSeen()
  }, [onPage])

  useLayoutEffect(() => {
    if (!shown) return
    const link = menuLink()
    if (!link) return
    link.scrollIntoView?.({ block: 'nearest' })
    link.classList.add(SPOTLIGHT)
    const measure = () => {
      const box = link.getBoundingClientRect()
      setTop(box.top + box.height / 2)
      setLeft(box.right + CARD_GAP)
    }
    measure()
    window.addEventListener('resize', measure)
    const menu = link.closest('aside')
    menu?.addEventListener('scroll', measure, { passive: true })
    return () => {
      window.removeEventListener('resize', measure)
      menu?.removeEventListener('scroll', measure)
      link.classList.remove(SPOTLIGHT)
    }
  }, [shown])

  if (!shown) return null
  const t = (ru: string, en: string) => locale === 'en' ? en : ru
  const close = () => {
    rememberSeen()
    setClosed(true)
  }
  const anchored = top !== null
  return (
    <div className={`trading-intro ${anchored ? 'anchored' : 'free'}`} role="dialog" aria-label={t('Новое: Торговля', 'New: Trading')} {...(anchored ? { style: { top, left } } : {})}>
      {anchored && <ArrowLeft className="trading-intro-arrow" size={22} aria-hidden="true" />}
      <button type="button" className="icon-button trading-intro-close" aria-label={t('Закрыть', 'Close')} onClick={close}><X size={14} /></button>
      <strong>{t('Новое: Торговля', 'New: Trading')}</strong>
      <p>{t('Минимум, максимум и цена сейчас: что купить дешевле и продать дороже.', 'Low, high and the price now: what to buy low and sell high.')}</p>
      <p>{t('«Продажа модулей»: детали для Оружейника дешевле у торговца, дороже на барахолке.', '«Module sales»: Gunsmith parts, cheaper at a trader, dearer on the flea market.')}</p>
      <small className="dim">{t('Не гарантия заработка, а статистика. Из-за скачков цена может отличаться.', 'No guarantee of earnings, only statistics. Price jumps can make the price differ.')}</small>
      <div className="trading-intro-actions">
        <button type="button" className="button primary" onClick={() => { close(); navigate(TRADING_PATH) }}>{t('Открыть', 'Open')}</button>
        <button type="button" className="button ghost" onClick={close}>{t('Понятно', 'Got it')}</button>
      </div>
    </div>
  )
}
