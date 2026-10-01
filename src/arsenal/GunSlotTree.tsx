import { useMemo, useState } from 'react'
import { AlertTriangle, Ban, ChevronDown, ChevronRight, Search, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { canInstall, nodeAt, slotCandidates } from './buildModel'
import { cheapestOffer, type PurchaseAccess } from './buildStats'
import type { Build, GunCatalog, GunPart, GunSlot } from './gunTypes'
import { formatModifier, formatRub, PartIcon, signed } from './gunFormat'

interface TreeProps {
  build: Build
  catalog: GunCatalog
  access: PurchaseAccess
  onInstall: (path: string[], itemId: string) => void
  onRemove: (path: string[]) => void
}

/** The weapon's slots, and inside every installed part its own slots, as an indented tree. */
export function GunSlotTree(props: TreeProps & { part: GunPart; path?: string[]; depth?: number }) {
  const { part, path = [], depth = 0 } = props
  if (!part.slots.length) return null
  return <ul className={`gb-tree depth-${Math.min(depth, 4)}`}>
    {part.slots.map((slot) => <SlotRow key={slot.nameId} {...props} slot={slot} path={[...path, slot.nameId]} depth={depth} />)}
  </ul>
}

function SlotRow({ slot, path, depth, ...props }: TreeProps & { slot: GunSlot; path: string[]; depth: number }) {
  const { build, catalog, access, onInstall, onRemove } = props
  const [open, setOpen] = useState(false)
  const node = nodeAt(build, path)
  const installed = node ? catalog.mods.get(node.itemId) : undefined
  const offer = installed ? cheapestOffer(installed, access) : undefined
  const missing = slot.required && !installed
  return <li className={`gb-slot${missing ? ' is-missing' : ''}${installed ? ' is-filled' : ''}`}>
    <div className="gb-slot-row">
      <div className="gb-slot-name">
        <span>{slot.name}</span>
        {slot.required && <span className={`tag ${missing ? 'danger' : 'brass'}`} title={uiText('Без этого модуля оружие не стреляет')}>{uiText('обязательный')}</span>}
      </div>
      <button className="gb-slot-item" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={`${slot.name}: ${installed?.name ?? uiText('пусто')}`}>
        {installed ? <>
          <PartIcon src={installed.iconLink} />
          <span className="gb-part-text"><strong>{installed.name}</strong><small><StatChips part={installed} />{offer ? <span className="dim">{formatRub(offer.priceRUB)}</span> : <span className="gb-warn">{uiText('не купить')}</span>}</small></span>
        </> : <span className="gb-empty">{missing && <AlertTriangle size={13} />}{uiText(missing ? 'Не установлен' : 'Пусто')} · {uiText('вариантов')}: {slotCandidates(slot, catalog).length}</span>}
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {installed && <button className="icon-button gb-remove" onClick={() => onRemove(path)} title={uiText('Снять модуль')} aria-label={uiText('Снять модуль')}><X size={14} /></button>}
    </div>
    {open && <CandidateList slot={slot} path={path} {...props} currentId={installed?.id} onPick={(itemId) => { onInstall(path, itemId); setOpen(false) }} />}
    {installed && node && <GunSlotTree {...props} part={installed} path={path} depth={depth + 1} />}
  </li>
}

function CandidateList({ slot, path, build, catalog, access, currentId, onPick }: TreeProps & { slot: GunSlot; path: string[]; currentId?: string; onPick: (itemId: string) => void }) {
  const [query, setQuery] = useState('')
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return slotCandidates(slot, catalog)
      .filter((part) => !needle || `${part.name} ${part.shortName}`.toLowerCase().includes(needle))
      .map((part) => ({ part, check: canInstall(build, path, slot, part.id, catalog), offer: cheapestOffer(part, access) }))
      .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || (a.part.recoilModifier - b.part.recoilModifier) || (b.part.ergonomics - a.part.ergonomics))
  }, [access, build, catalog, path, query, slot])
  return <div className="gb-candidates">
    {slot.allowed.length > 8 && <label className="gb-search small"><Search size={13} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти модуль…')} autoFocus /></label>}
    <div className="gb-candidate-list" role="listbox" aria-label={slot.name}>
      {rows.slice(0, 120).map(({ part, check, offer }) => {
        const conflict = !check.ok && check.reason === 'conflict' ? catalog.mods.get(check.conflictWith ?? '') : undefined
        return <button key={part.id} role="option" aria-selected={part.id === currentId} disabled={!check.ok} className={`gb-candidate${part.id === currentId ? ' is-current' : ''}`} onClick={() => onPick(part.id)}
          title={conflict ? `${uiText('Конфликтует с')}: ${conflict.name}` : part.name}>
          <PartIcon src={part.iconLink} />
          <span className="gb-part-text"><strong>{part.name}</strong>
            <small>{conflict ? <span className="gb-warn"><Ban size={11} /> {uiText('Конфликт')}: {conflict.shortName}</span> : <StatChips part={part} />}</small>
          </span>
          <span className="gb-candidate-price">{offer ? <><strong>{formatRub(offer.priceRUB)}</strong><small>{offer.vendor === 'flea-market' ? uiText('Барахолка') : `${offer.vendorName} LL${offer.minTraderLevel ?? 1}`}</small></> : <small className="gb-warn">{uiText(part.noFlea ? 'запрет барахолки' : 'нет в продаже')}</small>}</span>
        </button>
      })}
      {!rows.length && <p className="muted gb-none">{uiText('Подходящих модулей нет в базе.')}</p>}
    </div>
  </div>
}

function StatChips({ part }: { part: GunPart }) {
  return <>
    {part.ergonomics !== 0 && <span className={part.ergonomics > 0 ? 'gb-good' : 'gb-bad'}>{uiText('Эрг')} {signed(part.ergonomics)}</span>}
    {part.recoilModifier !== 0 && <span className={part.recoilModifier < 0 ? 'gb-good' : 'gb-bad'}>{uiText('Отд')} {formatModifier(part.recoilModifier)}</span>}
    {part.accuracyModifier !== 0 && <span className={part.accuracyModifier > 0 ? 'gb-good' : 'gb-bad'}>{uiText('Точн')} {formatModifier(part.accuracyModifier)}</span>}
    {part.capacity ? <span className="dim">{part.capacity} {uiText('патр.')}</span> : null}
  </>
}
