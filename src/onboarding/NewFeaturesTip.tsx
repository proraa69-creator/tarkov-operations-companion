import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { featureEnabled } from '../app/archivedFeatures'
import { useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown on this device under this key: the pointers never show here again. */
export const NEW_FEATURES_TIP_KEY = 'raidos-new-features-0-6-0-68-v1'

/** The menu entry on the PC; on the phone both sections are in «Ещё». */
const PHONE_TARGET = '.mobile-tabbar .mobile-tab[aria-expanded]'
const navTarget = (path: string) => `.sidebar:not(.mobile-tabbar) a.nav-link[href$="${path}"]`

// owner, 18.10.2026: «сделай указатели на новые функции: сборка оружия и убежище. На убежище … напиши что там можно
// делать и „скоро будет добавлена интерактивная модель убежища“. На сборке оружия напиши: можно создавать сборки и
// сохранять их, добавлять в общую базу».
export const WEAPON_BUILDS_TIP: GuideTipContent = {
  title: { ru: 'Новое: сборка оружия', en: 'New: weapon builds' },
  text: (phone) => ({
    ru: `Создавайте сборки оружия: ставятся только совместимые модули, характеристики и цена считаются сразу. Сборки можно сохранять, добавлять в избранное и выкладывать в общую базу — «Топ сборок». Скоро появятся готовые топ-сборки.${phone ? ' Открыть: «Ещё» → «Сборка оружия».' : ''}`,
    en: `Create weapon builds: only compatible parts fit, stats and price update at once. Save builds, star them and share them in the common base — «Top builds». Ready-made top builds are coming soon.${phone ? ' Open: «More» → «Weapon builds».' : ''}`,
  }),
}

export const HIDEOUT_TIP: GuideTipContent = {
  title: { ru: 'Новое: убежище', en: 'New: hideout' },
  text: (phone) => ({
    ru: `Отмечайте найденные предметы для улучшений убежища: видно, что ещё нужно собрать и сколько. Скоро будет добавлена интерактивная модель убежища.${phone ? ' Открыть: «Ещё» → «Убежище».' : ''}`,
    en: `Mark the items you have found for hideout upgrades: see what is still needed and how many. An interactive hideout model is coming soon.${phone ? ' Open: «More» → «Hideout».' : ''}`,
  }),
}

type Step = 'builds' | 'hideout'

// Storage unavailable: taken as seen, so the pointers never come back on every start.
const readSeen = () => { try { return localStorage.getItem(NEW_FEATURES_TIP_KEY) !== null } catch { return true } }

/**
 * Once per device, on the Overview: a pointer at «Сборка оружия», then one at «Убежище» (the menu entries on the PC, «Ещё»
 * on the phone). Like the other tips it waits until no other one is open, and it is kept as shown the moment it opens.
 */
export function NewFeaturesTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const [seen] = useState(readSeen)
  const steps: Step[] = featureEnabled('weaponBuilds') ? ['builds', 'hideout'] : ['hideout']
  const first = steps[0]
  const target = (step: Step) => phone ? PHONE_TARGET : navTarget(step === 'builds' ? '/arsenal/builds' : '/hideout')
  const due = !seen && pathname === '/'
  const ready = useGuideReady(due ? 'new-features' : null, pathname, target(first))
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step^="new-features"])'))
    const firstCheck = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(firstCheck); window.clearInterval(timer); setClear(false) }
  }, [ready])
  const [shown, setShown] = useState<Step | 'no' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown(first)
  if (shown !== 'no' && shown !== 'closed' && pathname !== '/') setShown('closed')
  const open = shown !== 'no' && shown !== 'closed'
  useEffect(() => {
    if (!open) return
    try { localStorage.setItem(NEW_FEATURES_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [open])
  if (!open) return null
  const step = shown
  const next = steps[steps.indexOf(step) + 1]
  const tip = { ...(step === 'builds' ? WEAPON_BUILDS_TIP : HIDEOUT_TIP), target: target(step) }
  return <GuideTip key={step} id={`new-features-${step}`} tip={tip} phone={phone} onAccept={() => setShown(next ?? 'closed')} />
}
