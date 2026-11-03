import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { isMobileLayout, useMobileLayout } from '../platform'
import { useWindowTurn } from '../app/windowTurn'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/**
 * The pointers shown on this device, by id (a JSON list): each one never shows here again (owner, 03.11.2026: «ни одно
 * окно не должно пропускаться, показало одно, кликнул, включилось следующее, те которые уже человек видел другие окна, их
 * не нужно показывать заного»). Before 0.6.0.211 one key per set marked the whole set as shown once its first pointer
 * opened (18.10.2026, «Сборка оружия» and «Убежище»: 'raidos-new-features-0-6-0-68-v1'; 02.11.2026, «Тир листы»:
 * 'raidos-new-features-0-6-0-176-v1', the Halloween event: 'raidos-new-features-0-6-0-181-v1'; 03.11.2026, «Отложенные
 * квесты» in its first words: 'raidos-new-features-0-6-0-192-v1', in the owner's: 'raidos-new-features-0-6-0-196-v1');
 * a step shown under such a key counts as seen (`seenUnder`).
 */
export const NEW_FEATURES_TIP_KEY = 'raidos-new-features-v2'

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
// pointed at «Карты» in the PC menu. The phone has no right click: not shown there. The words are the owner's own
// (03.11.2026: «напиши другое срочно» — «Нет ключа или нужного предмета для выполнения квеста?…»).
const DEFERRED_QUESTS_TIP: GuideTipContent = {
  title: { ru: 'Новое: отложенные квесты', en: 'New: deferred quests' },
  text: () => ({
    ru: 'Нет ключа или нужного предмета для выполнения квеста? Можете временно убрать квест, чтобы он не мешал в общем списке',
    en: 'No key or item you need for a quest? You can put the quest aside for now so it doesn\'t clutter the list.',
  }),
}

// owner, 03.11.2026: «расскажи коротко об нововведении этой функции» — «Отложить квест» from a right click on the Overview
// (components/QuestDeferDialog.tsx), pointed at «Требования рейда».
const DEFER_OVERVIEW_TIP: GuideTipContent = {
  title: { ru: 'Новое: отложить квест с главного экрана', en: 'New: defer a quest from the Overview' },
  text: () => ({
    ru: 'Нажмите правой кнопкой мыши на предмет в «Требованиях рейда», на снаряжение в «Сборе на рейд» или на квест в «Текущих заданиях» и выберите «Отложить квест»: на 1–7 дней или до уровня, с которого предмет можно купить на барахолке или у торговца. Квест вернётся сам.',
    en: 'Right-click an item in «Raid requirements», the gear in «Raid loadout» or a task in «Current tasks» and choose «Defer quest»: for 1–7 days, or until the level at which the item can be bought on the flea market or from a trader. The quest comes back by itself.',
  }),
}

// owner, 03.11.2026: «предмет или ключ который требуется для квеста который отложен, сам добавлялся в избранное как
// напоминание» (progression/questDeferral.ts), pointed at «Рынок · избранное».
const DEFERRED_FAVORITES_TIP: GuideTipContent = {
  title: { ru: 'Новое: предметы отложенных квестов в избранном', en: 'New: deferred quests\' items in favorites' },
  text: () => ({
    ru: 'Ключи и предметы квеста, который вы отложили, сами добавляются в «Избранное» — как напоминание, а когда квест вернётся, уходят оттуда. Отключить можно в окне «Отложенные квесты» на карте: переключатель «Предметы в избранное» справа.',
    en: 'The keys and items of a quest you defer go into «Favorites» by themselves, as a reminder, and leave it when the quest comes back. You can turn this off in the «Deferred quests» window on the map: the «Items to favorites» switch on the right.',
  }),
}

const pcOnly = () => !isMobileLayout()

/**
 * The pointers, in turn: the new section's id, its menu path (or the element itself) and its words; one that is not on
 * now (an event that is over) is left out. The phone has no right click: the deferred quests' pointers are the PC's.
 */
const STEPS: Array<{ id: string; path?: string; target?: string; tip: GuideTipContent; active?: () => boolean; seenUnder?: string }> = [
  { id: 'deferred-quests', path: '/maps', tip: DEFERRED_QUESTS_TIP, active: pcOnly, seenUnder: 'raidos-new-features-0-6-0-196-v1' },
  { id: 'defer-overview', target: '.raid-needs', tip: DEFER_OVERVIEW_TIP, active: pcOnly },
  { id: 'deferred-favorites', target: '.market-favorites', tip: DEFERRED_FAVORITES_TIP, active: pcOnly },
]

/** The steps seen on this device. Storage unavailable: all of them, so the pointers never come back on every start. */
function readSeen(): ReadonlySet<string> {
  try {
    const seen = new Set<string>()
    const raw = localStorage.getItem(NEW_FEATURES_TIP_KEY)
    const stored: unknown = raw ? JSON.parse(raw) : []
    if (Array.isArray(stored)) for (const id of stored) if (typeof id === 'string') seen.add(id)
    for (const step of STEPS) if (step.seenUnder && localStorage.getItem(step.seenUnder) !== null) seen.add(step.id)
    return seen
  } catch {
    return new Set(STEPS.map((step) => step.id))
  }
}

function markSeen(id: string) {
  try { localStorage.setItem(NEW_FEATURES_TIP_KEY, JSON.stringify([...new Set([...readSeen(), id])])) } catch { /* shows again next start */ }
}

/** The steps of this layout not seen on this device yet, in turn. */
function unseenSteps() {
  const seen = readSeen()
  return STEPS.filter((step) => (step.active?.() ?? true) && !seen.has(step.id))
}

/**
 * On the Overview, a pointer at each new section not seen on this device yet (the menu entry on the PC, «Ещё» on the
 * phone, or the new block itself), one after another: «Принял» opens the next. Like the other tips it waits until no
 * other one is open; each is kept as seen the moment it opens, and the ones not shown yet (the player left the Overview
 * in between) come when the Overview opens again.
 */
export function NewFeaturesTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const [steps, setSteps] = useState(unseenSteps)
  const target = (step: (typeof STEPS)[number]) => step.target ?? (phone ? PHONE_TARGET : navTarget(step.path ?? '/'))
  const due = pathname === '/' && steps.length > 0
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
  // One window at a time (app/windowTurn.ts): in line from the moment it is due, the turn kept through its steps.
  const turn = useWindowTurn('new-features', (shown === 'no' && due && ready) || typeof shown === 'number')
  if (shown === 'no' && due && ready && clear && turn) setShown(0)
  // Another page: the rest wait for the Overview.
  if (typeof shown === 'number' && pathname !== '/') {
    setShown('no')
    setSteps(steps.slice(shown + 1))
  }
  const open = typeof shown === 'number'
  const openId = open ? steps[shown]?.id : undefined
  useEffect(() => {
    if (openId) markSeen(openId)
  }, [openId])
  if (!open) return null
  const step = steps[shown]
  const tip = { ...step.tip, target: target(step) }
  return <GuideTip key={step.id} id={`new-features-${step.id}`} tip={tip} phone={phone} onAccept={() => setShown(shown + 1 < steps.length ? shown + 1 : 'closed')} />
}
