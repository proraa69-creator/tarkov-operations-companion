import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'
import presetsShot from '../assets/screen-presets-intro.webp'
import './screenTuningIntro.css'

/** Shown on this computer under this key (the app's own data: a reinstall keeps it): the tour never comes back. */
export const SCREEN_INTRO_KEY = 'raidos-screen-tuning-intro-v1'

type Step = 'nav' | 'presets' | 'key' | 'optimize'

/**
 * The tour of «Настройка экрана» after the update that brings it (owner, 28.10.2026: «всплывающее окно при первом
 * запуске… один раз у всех… указатель сбоку, потом открывается страница настройки экрана и показывается скриншот с
 * четырьмя скриншотами… расскажи указателями о кнопках… включения по клавише… и об
 * оптимизации, что безопасно и не влияет на важные файлы»).
 */
export const SCREEN_INTRO: Record<Step, GuideTipContent> = {
  nav: {
    title: { ru: 'Новое: настройка экрана', en: 'New: screen settings' },
    text: () => ({
      ru: 'Тёмные помещения и ночные рейды теперь можно сделать светлее. Приложение меняет только настройку монитора — никак не работает с игрой и не влияет на неё. Нажмите «Принял», откроем раздел.',
      en: 'Dark rooms and night raids can now be made lighter. The app changes only the monitor setting — it does not work with the game in any way and does not affect it. Press «Got it» to open the section.',
    }),
    target: '.sidebar a.nav-link[href$="/screen"]',
  },
  presets: {
    title: { ru: 'Готовые пресеты и свои', en: 'Ready presets and your own' },
    text: () => ({
      ru: 'Слева — как в игре, справа — с пресетом. Выберите готовый пресет или добавьте свой: кривая, ползунки и фильтры, изменения сразу видны в игре. Пресетов можно сделать сколько угодно, любой можно переименовать и изменить.',
      en: 'Left — as in the game, right — with a preset. Pick a ready preset or add your own: the curve, the sliders and the filters, changes show in the game at once. Make as many as you like, rename and change any of them.',
    }),
  },
  key: {
    title: { ru: 'Клавиши', en: 'Keys' },
    text: () => ({
      ru: 'Назначьте свои клавиши: одна включает и выключает пресет прямо в игре, другая переключает пресеты по очереди. Пресет работает только в рейде — в меню игры экран обычный.',
      en: 'Set your own keys: one turns the preset on and off right in the game, the other switches the presets in turn. A preset works only in a raid — the game menus look as usual.',
    }),
    target: '.preset-keys',
  },
  optimize: {
    title: { ru: 'Оптимизация компьютера', en: 'PC optimization' },
    text: () => ({
      ru: 'Безопасные настройки Windows для игр: схема питания и игровой режим. Ничего не разгоняется, игра и важные файлы не затрагиваются, всё возвращается одной кнопкой «Вернуть как было».',
      en: 'Safe Windows settings for games: the power plan and Game Mode. Nothing is overclocked, the game and important files are not touched, everything goes back with one «Put it back» button.',
    }),
    target: '.screen-tabs button[role="tab"]:last-child',
  },
}

const ORDER: Step[] = ['nav', 'presets', 'key', 'optimize']

// Storage unavailable: taken as seen, so the tour never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(SCREEN_INTRO_KEY) !== null } catch { return true } }

/** The PC app only, once: a pointer at the menu entry, then the page with the before / after picture and its buttons. */
export function ScreenTuningIntro() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [seen] = useState(readSeen)
  const [step, setStep] = useState<Step | 'no' | 'closed'>('no')
  const desktop = Boolean(window.tarkovDesktop?.screen)
  const due = desktop && !seen && step === 'no'
  const ready = useGuideReady(due ? 'screen-intro' : null, pathname, SCREEN_INTRO.nav.target)
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step^="screen-intro"])'))
    const firstCheck = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(firstCheck); window.clearInterval(timer); setClear(false) }
  }, [ready])
  if (step === 'no' && due && ready && clear) setStep('nav')
  const open = step !== 'no' && step !== 'closed'
  useEffect(() => {
    if (!open) return
    try { localStorage.setItem(SCREEN_INTRO_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [open])
  // The steps after the first are on the page itself: wait until it and the part pointed at are drawn.
  const target = open ? SCREEN_INTRO[step].target : undefined
  const [drawnFor, setDrawnFor] = useState('')
  useEffect(() => {
    if (!open || step === 'nav') return
    const shown = step
    const timer = window.setInterval(() => {
      if (pathname !== '/screen' || (target && !document.querySelector(target))) return
      setDrawnFor(shown)
      window.clearInterval(timer)
    }, 200)
    return () => window.clearInterval(timer)
  }, [open, step, target, pathname])
  const drawn = drawnFor === step
  if (!open) return null
  if (step !== 'nav' && !drawn) return null
  const next = ORDER[ORDER.indexOf(step) + 1]
  const accept = () => {
    if (step === 'nav') navigate('/screen')
    setStep(next ?? 'closed')
  }
  return (
    <GuideTip key={step} id={`screen-intro-${step}`} tip={SCREEN_INTRO[step]} phone={false} onAccept={accept}>
      {step === 'presets' && <img className="screen-intro-shot" src={presetsShot} alt="" width={2000} height={838} />}
    </GuideTip>
  )
}
