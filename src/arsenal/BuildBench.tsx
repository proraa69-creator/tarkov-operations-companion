/* eslint-disable react-refresh/only-export-components */
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertTriangle, Layers, Maximize2 } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { isMobileLayout } from '../platform'
import { usesDataGateway } from '../data/tarkovApi'
import { hasInstallable, stockSlotTaken } from './buildModel'
import { boardLayout, hiddenTwins, type BoardLayout, type PlacedCell } from './boardLayout'
import type { BuildStats } from './buildStats'
import type { Drawn } from './BuildPicture'
import { BuildStage, type StageSlot } from './BuildStage'
import { PartIcon, signed, signedExact } from './gunFormat'
import type { AmmoStats, Build, GunCatalog, GunPart, Weapon } from './gunTypes'
import { SlotSilhouette } from './SlotSilhouette'
import { slotPicture } from './slotPictures'

/**
 * The bench of «Сборка оружия»: the build drawn from the game's part pictures, small cells around it at their places
 * (src/arsenal/BuildStage.tsx), a slot's modules in a window at its cell (src/arsenal/ModGrid.tsx). The page and the Gunsmith
 * tasks (src/gunsmith/GuideBuildBench.tsx) both use it.
 */

/** The weapon's picture: tarkov.dev's 512 px cut-out in development, our server's inventory picture in the app. */
/** The weapon's own picture (its default build), for a weapon whose parts the app has no pictures of. */
export const weaponPicture = (weapon: Weapon) => pictureUrl(weapon.defaultPreset?.id ?? weapon.id)

export function pictureUrl(id: string) {
  return usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-512.webp`
}

export const pathKey = (path: string[]) => path.join('/')


/**
 * The cells the bench shows: every slot of the parts on the weapon, but not an empty one nothing can go into now (a part in place
 * conflicts with every candidate) nor a second empty one of a kind beside a filled one (boardLayout.hiddenTwins) — that shows while
 * its filled twin (or itself) is the chosen cell. A required slot always shows.
 */
export function shownLayout(build: Build, weapon: Weapon, catalog: Pick<GunCatalog, 'mods'>, selected: string | null): BoardLayout {
  const full = boardLayout(build, weapon, catalog)
  const twins = hiddenTwins(full.cells, pathKey)
  const twinShown = (key: string) => { const twin = twins.get(key); return !twin || selected === twin || selected === key }
  return { ...full, cells: full.cells.filter((cell) => (cell.part || (cell.slot.required && !stockSlotTaken(build, cell.path, catalog)) || hasInstallable(build, cell.path, cell.slot, catalog, weapon)) && twinShown(pathKey(cell.path))) }
}

/**
 * The bench: the build drawn from the game's part pictures with small cells around it at their places (src/arsenal/BuildStage.tsx);
 * the board of cells (Board) while a part of the build has no picture yet.
 */
export function BuildBench({ layout, weapon, stats, ammo, noAmmo, selected, onSelect, drawn, size, maxHeight, onExpand, popover }: {
  layout: BoardLayout; weapon: Weapon; stats: BuildStats; ammo?: AmmoStats; selected: string | null; onSelect: (key: string | null) => void
  /** No cell for the round (a Gunsmith task's build). */
  noAmmo?: boolean
  drawn: Drawn | null; size: 'normal' | 'full'; maxHeight?: number; onExpand?: () => void
  /**
   * The chosen cell's modules in a window at the cell (`anchor` finds the cell's button); `avoid`: where the part being changed is on
   * the screen with what is on it, and its cell — the window never covers them.
   */
  popover?: (anchor: () => Element | null, avoid: () => DOMRect | null) => ReactNode
}) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null)
  const anchor = useCallback(() => (selected && root ? root.querySelector(`[data-cell="${CSS.escape(selected)}"]`) : null), [root, selected])
  // owner, 20.11.2026: «окно… не должно перекрывать модуль, который будет меняться, чтобы я визуально видел, что поменялось»
  const avoid = useCallback(() => {
    const cell = anchor()?.getBoundingClientRect()
    if (!cell || !root || !selected) return cell ?? null
    let [left, top, right, bottom] = [cell.left, cell.top, cell.right, cell.bottom]
    const canvas = root.querySelector('.build-stage-picture')
    const laid = drawn?.laid
    if (canvas && laid) {
      const picture = canvas.getBoundingClientRect()
      const scale = picture.width / Math.max(1, laid.width)
      const own = Object.entries(laid.boxes).filter(([path]) => path === selected || path.startsWith(`${selected}/`)).map(([, box]) => box)
      // an empty slot: the point it is at
      const point = laid.anchors[selected]
      if (!own.length && point) own.push([point[0] - 30, point[1] - 30, point[0] + 30, point[1] + 30])
      for (const [l, t, r, b] of own) {
        left = Math.min(left, picture.left + l * scale); top = Math.min(top, picture.top + t * scale)
        right = Math.max(right, picture.left + r * scale); bottom = Math.max(bottom, picture.top + b * scale)
      }
    }
    return new DOMRect(left, top, right - left, bottom - top)
  }, [anchor, drawn, root, selected])
  // A phone keeps the whole build on one screen, on its side too: the stage no taller than the window
  const windowHeight = useWindowHeight()
  const phone = isMobileLayout()
  const stageHeight = maxHeight ?? (phone ? Math.max(240, windowHeight - 130) : undefined)
  const slots = useMemo<StageSlot[]>(() => [
    ...layout.cells.map((cell) => ({ key: pathKey(cell.path), kind: cell.kind, zone: cell.zone, depth: cell.depth, path: cell.path, filled: Boolean(cell.part) })),
    ...(noAmmo ? [] : [{ key: 'ammo', kind: 'ammo' as const, zone: 'bottom' as const, depth: 1, filled: Boolean(ammo) }]),
  ], [layout, ammo, noAmmo])
  // «Открыть на весь экран» in the bench's corner (owner, 20.11.2026: «вот эта сборка будет открываться на весь экран»)
  const expand = onExpand && <button type="button" className="wb-stage-expand" onClick={onExpand} title={uiText('Открыть на весь экран')} aria-label={uiText('Открыть на весь экран')}><Maximize2 size={14} /><span>{uiText('На весь экран')}</span></button>
  const toggle = (key: string) => onSelect(selected === key ? null : key)
  const selectedPath = selected && selected !== 'ammo' ? selected.split('/') : undefined
  const linked = (path: string[]) => Boolean(selectedPath && path.length > selectedPath.length && selectedPath.every((id, index) => path[index] === id))
  const cells = new Map(layout.cells.map((cell) => [pathKey(cell.path), cell]))
  return <div className={`wb-stage-scroll is-${size}`} ref={setRoot}>
    {expand}
    <div className="wb-stage-label">
      <strong>{weapon.shortName}</strong>
      <span>{stats.weightLoaded.toFixed(2)} {uiText('кг')}</span>
    </div>
    <BuildStage drawn={drawn} flat={drawn ? undefined : weaponPicture(weapon)} slots={slots} size={size === 'full' ? (phone ? 'phoneFull' : 'full') : phone ? 'phone' : 'normal'} selected={selected} maxHeight={stageHeight}
      renderCell={(key, style) => {
        if (key === 'ammo') return <AmmoCellButton ammo={ammo} active={selected === 'ammo'} style={style} onClick={() => toggle('ammo')} />
        const cell = cells.get(key)
        return cell ? <SlotCellButton cell={cell} active={selected === key} linked={linked(cell.path)} style={style} onClick={() => toggle(key)} /> : null
      }} />
    {selected && popover?.(anchor, avoid)}
  </div>
}

export function useWindowHeight() {
  const [height, setHeight] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight))
  useEffect(() => {
    const measure = () => setHeight(window.innerHeight)
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  return height
}

/**
 * A part over the whole cell: its picture without background (owner, 17.10.2026: «без синего фона и без внутренней рамки»),
 * else the inventory picture, else the small icon — whichever loads first.
 */
/** The background-free picture next to an icon: tarkov.dev «-base-image», our server's «-base». */
export function baseImageOf(iconLink?: string) {
  if (!iconLink) return undefined
  return iconLink.includes('assets.tarkov.dev') ? iconLink.replace(/-icon\.webp$/, '-base-image.webp') : iconLink.replace(/-icon\.webp$/, '-base.webp')
}

export function CellPicture({ part }: { part: Pick<GunPart, 'iconLink' | 'baseImageLink' | 'gridImageLink'> }) {
  const sources = [part.baseImageLink, part.gridImageLink, part.iconLink].filter((src): src is string => Boolean(src))
  const [attempt, setAttempt] = useState(0)
  if (attempt >= sources.length) return <PartIcon />
  return <img className="gb-icon wb-cell-picture" src={sources[attempt]} alt="" loading="lazy" draggable={false} onError={() => setAttempt((value) => value + 1)} />
}

export function AmmoCellButton({ ammo, active, style, onClick }: { ammo?: AmmoStats; active: boolean; style?: CSSProperties; onClick: () => void }) {
  return <button className={`wb-cell is-ammo${active ? ' is-selected' : ''}${ammo ? ' is-filled' : ''}`} data-cell="ammo" style={style} onClick={onClick} aria-pressed={active} title={ammo ? ammo.name : uiText('Патрон')}>
    {!ammo && <span className="wb-cell-slot">{uiText('Патрон')}</span>}
    {ammo ? <><CellPicture part={{ iconLink: ammo.iconLink, baseImageLink: baseImageOf(ammo.iconLink) }} /><span className="wb-cell-name">{ammo.shortName}</span><span className="wb-cell-ammo">{ammo.penetration} / {ammo.damage}</span></> : <SlotSilhouette kind="ammo" />}
  </button>
}

export function SlotCellButton({ cell, active, linked, style, onClick }: { cell: PlacedCell; active: boolean; linked: boolean; style?: CSSProperties; onClick: () => void }) {
  const { part, slot } = cell
  const missing = slot.required && !part
  return <button className={`wb-cell${active ? ' is-selected' : ''}${linked ? ' is-linked' : ''}${part ? ' is-filled' : ''}${missing ? ' is-missing' : ''}`} data-cell={pathKey(cell.path)} style={style} onClick={onClick} aria-pressed={active}
    title={part ? `${slot.name}: ${part.name}` : `${slot.name}: ${uiText(missing ? 'обязательная, пусто' : 'пусто')}`}>
    {!part && !slotPicture(slot.nameId, cell.kind) && <span className="wb-cell-slot">{slot.name}</span>}
    {part ? <>
      {part.ergonomics !== 0 && <span className={`wb-cell-ergo ${part.ergonomics > 0 ? 'is-good' : 'is-bad'}`}>{signedExact(part.ergonomics)}</span>}
      {part.recoilModifier !== 0 && <span className={`wb-cell-recoil ${part.recoilModifier < 0 ? 'is-good' : 'is-bad'}`}>{signed(part.recoilModifier * 100, Math.abs(part.recoilModifier * 100) % 1 ? 1 : 0)}</span>}
      <CellPicture part={part} />
      <span className="wb-cell-name">{part.shortName}</span>
      {part.slots.length > 0 && <span className="wb-cell-badge" title={uiText('Свои ячейки')}><Layers size={8} />{part.slots.length}</span>}
    </> : <>
      <SlotSilhouette kind={cell.kind} nameId={slot.nameId} />
      {missing && <AlertTriangle size={11} className="wb-cell-required" aria-label={uiText('Обязательно')} />}
    </>}
  </button>
}
