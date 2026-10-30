import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useMobileLayout } from '../platform'
import { GuideTip, useGuideReady, type GuideTipContent } from './FirstRunGuide'

/** Shown on this device under this key: the pointer never shows here again. */
export const UNNEEDED_TIP_KEY = 'raidos-unneeded-items-tip-v1'

/** The menu entry on the PC; on the phone «Убежище и квесты» is in «Ещё». */
const PHONE_TARGET = '.mobile-tabbar .mobile-tab[aria-expanded]'
const PC_TARGET = '.sidebar:not(.mobile-tabbar) a.nav-link[href$="/hideout"]'

// owner, 31.10.2026: «добавь уведомление при запуске, что теперь отображаются предметы из схрона которые больше не требуются
// по квестам и для убежища. для этого нужно сделать синхронизацию в схроне».
export const UNNEEDED_TIP: GuideTipContent = {
  title: { ru: 'Новое: ненужные предметы из схрона', en: 'New: unneeded items in the stash' },
  text: (phone) => ({
    ru: `Теперь видно, какие предметы в схроне больше не требуются ни по квестам, ни для убежища. Чтобы список появился, сделайте синхронизацию схрона: «Убежище и квесты» → откройте схрон в игре и нажмите ${phone ? '«Сканировать на ПК»' : '«Синхронизация по экрану»'}, пролистайте его. Затем — кнопка «Не нужные предметы».${phone ? ' Открыть: «Ещё» → «Убежище и квесты».' : ''}`,
    en: `You can now see which items in the stash neither the quests nor the hideout need any more. For the list, sync the stash: «Hideout & quests» → open the stash in the game, press ${phone ? '«Scan on the PC»' : '«Screen sync»'} and scroll through it. Then — the «Unneeded items» button.${phone ? ' Open: «More» → «Hideout & quests».' : ''}`,
  }),
}

// Storage unavailable: taken as seen, so the pointer never comes back on every start.
const readSeen = () => { try { return localStorage.getItem(UNNEEDED_TIP_KEY) !== null } catch { return true } }

/**
 * Once per device (PC and phone), on the Overview: a pointer at «Убежище и квесты» about «Не нужные предметы»; «Принял»
 * opens the section. Like the other tips it waits until no other one is open, and it is kept as shown the moment it opens.
 */
export function UnneededItemsTip() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const phone = useMobileLayout()
  const [seen] = useState(readSeen)
  const target = phone ? PHONE_TARGET : PC_TARGET
  const due = !seen && pathname === '/'
  const ready = useGuideReady(due ? 'unneeded-items' : null, pathname, target)
  const [clear, setClear] = useState(false)
  useEffect(() => {
    if (!ready) return
    const check = () => setClear(!document.querySelector('.frg-layer:not([data-step^="unneeded-items"])'))
    const firstCheck = window.setTimeout(check, 0)
    const timer = window.setInterval(check, 500)
    return () => { window.clearTimeout(firstCheck); window.clearInterval(timer); setClear(false) }
  }, [ready])
  const [shown, setShown] = useState<'no' | 'open' | 'closed'>('no')
  if (shown === 'no' && due && ready && clear) setShown('open')
  if (shown === 'open' && pathname !== '/') setShown('closed')
  useEffect(() => {
    if (shown !== 'open') return
    try { localStorage.setItem(UNNEEDED_TIP_KEY, new Date().toISOString()) } catch { /* shows again next start */ }
  }, [shown])
  if (shown !== 'open') return null
  return <GuideTip id="unneeded-items" tip={{ ...UNNEEDED_TIP, target }} phone={phone} onAccept={() => { setShown('closed'); if (!phone) navigate('/hideout') }} />
}
