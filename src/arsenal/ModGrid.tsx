import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Lock, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { installReplacing, slotCandidates, STOCK_SLOT, type SlotCell } from './buildModel'
import { cheapestOffer, computeStats, type BuildStats, type PurchaseAccess } from './buildStats'
import { formatModifier, formatRub, PartIcon, signedExact } from './gunFormat'
import type { AmmoStats, Build, GunCatalog, GunPart, Weapon } from './gunTypes'
import { ERGO_WEIGHT, RECOIL_WEIGHT } from './tieredBuilds'

/**
 * The modules of a slot in a small window right at its cell, like the game's (owner, 20.11.2026: «как в Таркове открывалось окно…
 * прям возле ячейки… поиска не будет… квадратики с предметами… название и основные характеристики — эргономика и отдача… цену»):
 * a square per module with its picture, part of its name, ergonomics, recoil and price; the one on the weapon framed, the ones that
 * cannot be bought yet greyed at the end. A tap puts the module on, taking off what it does not go with.
 */

/** The background-free picture next to an icon: tarkov.dev «-base-image», our server's «-base». */
function baseImageOf(iconLink?: string) {
  if (!iconLink) return undefined
  return iconLink.includes('assets.tarkov.dev') ? iconLink.replace(/-icon\.webp$/, '-base-image.webp') : iconLink.replace(/-icon\.webp$/, '-base.webp')
}

function TilePicture({ part }: { part: Pick<GunPart, 'iconLink' | 'baseImageLink' | 'gridImageLink'> }) {
  const sources = [part.baseImageLink ?? baseImageOf(part.iconLink), part.gridImageLink, part.iconLink].filter((src): src is string => Boolean(src))
  const [attempt, setAttempt] = useState(0)
  if (attempt >= sources.length) return <PartIcon />
  return <img className="wb-tile-picture" src={sources[attempt]} alt="" loading="lazy" draggable={false} onError={() => setAttempt((value) => value + 1)} />
}

/** The best change first, as the side list's «Сбалансированно»: vertical recoil removed and ergonomics gained, in half points. */
function balance(after: BuildStats | undefined, now: BuildStats) {
  if (!after) return Number.NEGATIVE_INFINITY
  const recoil = now.recoilVerticalExact > 0 ? (now.recoilVerticalExact - after.recoilVerticalExact) / now.recoilVerticalExact * 100 : 0
  return Math.round((recoil * RECOIL_WEIGHT + (after.ergonomicsRaw - now.ergonomicsRaw) * ERGO_WEIGHT) * 2) / 2
}

/** Where the window goes: under its cell when there is room below, else above; inside the screen. */
function usePlace(anchor: () => Element | null, width: number) {
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    let frame = 0
    const measure = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const cell = anchor()
        if (!cell) return
        const rect = cell.getBoundingClientRect()
        // no taller than about half the screen: the weapon stays in sight, the list scrolls
        const tallest = window.innerHeight * (window.innerWidth < 520 ? 0.46 : 0.6)
        const room = { below: Math.min(tallest, window.innerHeight - rect.bottom - 10), above: Math.min(tallest, rect.top - 10) }
        const down = room.below >= Math.min(300, room.above)
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))
        setPlace(down
          ? { left, top: rect.bottom + 6, maxHeight: Math.max(160, room.below - 6), width }
          : { left, bottom: window.innerHeight - rect.top + 6, maxHeight: Math.max(160, room.above - 6), width })
      })
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [anchor, width])
  return place
}

/** Closes on Esc and on a press outside the window and outside the cells (a press on another cell chooses that cell). */
function useDismiss(box: RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])
  useEffect(() => {
    const press = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target || box.current?.contains(target) || target.closest('[data-cell]')) return
      close.current()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close.current() } }
    document.addEventListener('pointerdown', press, true)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', press, true); window.removeEventListener('keydown', key) }
  }, [box])
}

function GridWindow({ anchor, title, count, onClose, children, tools }: { anchor: () => Element | null; title: string; count: number; onClose: () => void; children: ReactNode; tools?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 520
  const tile = narrow ? 70 : 82
  const columns = Math.max(3, Math.min(narrow ? 4 : 6, count))
  // the tiles, the window's padding and its scroll bar
  const width = Math.min((typeof window === 'undefined' ? 800 : window.innerWidth) - 16, columns * (tile + 4) + 24)
  const place = usePlace(anchor, width)
  useDismiss(box, onClose)
  return createPortal(<div className="wb-grid-window" ref={box} role="dialog" aria-label={title} style={{ ...place, '--wb-tile': `${tile}px` } as CSSProperties}>
    <div className="wb-grid-head">
      <strong>{title}</strong>
      {tools}
      <button type="button" className="wb-grid-close" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={14} /></button>
    </div>
    <div className="wb-grid" role="listbox" aria-label={title}>{children}</div>
  </div>, document.body)
}

export function ModGrid({ cell, build, weapon, catalog, ammo, stats, access, everything, anchor, onPick, onRemove, onClose }: {
  cell: SlotCell; build: Build; weapon: Weapon; catalog: GunCatalog; ammo?: AmmoStats; stats: BuildStats; access: PurchaseAccess
  /** «Показать все модули»: none greyed, the best change first whatever it costs. */
  everything?: boolean
  anchor: () => Element | null; onPick: (itemId: string) => void; onRemove: () => void; onClose: () => void
}) {
  const rows = useMemo(() => slotCandidates(cell.slot, catalog)
    .map((part) => {
      // what fits, and what fits once a conflicting part comes off (it says what it takes off)
      const done = installReplacing(build, cell.path, cell.slot, part.id, catalog, weapon)
      const offer = cheapestOffer(part, access)
      const after = done ? computeStats(done.build, weapon, catalog, ammo) : undefined
      return { part, done, offer, after, replaces: done?.removed.map((item) => item.shortName || item.name) ?? [] }
    })
    .filter((row) => row.done)
    // what can be bought first, the best change first; the rest after, greyed
    .sort((a, b) => (everything ? 0 : Number(!a.offer) - Number(!b.offer)) || balance(b.after, stats) - balance(a.after, stats) || (a.offer?.priceRUB ?? Infinity) - (b.offer?.priceRUB ?? Infinity)),
  [access, ammo, build, catalog, cell.path, cell.slot, everything, stats, weapon])
  const removable = Boolean(cell.part) && (!cell.slot.required || cell.slot.nameId === STOCK_SLOT)
  return <GridWindow anchor={anchor} title={cell.slot.name} count={rows.length + (removable ? 1 : 0)} onClose={onClose}>
    {removable && <button type="button" className="wb-tile is-remove" onClick={onRemove} title={uiText('Снять')}>
      <Trash2 size={18} />
      <span className="wb-tile-name">{uiText('Снять')}</span>
    </button>}
    {rows.map(({ part, offer, replaces }) => {
      const current = part.id === cell.part?.id
      const recoil = part.recoilModifier
      return <button type="button" key={part.id} role="option" aria-selected={current} className={`wb-tile${current ? ' is-current' : ''}${offer || everything ? '' : ' is-locked'}`}
        onClick={() => onPick(part.id)} title={[part.name, replaces.length ? `${uiText('заменит')}: ${replaces.join(', ')}` : ''].filter(Boolean).join('\n')}>
        <span className="wb-tile-stats">
          {part.ergonomics !== 0 ? <span className={part.ergonomics > 0 ? 'is-good' : 'is-bad'}>{signedExact(part.ergonomics)}</span> : <span />}
          {recoil !== 0 && <span className={recoil < 0 ? 'is-good' : 'is-bad'}>{formatModifier(recoil).replace(' ', '')}</span>}
        </span>
        <TilePicture part={part} />
        {replaces.length > 0 && <ArrowLeftRight size={10} className="wb-tile-swap" aria-label={uiText('заменит')} />}
        <span className="wb-tile-name">{part.shortName || part.name}</span>
        <span className="wb-tile-price">{offer ? formatRub(offer.priceRUB) : everything ? '—' : <Lock size={10} aria-label={uiText('нет в продаже')} />}</span>
      </button>
    })}
    {!rows.length && <p className="wb-grid-none">{uiText('Ничего не подходит.')}</p>}
  </GridWindow>
}

export function AmmoGrid({ options, selected, access, everything, anchor, onPick, onClose }: {
  options: AmmoStats[]; selected?: string; access: PurchaseAccess; everything?: boolean; anchor: () => Element | null; onPick: (id: string) => void; onClose: () => void
}) {
  return <GridWindow anchor={anchor} title={uiText('Патрон')} count={options.length + (selected ? 1 : 0)} onClose={onClose}>
    {selected && <button type="button" className="wb-tile is-remove" onClick={() => onPick('')} title={uiText('Убрать патрон')}>
      <Trash2 size={18} />
      <span className="wb-tile-name">{uiText('Убрать')}</span>
    </button>}
    {options.map((round) => {
      const offer = cheapestOffer(round, access)
      const current = round.id === selected
      return <button type="button" key={round.id} role="option" aria-selected={current} className={`wb-tile${current ? ' is-current' : ''}${offer || everything ? '' : ' is-locked'}`}
        onClick={() => onPick(round.id)} title={`${round.name}\n${uiText('Проб.')} ${round.penetration} · ${uiText('Урон')} ${round.damage}`}>
        <span className="wb-tile-stats"><span>{round.penetration}</span><span>{round.projectileCount > 1 ? `${round.damage}×${round.projectileCount}` : round.damage}</span></span>
        <TilePicture part={{ iconLink: round.iconLink }} />
        <span className="wb-tile-name">{round.shortName}</span>
        <span className="wb-tile-price">{offer ? formatRub(offer.priceRUB) : <Lock size={10} aria-label={uiText('нет в продаже')} />}</span>
      </button>
    })}
    {!options.length && <p className="wb-grid-none">{uiText('Нет данных о патронах этого калибра.')}</p>}
  </GridWindow>
}
