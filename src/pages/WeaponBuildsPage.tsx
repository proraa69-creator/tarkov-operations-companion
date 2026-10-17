import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, ChevronDown, Copy, Eraser, FolderOpen, Layers, Redo2, RefreshCw, RotateCcw, Save, Search, Star, Trash2, Undo2, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { canInstall, emptyBuild, hasInstallable, installPart, missingRequired, presetBuild, removePart, slotCandidates, type SlotCell } from '../arsenal/buildModel'
import { boardLayout, rowSpans, zoneCells, type BoardLayout, type PlacedCell, type Zone } from '../arsenal/boardLayout'
import { SlotSilhouette } from '../arsenal/SlotSilhouette'
import { slotPicture } from '../arsenal/slotPictures'
import { cheapestOffer, computeCost, computeStats, FULL_ACCESS, type BuildStats, type PurchaseAccess } from '../arsenal/buildStats'
import { decodeBuild, deleteSavedBuild, encodeBuild, loadSavedBuilds, saveBuild, toggleSavedFavorite, type SavedBuild } from '../arsenal/buildStorage'
import { caliberColors } from '../arsenal/caliberColors'
import { formatModifier, formatRub, PartIcon, prettyCaliber, signed } from '../arsenal/gunFormat'
import type { AmmoStats, Build, GunCatalog, GunOffer, GunPart, Weapon } from '../arsenal/gunTypes'
import { RECOIL_NOTE } from '../arsenal/buildAdvice'
import { usesDataGateway } from '../data/tarkovApi'
import '../styles/weaponBuilds.css'
import { isMobileLayout } from '../platform'

/**
 * «Сборка оружия» (owner, 17.10.2026): an interactive workbench after db4tarkov's FORGE. The weapon and its slots are
 * cells; a tap on a cell lists every item that fits it in the game, with what it changes, its price and — for items
 * that do not fit — why. An installed item with slots of its own brings its cells onto the board; replacing it with
 * one without them removes them. Stats and price update at once; builds are saved per mode (PvP, PvE and Season apart)
 * and can be starred.
 */

const CLASS_NAMES: Record<string, string> = {
  'assault-rifle': 'Штурмовые винтовки', 'assault-carbine': 'Штурмовые карабины', smg: 'Пистолеты-пулемёты',
  'marksman-rifle': 'Марксманские винтовки', 'sniper-rifle': 'Болтовые винтовки', shotgun: 'Дробовики',
  machinegun: 'Пулемёты', handgun: 'Пистолеты', revolver: 'Револьверы', 'grenade-launcher': 'Гранатомёты',
}
const ACCESS_KEY = 'raid-os-gun-access-v1'
type Grouping = 'caliber' | 'class'
type Sort = 'recoil' | 'ergonomics' | 'price' | 'name'

/** The weapon's picture: tarkov.dev's 512 px cut-out in development, our server's inventory picture in the app. */
function pictureUrl(id: string) {
  return usesDataGateway() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-512.webp`
}

function readAccess(): PurchaseAccess {
  try {
    const value = JSON.parse(localStorage.getItem(ACCESS_KEY) ?? 'null') as PurchaseAccess | null
    return value && typeof value.traderLevel === 'number' ? { traderLevel: value.traderLevel, flea: value.flea !== false } : FULL_ACCESS
  } catch { return FULL_ACCESS }
}

const pathKey = (path: string[]) => path.join('/')

/** The smallest board scale on a phone: cells stay big enough to tap. */
const PHONE_MIN_SCALE = 0.72

export function WeaponBuildsPage() {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const query = useGunCatalog(raidMode, locale)
  const catalog = query.data
  return <div className="page weapon-builds">
    <header className="page-header">
      <div>
        <div className="eyebrow">{uiText('Арсенал · ')}{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</div>
        <h1 className="page-title">{uiText('Сборка оружия')}</h1>
        <p className="page-subtitle">{uiText('Нажмите на ячейку и выберите модуль: подходят только совместимые, новые крепления появляются сами, характеристики и цена считаются сразу.')}</p>
      </div>
    </header>
    {query.isLoading && <div className="empty-state" role="status"><div><RefreshCw className="spin" size={26} /><h2>{uiText('Загружаем оружие и модули')}</h2></div></div>}
    {!catalog && query.isError && <div className="empty-state" role="alert"><div><AlertTriangle size={26} /><h2>{uiText('Источник данных недоступен')}</h2><button className="button" onClick={() => void query.refetch()}><RefreshCw size={14} />{uiText('Повторить')}</button></div></div>}
    {catalog && <Workshop key={raidMode} catalog={catalog} />}
  </div>
}

// ------------------------------------------------------------------------------------------------------------
// Build history: every change can be undone and redone.
// ------------------------------------------------------------------------------------------------------------

interface History { past: Build[]; present: Build; future: Build[] }
type HistoryAction = { type: 'set'; build: Build } | { type: 'reset'; build: Build } | { type: 'undo' } | { type: 'redo' }

function historyReducer(state: History, action: HistoryAction): History {
  if (action.type === 'reset') return { past: [], present: action.build, future: [] }
  if (action.type === 'set') return action.build === state.present ? state : { past: [...state.past, state.present].slice(-60), present: action.build, future: [] }
  if (action.type === 'undo') {
    const previous = state.past[state.past.length - 1]
    return previous ? { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] } : state
  }
  const next = state.future[0]
  return next ? { past: [...state.past, state.present], present: next, future: state.future.slice(1) } : state
}

function Workshop({ catalog }: { catalog: GunCatalog }) {
  const { raidMode } = useAppState()
  const [params, setParams] = useSearchParams()
  const weapons = useMemo(() => [...catalog.weapons].sort((a, b) => a.shortName.localeCompare(b.shortName, 'ru')), [catalog])
  const startWeapon = weapons.find((weapon) => weapon.id === params.get('weapon')) ?? weapons.find((weapon) => weapon.shortName === 'M4A1') ?? weapons[0]
  const [history, dispatch] = useReducer(historyReducer, undefined, () => ({ past: [], present: presetBuild(startWeapon, catalog).build, future: [] }))
  const build = history.present
  const weapon = catalog.weapons.find((entry) => entry.id === build.weaponId) ?? startWeapon
  const [selected, setSelected] = useState<string | null>(null)
  const [access, setAccessState] = useState<PurchaseAccess>(readAccess)
  const setAccess = (next: PurchaseAccess) => {
    setAccessState(next)
    try { localStorage.setItem(ACCESS_KEY, JSON.stringify(next)) } catch { /* per-viewer convenience only */ }
  }
  // Remounted per mode (key below): PvP, PvE and Season lists never mix.
  const [saved, setSaved] = useState<SavedBuild[]>(() => loadSavedBuilds(raidMode))

  const ammoOptions = useMemo(() => catalog.ammo.filter((round) => round.caliber === weapon.caliber).sort((a, b) => b.penetration - a.penetration), [catalog.ammo, weapon.caliber])
  const ammo = ammoOptions.find((round) => round.id === build.ammoId)
  const stats = computeStats(build, weapon, catalog, ammo)
  const stock = useMemo(() => presetBuild(weapon, catalog).build, [catalog, weapon])
  const stockStats = computeStats({ ...stock, ammoId: build.ammoId }, weapon, catalog, ammo)
  const cost = computeCost(build, weapon, catalog, access)
  // Empty slots nothing can go into right now are not drawn (an installed part conflicts with every candidate).
  const fullLayout = boardLayout(build, weapon, catalog)
  const layout = { ...fullLayout, cells: fullLayout.cells.filter((cell) => cell.part || cell.slot.required || hasInstallable(build, cell.path, cell.slot, catalog, weapon)) }
  const missing = missingRequired(build, weapon, catalog)
  const code = encodeBuild(build, catalog) ?? ''
  const savedHere = saved.find((entry) => entry.code === code)
  const isStock = code === encodeBuild({ ...stock, ammoId: build.ammoId }, catalog)

  const pickWeapon = (next: Weapon) => {
    dispatch({ type: 'reset', build: presetBuild(next, catalog).build })
    setSelected(null)
    setParams((current) => { const value = new URLSearchParams(current); value.set('weapon', next.id); return value }, { replace: true })
  }
  const loadSaved = (entry: SavedBuild) => {
    const decoded = decodeBuild(entry.code, catalog)
    if (!decoded) return
    dispatch({ type: decoded.weaponId === build.weaponId ? 'set' : 'reset', build: decoded })
    setSelected(null)
    setParams((current) => { const value = new URLSearchParams(current); value.set('weapon', decoded.weaponId); return value }, { replace: true })
  }
  const selectedCell = layout.cells.find((cell) => pathKey(cell.path) === selected)

  return <div className="wb-layout">

    <section className="panel wb-bench" aria-label={uiText('Верстак')}>
      <div className="wb-toolbar">
        <WeaponChooser weapon={weapon}><WeaponIndex weapons={weapons} catalog={catalog} selected={weapon.id} saved={saved} onPick={pickWeapon} /></WeaponChooser>
        <span className="wb-toolbar-gap" />
        <button className="icon-button" onClick={() => dispatch({ type: 'undo' })} disabled={!history.past.length} title={uiText('Отменить')} aria-label={uiText('Отменить')}><Undo2 size={15} /></button>
        <button className="icon-button" onClick={() => dispatch({ type: 'redo' })} disabled={!history.future.length} title={uiText('Повторить')} aria-label={uiText('Повторить')}><Redo2 size={15} /></button>
        <span className="wb-toolbar-gap" />
        <button className="button small" onClick={() => { dispatch({ type: 'set', build: { ...stock, ammoId: build.ammoId } }); setSelected(null) }}><RotateCcw size={13} />{uiText('Заводская')}</button>
        <button className="button small ghost" onClick={() => { dispatch({ type: 'set', build: { ...emptyBuild(weapon), ammoId: build.ammoId } }); setSelected(null) }}><Eraser size={13} />{uiText('Пустая')}</button>
        <span className="wb-toolbar-fill" />
        <SaveControls build={build} weapon={weapon} code={code} savedHere={savedHere} onSaved={setSaved} />
      </div>

      <div className="wb-summary">
        <div className="wb-summary-title">
          <h2>{weapon.name}</h2>
          <div className="wb-tags">
            <span className="tag">{uiText(CLASS_NAMES[weapon.weaponClass] ?? weapon.weaponClassName ?? 'Оружие')}</span>
            <span className="tag">{prettyCaliber(weapon.caliber)}</span>
            {weapon.fireRate > 0 && <span className="tag">{weapon.fireRate} {uiText('выстр/мин')}</span>}
            <span className="tag">{stats.partCount} {uiText('модулей')}</span>
          </div>
        </div>
        <StatBars stats={stats} stock={stockStats} weapon={weapon} />
      </div>
      <HandlingRow stats={stats} total={cost.total} stockTotal={computeCost(stock, weapon, catalog, access).total} />
      {missing.length > 0 && <div className="wb-alert" role="status"><AlertTriangle size={14} />{uiText('Оружие не стреляет без')}: {missing.map((entry) => entry.slot.name).join(', ')}</div>}

      <Board layout={layout} weapon={weapon} stats={stats} ammo={ammo} isStock={isStock} selected={selected} onSelect={setSelected} />
      <p className="wb-note">{uiText(RECOIL_NOTE)}</p>

      <PurchaseList cost={cost} access={access} onAccess={setAccess} />
    </section>

    <aside className="wb-side">
      {selected === 'ammo'
        ? <AmmoPicker options={ammoOptions} selected={build.ammoId} access={access} onPick={(ammoId) => dispatch({ type: 'set', build: { ...build, ammoId } })} onClose={() => setSelected(null)} />
        : selectedCell
          ? <ModPicker key={selected} cell={selectedCell} build={build} weapon={weapon} catalog={catalog} ammo={ammo} stats={stats} access={access}
            onPick={(itemId) => dispatch({ type: 'set', build: installPart(build, selectedCell.path, itemId, catalog) })}
            onRemove={() => dispatch({ type: 'set', build: removePart(build, selectedCell.path) })}
            onClose={() => setSelected(null)} />
          : <SavedList saved={saved} catalog={catalog} current={code} onLoad={loadSaved} onChange={setSaved} />}
    </aside>
  </div>
}

// ------------------------------------------------------------------------------------------------------------
// Weapon index (left): every weapon, by caliber or by class, with a search.
// ------------------------------------------------------------------------------------------------------------

/** «Оружие»: the weapon list opens over the board, so the board itself keeps the whole width. */
function WeaponChooser({ weapon, children }: { weapon: Weapon; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false) }
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key)
    return () => { document.removeEventListener('pointerdown', outside, true); window.removeEventListener('keydown', key) }
  }, [open])
  return <div className={`wb-chooser${open ? ' is-open' : ''}`} ref={ref} onClickCapture={(event) => { if ((event.target as HTMLElement).closest('.wb-index-row')) setOpen(false) }}>
    <button className="button small wb-chooser-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <PartIcon src={weapon.iconLink} /><span>{weapon.shortName}</span><ChevronDown size={14} />
    </button>
    {open && <div className="wb-chooser-panel">{children}</div>}
  </div>
}

function WeaponIndex({ weapons, catalog, selected, saved, onPick }: { weapons: Weapon[]; catalog: GunCatalog; selected: string; saved: SavedBuild[]; onPick: (weapon: Weapon) => void }) {
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('caliber')
  const { colorOf } = useMemo(() => caliberColors(catalog.ammo), [catalog.ammo])
  const starred = new Set(saved.filter((entry) => entry.favorite).map((entry) => entry.weaponId))
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = weapons.filter((weapon) => !needle || `${weapon.name} ${weapon.shortName} ${prettyCaliber(weapon.caliber)}`.toLowerCase().includes(needle))
    const map = new Map<string, Weapon[]>()
    for (const weapon of rows) {
      const key = grouping === 'caliber' ? weapon.caliber : weapon.weaponClass
      map.set(key, [...(map.get(key) ?? []), weapon])
    }
    return [...map.entries()].sort((a, b) => grouping === 'caliber'
      ? prettyCaliber(a[0]).localeCompare(prettyCaliber(b[0]), 'en', { numeric: true })
      : Object.keys(CLASS_NAMES).indexOf(a[0]) - Object.keys(CLASS_NAMES).indexOf(b[0]))
  }, [grouping, query, weapons])
  return <nav className="wb-index" aria-label={uiText('Оружие')}>
    <label className="wb-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти оружие…')} aria-label={uiText('Найти оружие')} /></label>
    <div className="wb-segment" role="tablist" aria-label={uiText('Группировка')}>
      {(['caliber', 'class'] as Grouping[]).map((value) => <button key={value} role="tab" aria-selected={grouping === value} className={grouping === value ? 'is-active' : ''} onClick={() => setGrouping(value)}>{uiText(value === 'caliber' ? 'Калибр' : 'Класс')}</button>)}
    </div>
    {groups.map(([key, rows]) => <div className="wb-index-group" key={key}>
      <h3>{grouping === 'caliber' ? <><i className="wb-caliber-dot" style={{ background: colorOf(key) }} />{prettyCaliber(key)}</> : uiText(CLASS_NAMES[key] ?? rows[0].weaponClassName ?? key)}<span>{rows.length}</span></h3>
      {rows.map((weapon) => <button key={weapon.id} className={`wb-index-row${weapon.id === selected ? ' is-active' : ''}`} onClick={() => onPick(weapon)} aria-current={weapon.id === selected ? 'true' : undefined}>
        <PartIcon src={weapon.iconLink} />
        <span className="wb-index-name">{weapon.shortName}</span>
        {starred.has(weapon.id) && <Star size={12} className="wb-index-star" aria-label={uiText('Есть в избранном')} />}
        <span className="wb-index-caliber">{grouping === 'caliber' ? uiText(CLASS_NAMES[weapon.weaponClass] ?? '').split(' ')[0] : prettyCaliber(weapon.caliber)}</span>
      </button>)}
    </div>)}
    {!groups.length && <p className="muted wb-index-empty">{uiText('Оружие не найдено.')}</p>}
  </nav>
}

/** The default build's picture (a render of every build is not available), the bare weapon's when it has none. */
function WeaponPicture({ weapon }: { weapon: Weapon }) {
  const ids = weapon.defaultPreset ? [weapon.defaultPreset.id, weapon.id] : [weapon.id]
  const [attempt, setAttempt] = useState(0)
  if (attempt >= ids.length) return <PartIcon size="large" />
  return <img src={pictureUrl(ids[attempt])} alt="" onError={() => setAttempt((value) => value + 1)} />
}

// ------------------------------------------------------------------------------------------------------------
// Stats: the main bars against the default build, then handling and price.
// ------------------------------------------------------------------------------------------------------------

function Delta({ value, better, digits = 0, unit = '' }: { value: number; better: 'lower' | 'higher'; digits?: number; unit?: string }) {
  if (Math.abs(value) < 10 ** -(digits + 1)) return null
  const good = better === 'lower' ? value < 0 : value > 0
  return <span className={`wb-delta ${good ? 'is-good' : 'is-bad'}`}>{signed(value, digits)}{unit}</span>
}

function StatBars({ stats, stock, weapon }: { stats: BuildStats; stock: BuildStats; weapon: Weapon }) {
  // No MOA (owner, 17.10.2026: «моа не добавляем»): recoil and ergonomics decide a build.
  const rows: Array<{ label: string; value: string; fill: number; stockFill: number; delta: number; better: 'lower' | 'higher'; digits?: number }> = [
    { label: 'Эргономика', value: String(stats.ergonomics), fill: stats.ergonomics / 100, stockFill: stock.ergonomics / 100, delta: stats.ergonomics - stock.ergonomics, better: 'higher' },
    { label: 'Верт. отдача', value: String(stats.recoilVertical), fill: stats.recoilVertical / Math.max(1, weapon.recoilVertical * 1.2), stockFill: stock.recoilVertical / Math.max(1, weapon.recoilVertical * 1.2), delta: stats.recoilVertical - stock.recoilVertical, better: 'lower' },
    { label: 'Гориз. отдача', value: String(stats.recoilHorizontal), fill: stats.recoilHorizontal / Math.max(1, weapon.recoilHorizontal * 1.2), stockFill: stock.recoilHorizontal / Math.max(1, weapon.recoilHorizontal * 1.2), delta: stats.recoilHorizontal - stock.recoilHorizontal, better: 'lower' },
    { label: 'Скорость пули', value: stats.velocity ? `${Math.round(stats.velocity)} ${uiText('м/с')}` : '—', fill: stats.velocity ? Math.min(1, stats.velocity / 1200) : 0, stockFill: stock.velocity ? Math.min(1, stock.velocity / 1200) : 0, delta: (stats.velocity ?? 0) - (stock.velocity ?? 0), better: 'higher' },
  ]
  return <div className="wb-bars">
    {rows.map((row) => <div className="wb-bar-row" key={row.label}>
      <span className="wb-bar-label">{uiText(row.label)}</span>
      <span className="wb-bar" aria-hidden="true"><span className="wb-bar-stock" style={{ width: `${Math.max(0, Math.min(1, row.stockFill)) * 100}%` }} /><span className="wb-bar-fill" style={{ width: `${Math.max(0, Math.min(1, row.fill)) * 100}%` }} /></span>
      <strong className="wb-bar-value">{row.value}</strong>
      <Delta value={row.delta} better={row.better} digits={row.digits} />
    </div>)}
    <p className="wb-bars-note">{uiText('Светлая полоса — заводская сборка.')}</p>
  </div>
}

function HandlingRow({ stats, total, stockTotal }: { stats: BuildStats; total: number; stockTotal: number }) {
  const items: Array<[string, string, string?]> = [
    ['EvoErgo', signed(stats.evoErgo, 1), stats.overswing ? 'is-bad' : undefined],
    ['Перевес', uiText(stats.overswing ? 'перевешивает' : 'не перевешивает'), stats.overswing ? 'is-bad' : 'is-good'],
    ['Прицеливание', `${stats.adsTime.toFixed(2)} ${uiText('сек.')}`],
    ['Выносливость рук', `${stats.armStamina} ${uiText('сек.')}`],
    ['Вес', `${stats.weightLoaded.toFixed(2)} ${uiText('кг')}`],
    ...(stats.width && stats.height ? [['Размер', `${stats.width}×${stats.height}`] as [string, string]] : []),
  ]
  return <div className="wb-handling">
    {items.map(([label, value, tone]) => <span className="wb-chip" key={label}><small>{uiText(label)}</small><strong className={tone}>{value}</strong></span>)}
    <span className="wb-chip is-total"><small>{uiText('Итого')}</small><strong>{formatRub(total)}</strong>{total !== stockTotal && <span className={`wb-delta ${total < stockTotal ? 'is-good' : 'is-bad'}`}>{total > stockTotal ? '+' : '−'}{formatRub(Math.abs(total - stockTotal))}</span>}</span>
    <span className="wb-handling-note">{uiText('EvoErgo, прицеливание и выносливость — оценка по модели сообщества.')}</span>
  </div>
}

// ------------------------------------------------------------------------------------------------------------
// The board: the weapon in the middle, every slot around it where it sits on the gun (src/arsenal/boardLayout.ts).
// ------------------------------------------------------------------------------------------------------------

const ZONE_ROWS: Record<Zone, number> = { top: 1, middle: 2, bottom: 3, rail: 5 }

function Board({ layout, weapon, stats, ammo, isStock, selected, onSelect }: {
  layout: BoardLayout; weapon: Weapon; stats: BuildStats; ammo?: AmmoStats; isStock: boolean; selected: string | null; onSelect: (key: string | null) => void
}) {
  const toggle = (key: string) => onSelect(selected === key ? null : key)
  const selectedPath = selected && selected !== 'ammo' ? selected.split('/') : undefined
  const linked = (path: string[]) => Boolean(selectedPath && path.length > selectedPath.length && selectedPath.every((id, index) => path[index] === id))
  const hasRail = layout.cells.some((cell) => cell.zone === 'rail')
  const zones: Zone[] = hasRail ? ['top', 'middle', 'bottom', 'rail'] : ['top', 'middle', 'bottom']
  // The whole board always fits the width (owner, 17.10.2026: «на одном экране … не нужно было ничего листать»): when
  // the weapon and its parts are wider than the bench, the board is scaled down instead of scrolling sideways.
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState<{ scale: number; height?: number; width?: number }>({ scale: 1 })
  useLayoutEffect(() => {
    const box = outer.current
    const board = inner.current
    if (!box || !board) return
    const observer = new ResizeObserver(() => {
      // On a phone the whole board would shrink below a finger's size: it stays at least PHONE_MIN_SCALE and scrolls
      // sideways instead (the PC keeps everything on one screen).
      const fitted = Math.min(1, (box.clientWidth - 16) / Math.max(1, board.offsetWidth))
      const scale = isMobileLayout() ? Math.max(PHONE_MIN_SCALE, fitted) : fitted
      const width = scale > fitted ? board.offsetWidth * scale : undefined
      setFit((current) => Math.abs(current.scale - scale) < 0.005 && current.height === board.offsetHeight * scale && current.width === width ? current : { scale, height: board.offsetHeight * scale, width })
    })
    observer.observe(box)
    observer.observe(board)
    return () => observer.disconnect()
  }, [])
  return <div className="wb-board-scroll" ref={outer}>
    <div className={`wb-board-fit${fit.width ? ' is-wide' : ''}`} style={{ height: fit.height, width: fit.width }}>
    <div className="wb-board" ref={inner} style={{ gridTemplateColumns: `repeat(${layout.columns}, auto)`, transform: fit.scale < 1 ? `scale(${fit.scale})` : undefined }} aria-label={uiText('Ячейки модулей')}>
      {zones.flatMap((zone) => {
        const columnCells = Array.from({ length: layout.columns }, (_, column) => zoneCells(layout, column, zone))
        const extra = (column: number) => (zone === 'middle' || zone === 'bottom') && column === layout.weaponColumn ? 1 : 0
        const spans = zone === 'middle' ? undefined : rowSpans(columnCells.map((cells, column) => cells.length + extra(column)))
        return columnCells.map((cells, column) => {
        const isWeapon = zone === 'middle' && column === layout.weaponColumn
        const withAmmo = zone === 'bottom' && column === layout.weaponColumn
        if (!cells.length && !isWeapon && !withAmmo) return null
        const ammoCell = withAmmo && <button key="ammo" className={`wb-cell is-ammo${selected === 'ammo' ? ' is-selected' : ''}${ammo ? ' is-filled' : ''}`} onClick={() => toggle('ammo')} aria-pressed={selected === 'ammo'}>
          {!ammo && <span className="wb-cell-slot">{uiText('Патрон')}</span>}
          {ammo ? <><CellPicture part={{ iconLink: ammo.iconLink, baseImageLink: baseImageOf(ammo.iconLink) }} /><span className="wb-cell-name">{ammo.shortName}</span><span className="wb-cell-ammo">{ammo.penetration} / {ammo.damage}</span></> : <SlotSilhouette kind="ammo" />}
        </button>
        const span = spans?.[column]
        return <div key={`${zone}-${column}`} className={`wb-zone is-${zone}${isWeapon ? ' is-weapon' : ''}`} style={{ gridColumn: span ? `${span.start + 1} / span ${span.span}` : column + 1, gridRow: ZONE_ROWS[zone] }}>
          {isWeapon && <WeaponCell weapon={weapon} stats={stats} isStock={isStock} />}
          {cells.map((cell) => <SlotCellButton key={pathKey(cell.path)} cell={cell} active={selected === pathKey(cell.path)} linked={linked(cell.path)} onClick={() => toggle(pathKey(cell.path))} />)}
          {ammoCell}
        </div>
        })
      })}
      {hasRail && <div className="wb-rail-label" style={{ gridRow: 4 }}><span>{uiText('Тактические устройства')}</span></div>}
    </div>
    </div>
  </div>
}

/**
 * A part over the whole cell: its picture without background (owner, 17.10.2026: «без синего фона и без внутренней рамки»),
 * else the inventory picture, else the small icon — whichever loads first.
 */
/** The background-free picture next to an icon: tarkov.dev «-base-image», our server's «-base». */
function baseImageOf(iconLink?: string) {
  if (!iconLink) return undefined
  return iconLink.includes('assets.tarkov.dev') ? iconLink.replace(/-icon\.webp$/, '-base-image.webp') : iconLink.replace(/-icon\.webp$/, '-base.webp')
}

function CellPicture({ part }: { part: Pick<GunPart, 'iconLink' | 'baseImageLink' | 'gridImageLink'> }) {
  const sources = [part.baseImageLink, part.gridImageLink, part.iconLink].filter((src): src is string => Boolean(src))
  const [attempt, setAttempt] = useState(0)
  if (attempt >= sources.length) return <PartIcon />
  return <img className="gb-icon wb-cell-picture" src={sources[attempt]} alt="" loading="lazy" draggable={false} onError={() => setAttempt((value) => value + 1)} />
}

/** The weapon itself: its picture in the middle of the board, with the weight of the build. */
function WeaponCell({ weapon, stats, isStock }: { weapon: Weapon; stats: BuildStats; isStock: boolean }) {
  return <div className="wb-weapon-cell" title={!isStock && weapon.defaultPreset ? `${weapon.name} · ${uiText('Изображение заводской сборки')}` : weapon.name}>
    <span className="wb-weapon-cell-name">{weapon.shortName}</span>
    <span className="wb-weapon-cell-picture"><WeaponPicture key={weapon.id} weapon={weapon} /></span>
    <span className="wb-weapon-cell-foot">
      {weapon.fireRate > 0 && <small>{weapon.fireRate} {uiText('выстр/мин')}</small>}
      <strong>{stats.weightLoaded.toFixed(2)} {uiText('кг')}</strong>
    </span>
  </div>
}

function SlotCellButton({ cell, active, linked, onClick }: { cell: PlacedCell; active: boolean; linked: boolean; onClick: () => void }) {
  const { part, slot } = cell
  const missing = slot.required && !part
  return <button className={`wb-cell${active ? ' is-selected' : ''}${linked ? ' is-linked' : ''}${part ? ' is-filled' : ''}${missing ? ' is-missing' : ''}`} onClick={onClick} aria-pressed={active}
    title={part ? `${slot.name}: ${part.name}` : `${slot.name}: ${uiText(missing ? 'обязательная, пусто' : 'пусто')}`}>
    {!part && !slotPicture(slot.nameId, cell.kind) && <span className="wb-cell-slot">{slot.name}</span>}
    {part ? <>
      {part.ergonomics !== 0 && <span className={`wb-cell-ergo ${part.ergonomics > 0 ? 'is-good' : 'is-bad'}`}>{signed(part.ergonomics)}</span>}
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

// ------------------------------------------------------------------------------------------------------------
// Right panel: the items of the chosen slot with what each changes.
// ------------------------------------------------------------------------------------------------------------

const offerLabel = (offer: GunOffer) => offer.vendor === 'flea-market' ? uiText('Барахолка') : `${offer.vendorName} ${offer.minTraderLevel ?? 1}`

function ModPicker({ cell, build, weapon, catalog, ammo, stats, access, onPick, onRemove, onClose }: {
  cell: SlotCell; build: Build; weapon: Weapon; catalog: GunCatalog; ammo?: AmmoStats; stats: BuildStats; access: PurchaseAccess
  onPick: (itemId: string) => void; onRemove: () => void; onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<Sort>('recoil')
  const [buyable, setBuyable] = useState(false)
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return slotCandidates(cell.slot, catalog)
      .filter((part) => !needle || `${part.name} ${part.shortName}`.toLowerCase().includes(needle))
      .map((part) => {
        const check = canInstall(build, cell.path, cell.slot, part.id, catalog, weapon)
        const offer = cheapestOffer(part, access)
        const after = check.ok ? computeStats(installPart(build, cell.path, part.id, catalog), weapon, catalog, ammo) : undefined
        return { part, check, offer, after }
      })
      // Only what fits (owner, 17.10.2026): items that conflict with the build are not listed at all.
      .filter((row) => row.check.ok && (!buyable || row.offer))
      .sort((a, b) => compare(sort, a, b))
  }, [access, ammo, build, buyable, catalog, cell.path, cell.slot, query, sort, weapon])
  return <section className="panel wb-picker" aria-label={cell.slot.name}>
    <div className="wb-picker-head">
      <div><small>{uiText('Ячейка')}</small><h3>{cell.slot.name}</h3></div>
      <button className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
    </div>
    {cell.part && <div className="wb-picker-current">
      <PartIcon src={cell.part.iconLink} />
      <span><small>{uiText('Сейчас')}</small><strong>{cell.part.name}</strong></span>
      {!cell.slot.required && <button className="button small ghost" onClick={onRemove}><Trash2 size={13} />{uiText('Снять')}</button>}
    </div>}
    <div className="wb-picker-tools">
      <label className="wb-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти модуль…')} aria-label={uiText('Найти модуль')} autoFocus /></label>
      <div className="wb-picker-row">
        <select className="select" value={sort} onChange={(event) => setSort(event.target.value as Sort)} aria-label={uiText('Сортировка')}>
          <option value="recoil">{uiText('Сначала меньше отдача')}</option>
          <option value="ergonomics">{uiText('Сначала больше эргономика')}</option>
          <option value="price">{uiText('Сначала дешевле')}</option>
          <option value="name">{uiText('По названию')}</option>
        </select>
        <label className="wb-check"><input type="checkbox" checked={buyable} onChange={(event) => setBuyable(event.target.checked)} />{uiText('Можно купить')}</label>
      </div>
      <p className="wb-picker-count">{uiText('Подходит')}: <strong>{rows.length}</strong></p>
    </div>
    <div className="wb-options" role="listbox" aria-label={cell.slot.name}>
      {rows.map(({ part, offer, after }) => <button key={part.id} role="option" aria-selected={part.id === cell.part?.id}
        className={`wb-option${part.id === cell.part?.id ? ' is-current' : ''}`} onClick={() => onPick(part.id)} title={part.name}>
        <PartIcon src={part.iconLink} />
        <span className="wb-option-text">
          <strong>{part.name}</strong>
          <span className="wb-option-stats">
            <>
              {part.ergonomics !== 0 && <span className={part.ergonomics > 0 ? 'is-good' : 'is-bad'}>{uiText('Эрг')} {signed(part.ergonomics)}</span>}
              {part.recoilModifier !== 0 && <span className={part.recoilModifier < 0 ? 'is-good' : 'is-bad'}>{uiText('Отд')} {formatModifier(part.recoilModifier)}</span>}
              {part.accuracyModifier !== 0 && <span className={part.accuracyModifier > 0 ? 'is-good' : 'is-bad'}>{uiText('Точн')} {formatModifier(part.accuracyModifier)}</span>}
              {part.capacity ? <span>{part.capacity} {uiText('патр.')}</span> : null}
              {part.slots.length > 0 && <span className="is-info"><Layers size={10} /> +{part.slots.length} {uiText('ячеек')}</span>}
            </>
          </span>
          {after && <span className="wb-option-after">
            {uiText('Верт.')} {after.recoilVertical} <Delta value={after.recoilVertical - stats.recoilVertical} better="lower" />
            {' · '}{uiText('Эрг.')} {after.ergonomics} <Delta value={after.ergonomics - stats.ergonomics} better="higher" />
          </span>}
        </span>
        <span className="wb-option-price">{offer ? <><strong>{formatRub(offer.priceRUB)}</strong><small>{offerLabel(offer)}</small></> : <small className="is-bad">{uiText(part.noFlea ? 'запрет барахолки' : 'нет в продаже')}</small>}</span>
      </button>)}
      {!rows.length && <p className="muted wb-none">{uiText('Ничего не найдено.')}</p>}
    </div>
  </section>
}

type Row = { part: GunPart; offer?: GunOffer; after?: BuildStats }
function compare(sort: Sort, a: Row, b: Row) {
  const price = (row: Row) => row.offer?.priceRUB ?? Number.POSITIVE_INFINITY
  if (sort === 'price') return price(a) - price(b)
  if (sort === 'name') return a.part.name.localeCompare(b.part.name, 'ru')
  if (sort === 'ergonomics') return (b.after?.ergonomicsRaw ?? -1e9) - (a.after?.ergonomicsRaw ?? -1e9) || price(a) - price(b)
  return (a.after?.recoilVerticalExact ?? 1e9) - (b.after?.recoilVerticalExact ?? 1e9) || (b.after?.ergonomicsRaw ?? 0) - (a.after?.ergonomicsRaw ?? 0) || price(a) - price(b)
}

function AmmoPicker({ options, selected, access, onPick, onClose }: { options: AmmoStats[]; selected?: string; access: PurchaseAccess; onPick: (id: string) => void; onClose: () => void }) {
  return <section className="panel wb-picker" aria-label={uiText('Патрон')}>
    <div className="wb-picker-head">
      <div><small>{uiText('Ячейка')}</small><h3>{uiText('Патрон')}</h3></div>
      <button className="icon-button" onClick={onClose} aria-label={uiText('Закрыть')} title={uiText('Закрыть')}><X size={15} /></button>
    </div>
    <div className="wb-options" role="listbox" aria-label={uiText('Патрон')}>
      {options.map((round) => {
        const offer = cheapestOffer(round, access)
        return <button key={round.id} role="option" aria-selected={round.id === selected} className={`wb-option${round.id === selected ? ' is-current' : ''}`} onClick={() => onPick(round.id)}>
          <PartIcon src={round.iconLink} />
          <span className="wb-option-text">
            <strong>{round.name}</strong>
            <span className="wb-option-stats">
              <span>{uiText('Проб.')} {round.penetration}</span>
              <span>{uiText('Урон')} {round.projectileCount > 1 ? `${round.damage}×${round.projectileCount}` : round.damage}</span>
              {round.initialSpeed > 0 && <span>{Math.round(round.initialSpeed)} {uiText('м/с')}</span>}
              {round.recoilModifier !== 0 && <span className={round.recoilModifier < 0 ? 'is-good' : 'is-bad'}>{uiText('Отд')} {formatModifier(round.recoilModifier)}</span>}
            </span>
          </span>
          <span className="wb-option-price">{offer ? <><strong>{formatRub(offer.priceRUB)}</strong><small>{offerLabel(offer)}</small></> : <small className="is-bad">{uiText('нет в продаже')}</small>}</span>
        </button>
      })}
      {!options.length && <p className="muted wb-none">{uiText('Нет данных о патронах этого калибра.')}</p>}
    </div>
  </section>
}

// ------------------------------------------------------------------------------------------------------------
// Saving: a name, the star, and the list of this mode's builds.
// ------------------------------------------------------------------------------------------------------------

function SaveControls({ build, weapon, code, savedHere, onSaved }: { build: Build; weapon: Weapon; code: string; savedHere?: SavedBuild; onSaved: (list: SavedBuild[]) => void }) {
  const { raidMode } = useAppState()
  const [naming, setNaming] = useState(false)
  const [name, setName] = useState('')
  const [notice, setNotice] = useState('')
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 2200); return () => window.clearTimeout(timer) }, [notice])
  const save = (favorite: boolean) => {
    if (!code) return
    const list = saveBuild(raidMode, { id: savedHere?.id, name: name.trim() || savedHere?.name || weapon.shortName, weaponId: build.weaponId, code, ...(favorite || savedHere?.favorite ? { favorite: true as const } : {}) })
    onSaved(list)
    setNaming(false)
    setNotice(favorite ? 'Добавлено в избранное' : 'Сохранено')
  }
  const star = () => {
    if (savedHere) { onSaved(toggleSavedFavorite(raidMode, savedHere.id)); setNotice(savedHere.favorite ? 'Убрано из избранного' : 'Добавлено в избранное') }
    else save(true)
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setNotice('Код скопирован') } catch { setNotice('Не удалось скопировать') }
  }
  return <div className="wb-save">
    {notice && <span className="wb-save-notice" role="status">{uiText(notice)}</span>}
    {naming
      ? <form className="wb-save-form" onSubmit={(event) => { event.preventDefault(); save(false) }}>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={uiText('Название сборки')} aria-label={uiText('Название сборки')} autoFocus maxLength={48} />
        <button className="button small primary" type="submit"><Save size={13} />{uiText('Сохранить')}</button>
        <button className="icon-button" type="button" onClick={() => setNaming(false)} aria-label={uiText('Отмена')}><X size={14} /></button>
      </form>
      : <button className="button small primary" onClick={() => { setName(savedHere?.name ?? ''); setNaming(true) }} disabled={!code}><Save size={13} />{uiText(savedHere ? 'Сохранено' : 'Сохранить')}</button>}
    <button className={`button small${savedHere?.favorite ? ' is-starred' : ''}`} onClick={star} disabled={!code} aria-pressed={Boolean(savedHere?.favorite)}><Star size={13} />{uiText(savedHere?.favorite ? 'В избранном' : 'В избранное')}</button>
    <button className="icon-button" onClick={() => void copy()} disabled={!code} title={uiText('Копировать код сборки')} aria-label={uiText('Копировать код сборки')}><Copy size={14} /></button>
  </div>
}

function SavedList({ saved, catalog, current, onLoad, onChange }: { saved: SavedBuild[]; catalog: GunCatalog; current: string; onLoad: (entry: SavedBuild) => void; onChange: (list: SavedBuild[]) => void }) {
  const { raidMode } = useAppState()
  const [importCode, setImportCode] = useState('')
  const [bad, setBad] = useState(false)
  const ordered = [...saved].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.savedAt.localeCompare(a.savedAt))
  return <section className="panel wb-saved" aria-label={uiText('Мои сборки')}>
    <div className="wb-picker-head"><div><small>{raidMode === 'seasonal' ? uiText('Сезон') : raidMode.toUpperCase()}</small><h3>{uiText('Мои сборки')}</h3></div></div>
    <p className="wb-saved-hint">{uiText('Нажмите на любую ячейку оружия, чтобы выбрать модуль.')}</p>
    <ul className="wb-saved-list">
      {ordered.map((entry) => {
        const savedWeapon = catalog.weapons.find((weapon) => weapon.id === entry.weaponId)
        return <li key={entry.id} className={entry.code === current ? 'is-current' : undefined}>
          <button className="wb-saved-open" onClick={() => onLoad(entry)} title={uiText('Открыть')}>
            <PartIcon src={savedWeapon?.iconLink} />
            <span><strong>{entry.name}</strong><small>{savedWeapon?.shortName ?? '—'} · {new Date(entry.savedAt).toLocaleDateString()}</small></span>
          </button>
          <button className={`icon-button${entry.favorite ? ' is-starred' : ''}`} onClick={() => onChange(toggleSavedFavorite(raidMode, entry.id))} aria-pressed={Boolean(entry.favorite)} aria-label={uiText(entry.favorite ? 'Убрать из избранного' : 'В избранное')} title={uiText(entry.favorite ? 'Убрать из избранного' : 'В избранное')}><Star size={14} /></button>
          <button className="icon-button" onClick={() => onChange(deleteSavedBuild(raidMode, entry.id))} aria-label={uiText('Удалить')} title={uiText('Удалить')}><Trash2 size={14} /></button>
        </li>
      })}
      {!saved.length && <li className="muted wb-none">{uiText('Сохранённых сборок для этого режима пока нет.')}</li>}
    </ul>
    <form className="wb-import" onSubmit={(event) => {
      event.preventDefault()
      const decoded = decodeBuild(importCode.trim(), catalog)
      if (!decoded) { setBad(true); return }
      setBad(false)
      onLoad({ id: '', name: '', weaponId: decoded.weaponId, code: importCode.trim(), savedAt: '' })
      setImportCode('')
    }}>
      <input className="input" value={importCode} onChange={(event) => { setImportCode(event.target.value); setBad(false) }} placeholder={uiText('Вставьте код сборки')} aria-label={uiText('Код сборки')} />
      <button className="button small" type="submit" disabled={!importCode.trim()}><FolderOpen size={13} />{uiText('Открыть')}</button>
    </form>
    {bad && <p className="wb-import-bad" role="alert">{uiText('Код не распознан')}</p>}
  </section>
}

// ------------------------------------------------------------------------------------------------------------
// Purchase list: every part, where it is cheapest for the player's access, and the total.
// ------------------------------------------------------------------------------------------------------------

function PurchaseList({ cost, access, onAccess }: { cost: ReturnType<typeof computeCost>; access: PurchaseAccess; onAccess: (next: PurchaseAccess) => void }) {
  return <details className="wb-buy">
    <summary><span>{uiText('Список покупок')}</span><small>{cost.lines.length} {uiText('поз.')}</small><strong>{formatRub(cost.total)}</strong></summary>
    <div className="wb-buy-access">
      <label>{uiText('Лояльность торговцев')} <select className="select" value={access.traderLevel} onChange={(event) => onAccess({ ...access, traderLevel: Number(event.target.value) })}>{[1, 2, 3, 4].map((level) => <option key={level} value={level}>{level}</option>)}</select></label>
      <label className="wb-check"><input type="checkbox" checked={access.flea} onChange={(event) => onAccess({ ...access, flea: event.target.checked })} />{uiText('Барахолка доступна')}</label>
    </div>
    <table className="wb-buy-table">
      <tbody>{cost.lines.map((line, index) => <tr key={`${line.part.id}-${index}`}>
        <td><span className="wb-buy-name"><PartIcon src={line.part.iconLink} />{line.part.name}</span></td>
        <td className="dim">{line.offer ? offerLabel(line.offer) : <span className="is-bad">{uiText(line.part.noFlea ? 'запрет барахолки' : 'нет в продаже')}</span>}</td>
        <td className="mono">{line.offer ? formatRub(line.offer.priceRUB) : '—'}</td>
      </tr>)}</tbody>
    </table>
    {cost.unavailable.length > 0 && <p className="wb-note is-bad">{uiText('Без цены (бартер, крафт или нужна лояльность выше)')}: {cost.unavailable.length}</p>}
  </details>
}
