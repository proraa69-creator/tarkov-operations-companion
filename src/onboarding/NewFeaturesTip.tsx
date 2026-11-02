import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isMobileLayout, useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/**
 * Shown on this device under this key: the pointers never show here again. New sections take a new key, so the players
 * who saw the earlier pointers (18.10.2026, «Сборка оружия» and «Убежище»: 'raidos-new-features-0-6-0-68-v1'; 02.11.2026,
 * «Тир листы»: 'raidos-new-features-0-6-0-176-v1', the Halloween event: 'raidos-new-features-0-6-0-181-v1') see them.
 */
export const NEW_FEATURES_TIP_KEY = 'raidos-new-features-0-6-0-192-v1'

/** The menu entry on the PC; on the phone the sections are in «Ещё». */
const PHONE_TARGET = '.mobile-tabbar .mobile-tab[aria-expanded]'
const navTarget = (path: string) => `.sidebar:not(.mobile-tabbar) a.nav-link[href$="${path}"]`

// owner, 02.11.2026: «Ты добавил окно с указателем при первом запуске после обновления? Что бы люди видели что
// добавилась новая функция?» — «Тир листы» in «Экономика» (0.6.0.175).
export const TIER_LISTS_TIP: GuideTipContent = {
  title: { ru: 'Новое: тир листы', en: 'New: tier lists' },
  text: (phone) => ({
    ru: `Тир листы по категориям: ценности, ключи, медицина, патроны, бронежилеты, шлемы, рюкзаки и другие. В каждой категории предметы разложены по тирам S–D — по цене за слот в выбранном режиме или по характеристикам.${phone ? ' Открыть: «Ещё» → «Тир листы».' : ''}`,
    en: `Tier lists by category: valuables, keys, medical supplies, ammo, body armor, helmets, backpacks and more. In each category items are ranked S–D by the price per slot in the chosen mode or by their stats.${phone ? ' Open: «More» → «Tier lists».' : ''}`,
  }),
}

// owner, 03.11.2026: «после обновления должно появится уведомление у всех о том что добавлена новая функция и сделай не
// большое ее описание для чего она» — «Отложенные квесты» on the map and in «Квесты» (src/progression/deferredQuests.ts),
// pointed at «Карты» in the PC menu. The phone has no right click: not shown there.
const DEFERRED_QUESTS_TIP: GuideTipContent = {
  title: { ru: 'Новое: отложенные квесты', en: 'New: deferred quests' },
  text: () => ({
    ru: 'Нет ключа или нужного предмета? Нажмите правой кнопкой мыши на квест в «Квестах на карте», на его точку или на задание в «Квестах» и выберите «Добавить в отложенные»: квест и его метки перестанут мешать на карте и в текущих заданиях. Вернуть их — кнопка «Отложенные квесты» на карте и в «Квестах»: там же видно, какой ключ или предмет нужен.',
    en: 'No key or item for a quest yet? Right-click the quest in «Quests on the map», its point or the task in «Quests» and choose «Defer quest»: the quest and its markers stop cluttering the map and the current tasks. Bring them back with «Deferred quests» on the map and in «Quests», which also shows the key or item each one needs.',
  }),
}

/**
 * The pointers, in turn: the new section's id, its menu path (or the element itself) and its words; one that is not on
 * now (an event that is over) is left out.
 */
const STEPS: Array<{ id: string; path?: string; target?: string; tip: GuideTipContent; active?: () => boolean }> = [
  { id: 'deferred-quests', path: '/maps', tip: DEFERRED_QUESTS_TIP, active: () => !isMobileLayout() },
]

// Storage unavailable: taken as seen, so the pointers never come back on every start.
const readSeen = () => { try { return localStorage.getItem(NEW_FEATURES_TIP_KEY) !== null } catch { return true } }

/**
 * Once per device, on the Overview: a pointer at each new section (the menu entry on the PC, «Ещё» on the phone, or the
 * new button itself). Like the other tips it waits until no other one is open, and it is kept as shown the moment it opens.
 */
export function NewFeaturesTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const [seen] = useState(readSeen)
  const [steps] = useState(() => STEPS.filter((step) => step.active?.() ?? true))
  const target = (step: (typeof STEPS)[number]) => step.target ?? (phone ? PHONE_TARGET : navTarget(step.path ?? '/'))
  const due = !seen && pathname === '/' && steps.length > 0
  const ready = useGuideReady(due ? 'new-features' : null, pathname, steps.length ? target(steps[0]) : undefined)
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step^="new-features"])'))
    const firstCheck = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(firstCheck); window.clearInterval(timer); setClear(false) }
  }, [ready])
  const [shown, setShown] = useState<number | 'no' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown(0)
  if (typeof shown === 'number' && pathname !== '/') setShown('closed')
  const open = typeof shown === 'number'
  useEffect(() => {
    if (!open) return
    try { localStorage.setItem(NEW_FEATURES_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [open])
  if (!open) return null
  const step = steps[shown]
  const tip = { ...step.tip, target: target(step) }
  return <GuideTip key={step.id} id={`new-features-${step.id}`} tip={tip} phone={phone} onAccept={() => setShown(shown + 1 < steps.length ? shown + 1 : 'closed')} />
}
