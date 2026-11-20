import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { ArrowLeftRight, Lock, Trash2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { canTakeOff, installReplacing, slotCandidates, type SlotCell } from './buildModel'
import { isMuzzleSlot, muzzleKits, type MuzzleKit } from './muzzleKits'
import { useLocale } from '../i18n/LocaleProvider'
import { cheapestOffer, computeStats, unlockHint, type BuildStats, type PurchaseAccess } from './buildStats'
import { formatModifier, formatRub, PartIcon, signedExact, unlockLabel, useQuestNames } from './gunFormat'
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

/**
 * A module that cannot be bought yet: the lock and what opens it, short («Миротворец 3», «барахолка с 25 ур.», a quest), in place of the
 * price; a module nobody sells says so.
 */
function TileLock({ item, access }: { item: Pick<GunPart, 'offers' | 'noFlea' | 'fleaLevel'>; access: PurchaseAccess }) {
  const { locale } = useLocale()
  const questName = useQuestNames()
  const hint = unlockHint(item, access)
  const text = hint ? unlockLabel(hint, locale, questName) : uiText(item.noFlea ? 'запрет барахолки' : 'нет в продаже')
  return <span className="wb-part-lock" title={hint ? `${uiText('Откроется, когда выполнится условие')}: ${text}` : text}><Lock size={9} aria-hidden="true" />{text}</span>
}

/**
 * The order of the modules (owner, 20.11.2026: «наверху… вкладки с выбором. Сбалансировано, низкая отдача, больше эргономика и
 * комплект глушитель плюс дульник»): the three for every slot; a muzzle slot also lists its devices, its suppressors or the kits of a
 * device and a suppressor together (src/arsenal/muzzleKits.ts) with what the kit gives as a whole.
 */
type GridSort = 'balanced' | 'recoil' | 'ergonomics' | 'devices' | 'suppressors' | 'kits'
const SORT_NAMES: Record<GridSort, string> = {
  balanced: 'Сбалансированно',
  recoil: 'Меньше отдача',
  ergonomics: 'Больше эргономика',
  devices: 'Дульные устройства',
  suppressors: 'Глушители',
  kits: 'Дульник + глушитель',
}
const SORT_KEY = 'raidos-wb-grid-sort'
function readSort(): GridSort {
  try { const value = localStorage.getItem(SORT_KEY); return value === 'recoil' || value === 'ergonomics' ? value : 'balanced' } catch { return 'balanced' }
}
const isSuppressor = (part: GunPart) => part.category === 'silencer' || part.suppressor === true

/** The best change first, as the side list's «Сбалансированно»: vertical recoil removed and ergonomics gained, in half points. */
function order(sort: GridSort, a: BuildStats | undefined, b: BuildStats | undefined, now: BuildStats) {
  if (!a || !b) return Number(!a) - Number(!b)
  if (sort === 'recoil') return a.recoilVerticalExact - b.recoilVerticalExact || b.ergonomicsRaw - a.ergonomicsRaw
  if (sort === 'ergonomics') return b.ergonomicsRaw - a.ergonomicsRaw || a.recoilVerticalExact - b.recoilVerticalExact
  return balance(b, now) - balance(a, now)
}

function balance(after: BuildStats | undefined, now: BuildStats) {
  if (!after) return Number.NEGATIVE_INFINITY
  const recoil = now.recoilVerticalExact > 0 ? (now.recoilVerticalExact - after.recoilVerticalExact) / now.recoilVerticalExact * 100 : 0
  return Math.round((recoil * RECOIL_WEIGHT + (after.ergonomicsRaw - now.ergonomicsRaw) * ERGO_WEIGHT) * 2) / 2
}

/**
 * Where the window goes. With `avoid` (the part being changed and its cell): to the left or the right of it, else below or above it,
 * whichever shows the window most and never over it. Without: under its cell when there is room below, else above. Inside the screen.
 */
function usePlace(anchor: () => Element | null, width: number, avoid?: () => DOMRect | null) {
  const [place, setPlace] = useState<CSSProperties>({ visibility: 'hidden' })
  useLayoutEffect(() => {
    let frame = 0
    // at once when the window opens (no frame where it stands nowhere), then on the next frame after a scroll or a resize
    const place = () => {
        const keep = avoid?.()
        if (keep) { setPlace(beside(keep, width)); return }
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
    }
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place) }
    place()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [anchor, avoid, width])
  return place
}

/** The window beside a box it must not cover: left or right first, then below or above; the side that shows it most. */
function beside(box: DOMRect, width: number): CSSProperties {
  const margin = 8
  const screen = { width: window.innerWidth, height: window.innerHeight }
  const tallest = Math.min(screen.height - 2 * margin, screen.height * (screen.width < 520 ? 0.46 : 0.7))
  const options: Array<{ style: CSSProperties; room: number; side: boolean }> = []
  // left or right of it, as high as it, inside the screen
  const top = Math.max(margin, Math.min(screen.height - margin - tallest, box.top + box.height / 2 - tallest / 2))
  const right = screen.width - box.right - 2 * margin
  const leftRoom = box.left - 2 * margin
  if (right >= Math.min(width, 260)) options.push({ side: true, room: Math.min(right, width) * tallest, style: { left: box.right + margin, top, maxHeight: tallest, width: Math.min(width, right) } })
  if (leftRoom >= Math.min(width, 260)) options.push({ side: true, room: Math.min(leftRoom, width) * tallest, style: { left: Math.max(margin, box.left - margin - Math.min(width, leftRoom)), top, maxHeight: tallest, width: Math.min(width, leftRoom) } })
  // below or above it, as wide as it can
  const left = Math.max(margin, Math.min(screen.width - width - margin, box.left + box.width / 2 - width / 2))
  const below = Math.min(tallest, screen.height - box.bottom - 2 * margin)
  const above = Math.min(tallest, box.top - 2 * margin)
  if (below >= 120) options.push({ side: false, room: width * below, style: { left, top: box.bottom + margin, maxHeight: below, width } })
  if (above >= 120) options.push({ side: false, room: width * above, style: { left, bottom: screen.height - box.top + margin, maxHeight: above, width } })
  // a side first when it shows enough of the window (owner: «левее или правее»), else what shows the most
  const roomiest = (list: typeof options) => list.reduce<(typeof options)[number] | undefined>((best, option) => !best || option.room > best.room ? option : best, undefined)
  const best = roomiest(options.filter((option) => option.side && option.room >= 0.6 * width * tallest)) ?? roomiest(options)
  return best?.style ?? { left: margin, top: margin, maxHeight: tallest, width: Math.min(width, screen.width - 2 * margin) }
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

function GridWindow({ anchor, avoid, title, count, onClose, children, tools }: { anchor: () => Element | null; avoid?: () => DOMRect | null; title: string; count: number; onClose: () => void; children: ReactNode; tools?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null)
  const narrow = typeof window !== 'undefined' && window.innerWidth < 520
  const tile = narrow ? 70 : 82
  const columns = Math.max(3, Math.min(narrow ? 4 : 6, count))
  // the tiles, the window's padding and its scroll bar
  const width = Math.min((typeof window === 'undefined' ? 800 : window.innerWidth) - 16, columns * (tile + 4) + 24)
  const place = usePlace(anchor, width, avoid)
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

export function ModGrid({ cell, build, weapon, catalog, ammo, stats, access, everything, anchor, avoid, onPick, onPickKit, onRemove, onClose }: {
  cell: SlotCell; build: Build; weapon: Weapon; catalog: GunCatalog; ammo?: AmmoStats; stats: BuildStats; access: PurchaseAccess
  /** «Показать все модули»: none greyed, the best change first whatever it costs. */
  everything?: boolean
  anchor: () => Element | null; avoid?: () => DOMRect | null; onPick: (itemId: string) => void; onPickKit?: (kit: MuzzleKit) => void; onRemove: () => void; onClose: () => void
}) {
  const muzzle = isMuzzleSlot(cell.slot) && Boolean(onPickKit)
  const [sort, setSortState] = useState<GridSort>(readSort)
  const setSort = (next: GridSort) => {
    setSortState(next)
    if (next === 'balanced' || next === 'recoil' || next === 'ergonomics') try { localStorage.setItem(SORT_KEY, next) } catch { /* a convenience */ }
  }
  const rows = useMemo(() => slotCandidates(cell.slot, catalog)
    .filter((part) => sort === 'devices' ? !isSuppressor(part) : sort === 'suppressors' ? isSuppressor(part) : true)
    .map((part) => {
      // what fits, and what fits once a conflicting part comes off (it says what it takes off)
      const done = installReplacing(build, cell.path, cell.slot, part.id, catalog, weapon)
      const offer = cheapestOffer(part, access)
      const after = done ? computeStats(done.build, weapon, catalog, ammo) : undefined
      return { part, done, offer, after, replaces: done?.removed.map((item) => item.shortName || item.name) ?? [] }
    })
    .filter((row) => row.done)
    // what can be bought first, in the chosen order; the rest after, greyed
    .sort((a, b) => (everything ? 0 : Number(!a.offer) - Number(!b.offer)) || order(sort, a.after, b.after, stats) || (a.offer?.priceRUB ?? Infinity) - (b.offer?.priceRUB ?? Infinity)),
  [access, ammo, build, catalog, cell.path, cell.slot, everything, sort, stats, weapon])
  const kits = useMemo(() => !muzzle || sort !== 'kits' ? [] : muzzleKits(build, cell.path, cell.slot, catalog, weapon)
    .map((kit) => {
      const offers = [cheapestOffer(kit.device, access), cheapestOffer(kit.suppressor, access)]
      const price = offers.every(Boolean) ? offers.reduce((total, offer) => total + offer!.priceRUB, 0) : undefined
      return { kit, price, after: computeStats(kit.build, weapon, catalog, ammo) }
    })
    .sort((a, b) => (everything ? 0 : Number(a.price === undefined) - Number(b.price === undefined)) || balance(b.after, stats) - balance(a.after, stats) || (a.price ?? Infinity) - (b.price ?? Infinity)),
  [access, ammo, build, catalog, cell.path, cell.slot, everything, muzzle, sort, stats, weapon])
  const sorts: GridSort[] = muzzle ? ['balanced', 'recoil', 'ergonomics', 'devices', 'suppressors', 'kits'] : ['balanced', 'recoil', 'ergonomics']
  const tools = <select className="wb-grid-sort" value={sorts.includes(sort) ? sort : 'balanced'} onChange={(event) => setSort(event.target.value as GridSort)} aria-label={uiText('Порядок')}>
    {sorts.map((value) => <option key={value} value={value}>{uiText(SORT_NAMES[value])}</option>)}
  </select>
  const removable = canTakeOff(cell)
  if (sort === 'kits' && muzzle) return <GridWindow anchor={anchor} avoid={avoid} title={cell.slot.name} count={Math.max(3, kits.length)} onClose={onClose} tools={tools}>
    {kits.map(({ kit, price }) => {
      // what the device and the suppressor give together
      const ergonomics = kit.device.ergonomics + kit.suppressor.ergonomics
      const recoil = kit.device.recoilModifier + kit.suppressor.recoilModifier
      return <button type="button" key={`${kit.device.id}-${kit.suppressor.id}`} role="option" aria-selected={false} className={`wb-tile is-kit${price !== undefined || everything ? '' : ' is-locked'}`}
        onClick={() => onPickKit?.(kit)} title={[`${kit.device.name} + ${kit.suppressor.name}`, kit.removed.length ? `${uiText('заменит')}: ${kit.removed.map((item) => item.shortName || item.name).join(', ')}` : ''].filter(Boolean).join('\n')}>
        <span className="wb-tile-stats">
          {ergonomics !== 0 ? <span className={ergonomics > 0 ? 'is-good' : 'is-bad'}>{signedExact(ergonomics)}</span> : <span />}
          {recoil !== 0 && <span className={recoil < 0 ? 'is-good' : 'is-bad'}>{formatModifier(recoil).replace(' ', '')}</span>}
        </span>
        <span className="wb-tile-pair"><TilePicture part={kit.device} /><TilePicture part={kit.suppressor} /></span>
        <span className="wb-tile-name">{kit.device.shortName} + {kit.suppressor.shortName}</span>
        <span className="wb-tile-price">{price !== undefined ? formatRub(price) : everything ? '—' : <TileLock item={kit.suppressor} access={access} />}</span>
      </button>
    })}
    {!kits.length && <p className="wb-grid-none">{uiText('Комплектов нет.')}</p>}
  </GridWindow>
  return <GridWindow anchor={anchor} avoid={avoid} title={cell.slot.name} count={rows.length + (removable ? 1 : 0)} onClose={onClose} tools={tools}>
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
        <span className="wb-tile-price">{offer ? formatRub(offer.priceRUB) : everything ? '—' : <TileLock item={part} access={access} />}</span>
      </button>
    })}
    {!rows.length && <p className="wb-grid-none">{uiText('Ничего не подходит.')}</p>}
  </GridWindow>
}

export function AmmoGrid({ options, selected, access, everything, anchor, avoid, onPick, onClose }: {
  options: AmmoStats[]; selected?: string; access: PurchaseAccess; everything?: boolean; anchor: () => Element | null; avoid?: () => DOMRect | null; onPick: (id: string) => void; onClose: () => void
}) {
  return <GridWindow anchor={anchor} avoid={avoid} title={uiText('Патрон')} count={options.length + (selected ? 1 : 0)} onClose={onClose}>
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
        <span className="wb-tile-price">{offer ? formatRub(offer.priceRUB) : everything ? '—' : <TileLock item={round} access={access} />}</span>
      </button>
    })}
    {!options.length && <p className="wb-grid-none">{uiText('Нет данных о патронах этого калибра.')}</p>}
  </GridWindow>
}
