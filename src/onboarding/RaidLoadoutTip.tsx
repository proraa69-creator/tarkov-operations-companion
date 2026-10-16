import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useMobileLayout } from '../platform'
import { uiText } from '../i18n/renderText'
import { useOptionalTarkovData } from '../data/DataProvider'
import { gearObjectives } from '../overview/questConditions'
import { GearStrip } from '../overview/QuestConditionsCard'
import { usePictures } from '../overview/usePictures'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'
import '../styles/questConditions.css'

/** Accepted on this device under this key: the tip never shows here again. */
export const RAID_LOADOUT_TIP_KEY = 'raidos-raid-loadout-tip-v1'
/** «Легкотня» (Easy Breezy, Prapor): the example of the tip, an SR-2M with its parts. */
export const EXAMPLE_QUEST_ID = '669fa3a40c828825de06d6a1'

const TARGET = '.quest-conditions-card'
// owner, 15.10.2026: «сделай уведомление… всплывающее окно с указателями на новую функцию… покажи там квест легкотня…
// мы это сделали для того, чтобы людям не нужно было каждый раз перед рейдом искать, какое ему оружие выбрать»
const TIP: GuideTipContent = {
  title: { ru: 'Новое: «Сбор на рейд»', en: 'New: Raid loadout' },
  text: () => ({
    ru: 'Больше не нужно перед каждым рейдом искать, с каким оружием выполнять квест. Откройте этот блок и выберите квест — увидите, с каким оружием его выполнять и что взять с собой. Например:',
    en: 'No more looking up before every raid which weapon a quest needs. Open this block and pick a quest: you see which weapon to do it with and what to take. For example:',
  }),
  target: TARGET,
}

// Storage unavailable: taken as seen, so the tip never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(RAID_LOADOUT_TIP_KEY) !== null } catch { return true } }

/**
 * Once per device, for every account (a new function, not a first-run tip): on the Overview, once the catalog is loaded
 * and «Сбор на рейд» is drawn, a tip pointing at it with «Легкотня» as the example. It waits for the other tips: never two
 * at once.
 */
export function RaidLoadoutTip() {
  const { pathname } = useLocation()
  const phone = useMobileLayout()
  const catalog = useOptionalTarkovData()
  const [seen] = useState(readSeen)
  const loading = catalog?.initialLoading ?? true
  const due = !seen && pathname === '/' && !loading
  const ready = useGuideReady(due ? 'raid-loadout' : null, pathname, TARGET)
  // Another tip (the quest sync one) opened at the same moment goes first; this one follows once it is closed.
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step="raid-loadout"])'))
    const first = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(first); window.clearInterval(timer); setClear(false) }
  }, [ready])
  // Kept as shown the moment it opens: a restart or an update before «Принял» does not bring it back.
  const [shown, setShown] = useState<'no' | 'open' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown('open')
  // Another page: put away for this start too.
  if (shown === 'open' && pathname !== '/') setShown('closed')
  useEffect(() => {
    if (shown !== 'open') return
    try { localStorage.setItem(RAID_LOADOUT_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [shown])
  if (shown !== 'open') return null
  return <GuideTip id="raid-loadout" tip={TIP} phone={phone} onAccept={() => setShown('closed')}><ExampleQuest /></GuideTip>
}

/** «Легкотня» as the block shows it: the name, the trader, the weapon and its parts. Nothing when the catalog lacks it. */
function ExampleQuest() {
  const data = useOptionalTarkovData()?.data
  const quest = useMemo(() => data?.quests.find((entry) => entry.id === EXAMPLE_QUEST_ID), [data])
  const pictures = usePictures(data?.items ?? NO_ITEMS)
  const objective = quest ? gearObjectives(quest)[0] : undefined
  if (!quest || !objective?.conditions) return null
  const weapon = objective.conditions.weapons?.[0]
  return <div className="frg-loadout" aria-label={uiText(quest.name)}>
    <div className="frg-loadout-head">
      <strong>{uiText(quest.name)}</strong>
      <small>{uiText(quest.trader)}</small>
    </div>
    <GearStrip conditions={objective.conditions} pictures={pictures} />
    {weapon && <p className="frg-loadout-weapon"><ChevronRight size={12} aria-hidden="true" />{uiText(pictures.items.get(weapon.id)?.name ?? weapon.name)}</p>}
  </div>
}

const NO_ITEMS: never[] = []
