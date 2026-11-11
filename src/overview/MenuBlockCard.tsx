import { ArrowLeftRight, ArrowRight, CircleDollarSign, ClipboardList, Crosshair, FlaskConical, KeyRound, Landmark, ListOrdered, Map as MapIcon, PackageCheck, PackageX, Repeat, Skull, Target, TrendingUp, Users, Warehouse, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { uiText } from '../i18n/renderText'
import { useBlockTitle } from './blockTitle'
import type { MenuBlock } from './menuBlocks'

/** The sidebar's icon of each section (src/app/AppShell.tsx). */
const ICONS: Record<string, LucideIcon> = {
  'nav-quests': Target, 'nav-maps': MapIcon, 'nav-bosses': Skull, 'nav-briefing': ClipboardList, 'nav-keep-items': PackageX,
  'nav-kappa-items': PackageCheck, 'nav-squad': Users, 'nav-flea': CircleDollarSign, 'nav-quest-keys': KeyRound,
  'nav-trading': ArrowLeftRight, 'nav-tier-lists': ListOrdered, 'nav-traders': Landmark, 'nav-hideout': Warehouse,
  'nav-value': TrendingUp, 'nav-barters': Repeat, 'nav-crafts': FlaskConical, 'nav-ballistics': Crosshair,
}

/**
 * A section of the left menu as a card of the Overview's top row (owner, 11.11.2026): its name and icon, a number where the
 * Overview already knows one (`fact`), else one short line, and «Открыть» to its page.
 */
export function MenuBlockCard({ block, fact }: { block: MenuBlock; fact?: { value: number; label: string } }) {
  const title = useBlockTitle(block.label)
  const Icon = ICONS[block.id] ?? ArrowRight
  return (
    <div className="stat-card menu-block-card">
      <div className="stat-label menu-block-label"><Icon size={13} aria-hidden="true" /> {title}</div>
      {fact
        ? <div className="menu-block-fact"><span className="stat-value">{fact.value}</span><span className="dim">{uiText(fact.label)}</span></div>
        : <p className="menu-block-hint dim">{uiText(block.hint)}</p>}
      <Link to={block.to} className="button small menu-block-open">{uiText('Открыть')}<ArrowRight size={14} aria-hidden="true" /></Link>
    </div>
  )
}
