import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, Check, ChevronDown, Heart, Layers, LoaderCircle, Lock, Pencil, RefreshCw, RotateCcw, Save, Search, Star, Store, Trash2, Upload, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { exactUiText } from '../i18n/uiEnglish'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { installReplacing, missingRequired, presetBuild, removePart } from '../arsenal/buildModel'
import { useBuildDrawing } from '../arsenal/BuildPicture'
import { Delta, FullBench } from '../arsenal/FullBench'
import { BuildBench, pathKey, shownLayout } from '../arsenal/BuildBench'
import { AmmoGrid, ModGrid } from '../arsenal/ModGrid'
import { computeExtraCost, computeStats, FULL_ACCESS, unlockHint, type BuildCost, type BuildStats, type PurchaseAccess } from '../arsenal/buildStats'
import { decodeBuild, deleteSavedBuild, encodeBuild, loadSavedBuilds, renameSavedBuild, saveBuild, toggleSavedFavorite, type SavedBuild } from '../arsenal/buildStorage'
import { listSharedBuilds, publishBuild, removeSharedBuild, toggleBuildLike, type SharedBuild } from '../arsenal/buildCatalogClient'
import { caliberColors } from '../arsenal/caliberColors'
import { formatRub, PartIcon, prettyCaliber, weaponIcon, unlockLabel, useQuestNames } from '../arsenal/gunFormat'
import { useGunsmithAccess, type GunsmithAccess } from '../gunsmith/useGunsmithAccess'
import { TRADER_ORDER } from '../gunsmith/traderLevels'
import { BUILD_TIERS, buildableWeapon, solveTier, type BuildTier, type TieredBuild } from '../arsenal/tieredBuilds'
import { useOwnerBuilds } from '../arsenal/ownerBuilds'
import { withLiveGunPrices } from '../arsenal/liveGunPrices'
import { useLivePrices } from '../data/livePrices'
import type { Build, GunCatalog, GunOffer, GunPart, Weapon } from '../arsenal/gunTypes'
import { isOwnerApp } from '../app/buildEdition'
import '../styles/weaponBuilds.css'
import { useOptionalTarkovData } from '../data/DataProvider'
import { useEconomySnapshot } from '../data/useEconomy'
import { FLEA_PLAYER_LEVEL } from '../gunsmith/traderLevels'
import { itemBuyOptions } from '../trading/itemBuyOptions'
import { gunPriceChoice, type GunPriceChoice } from '../trading/gunPrice'

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
/** «Избранное» (owner, 15.11.2026): only the weapons with a build starred in this mode (SaveControls, SavedList). */
type Grouping = 'caliber' | 'class' | 'favorites'
export function WeaponBuildsPage() {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const query = useGunCatalog(raidMode, locale)
  // This minute's flea prices (owner, 02.11.2026: «цена изменилась на барахолке, сборка тоже изменилась»): the board and
  // the shopping list at once; the ready builds are solved again from them (AutoBuilds, at most every SOLVE_EVERY_MS).
  const live = useLivePrices(raidMode, Boolean(query.data))
  const catalog = useMemo(() => query.data && withLiveGunPrices(query.data, live), [query.data, live])
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

// «Мои сборки» became «Избранные» (owner, 19.11.2026): the weapons, each opening into its builds
/** «1 сборка», «3 сборки», «5 сборок», «21 сборка», «12 сборок». */
const buildsWord = (count: number) => {
  const tens = count % 100, ones = count % 10
  return tens >= 11 && tens <= 14 ? 'сборок' : ones === 1 ? 'сборка' : ones >= 2 && ones <= 4 ? 'сборки' : 'сборок'
}
const SIDE_TABS = { mine: 'Избранные', ready: 'Готовые сборки', players: 'Сборки игроков' } as const

function Workshop({ catalog }: { catalog: GunCatalog }) {
  const { raidMode } = useAppState()
  const [params, setParams] = useSearchParams()
  // Every firearm of cartridges (owner, 20.11.2026: «Добавляй все оружие… автоматы, винтовки, пистолеты. Не нужно добавлять туда
  // файеры и холодное оружие. И гранаты не надо»): no flare or rocket guns, no grenade launchers (19.11.2026: «РШГ-2 там не должно
  // быть»); a weapon with no slots for mods too — its picture and its round.
  const weapons = useMemo(() => catalog.weapons.filter((weapon) => buildableWeapon(weapon)).sort((a, b) => a.shortName.localeCompare(b.shortName, 'ru')), [catalog])
  const startWeapon = weapons.find((weapon) => weapon.id === params.get('weapon')) ?? weapons.find((weapon) => weapon.shortName === 'M4A1') ?? weapons[0]
  const [build, setBuild] = useState<Build>(() => presetBuild(startWeapon, catalog).build)
  // `tab`: the side tab to open on — «Готовые сборки» from a weapon of «Сбор на рейд» (overview/WeaponBuildMenu.tsx).
  const [sideTab, setSideTab] = useState<'mine' | 'ready' | 'players'>(() => { const tab = params.get('tab'); return tab === 'ready' || tab === 'players' ? tab : 'mine' })
  const weapon = catalog.weapons.find((entry) => entry.id === build.weaponId) ?? startWeapon
  const [selected, setSelected] = useState<string | null>(null)
  /** Parts the last pick took off (a conflict with the new one); said for a few seconds. */
  const [replaced, setReplaced] = useState<string[] | null>(null)
  useEffect(() => {
    if (!replaced) return
    const timer = window.setTimeout(() => setReplaced(null), 8000)
    return () => window.clearTimeout(timer)
  }, [replaced])
  // Each trader's own loyalty (owner, 18.10.2026: «не одна на всех… программа сама определяет уровень торговцев»): the
  // levels the app reads from the game's traders' screen and the tasks of this mode, changeable by hand (TraderSettings).
  const shop = useGunsmithAccess()
  // The flea by the character's level alone (owner, 15.11.2026: «если вернуть по уровню персонажа… показывает модули,
  // которые доступны на барахолке в зависимости от его уровня… кнопку «Барахолка доступна» убирай»): the market from its
  // level in this mode, each item from its own (tarkov.dev minLevelForFlea, 20–40 for many), src/gunsmith/traderLevels.ts.
  // «Показать все модули» (owner, 20.11.2026: «не будет опираться на ограничения уровня или уровень лояльности торговца… можно
  // будет собрать любую сборку»): every trader at its top, the flea open, every quest's unlock counted.
  const [allModules, setAllModulesState] = useState(readAllModules)
  const setAllModules = (next: boolean) => {
    setAllModulesState(next)
    try { localStorage.setItem(ALL_MODULES_KEY, next ? '1' : '0') } catch { /* per-viewer convenience only */ }
  }
  const access = allModules ? FULL_ACCESS : shop.access
  // Remounted per mode (key below): PvP, PvE and Season lists never mix.
  const [saved, setSaved] = useState<SavedBuild[]>(() => loadSavedBuilds(raidMode))
  // The saved build opened from «Избранные»: «Сохранить» after a change keeps it (owner, 19.11.2026: «сборки можно редактировать и нажать «Сохранить» на этой сборке»).
  const [openedId, setOpenedId] = useState<string | null>(null)

  const ammoOptions = useMemo(() => catalog.ammo.filter((round) => round.caliber === weapon.caliber).sort((a, b) => b.penetration - a.penetration), [catalog.ammo, weapon.caliber])
  const ammo = ammoOptions.find((round) => round.id === build.ammoId)
  const stats = computeStats(build, weapon, catalog, ammo)
  const stock = useMemo(() => presetBuild(weapon, catalog).build, [catalog, weapon])
  const stockStats = computeStats({ ...stock, ammoId: build.ammoId }, weapon, catalog, ammo)
  const extra = computeExtraCost(build, stock, catalog, access)
  const gun = useGunPrice(weapon, shop)
  // Empty slots nothing can go into right now are not drawn (an installed part conflicts with every candidate), nor a second empty
  // slot of a kind beside a filled one (src/arsenal/boardLayout.ts hiddenTwins): it shows while its filled twin is the chosen cell.
  const layout = shownLayout(build, weapon, catalog, selected)
  // The build drawn from the game's own part pictures, live (owner, 20.11.2026); the board of cells when a part has no picture yet.
  // the stock folded or not (a view of the build, not saved with it)
  const [folded, setFolded] = useState(false)
  const drawing = useBuildDrawing(build, folded)
  // «На весь экран» (owner, 20.11.2026): the build over the whole window, the stats in a window of their own.
  const [full, setFull] = useState(false)
  const closeFull = useCallback(() => setFull(false), [])
  const missing = missingRequired(build, weapon, catalog)
  const code = encodeBuild(build, catalog) ?? ''
  const savedHere = saved.find((entry) => entry.code === code)
  const opened = openedId ? saved.find((entry) => entry.id === openedId) : undefined
  const isStock = code === encodeBuild({ ...stock, ammoId: build.ammoId }, catalog)

  const pickWeapon = (next: Weapon) => {
    setBuild(presetBuild(next, catalog).build)
    setSelected(null)
    setOpenedId(null)
    setParams((current) => { const value = new URLSearchParams(current); value.set('weapon', next.id); return value }, { replace: true })
  }
  const loadSaved = (entry: SavedBuild) => {
    const decoded = decodeBuild(entry.code, catalog)
    if (!decoded) return
    setBuild(decoded)
    setSelected(null)
    setOpenedId(entry.id || null)
    setParams((current) => { const value = new URLSearchParams(current); value.set('weapon', decoded.weaponId); return value }, { replace: true })
  }
  // «Сохранить» on the opened build of «Избранные»: the same entry, the same name, the parts as they are now
  const saveOpened = () => { if (opened && code) setSaved(saveBuild(raidMode, { id: opened.id, name: opened.name, weaponId: build.weaponId, code, ...(opened.favorite ? { favorite: true as const } : {}) })) }
  const selectedCell = layout.cells.find((cell) => pathKey(cell.path) === selected)
  const side = useSideFit()
  // A slot's modules in a small window at its cell, like the game's (src/arsenal/ModGrid.tsx).
  const pickAt = (anchor: () => Element | null, avoid: () => DOMRect | null) => selected === 'ammo'
    ? <AmmoGrid options={ammoOptions} selected={build.ammoId} access={access} everything={allModules} anchor={anchor} avoid={avoid} onPick={(ammoId) => { setBuild({ ...build, ammoId: ammoId || undefined }); setSelected(null) }} onClose={() => setSelected(null)} />
    : selectedCell
      ? <ModGrid key={selected} cell={selectedCell} build={build} weapon={weapon} catalog={catalog} ammo={ammo} stats={stats} access={access} everything={allModules} anchor={anchor} avoid={avoid}
        onPick={(itemId, then) => {
          const done = installReplacing(build, selectedCell.path, selectedCell.slot, itemId, catalog, weapon)
          if (!done) return
          setBuild(done.build)
          setReplaced(done.removed.length ? done.removed.map((part) => part.shortName || part.name) : null)
          // a ring: the window of its seat opens next, for the optical scope (src/arsenal/sightTabs.ts)
          setSelected(then ? pathKey(then) : null)
        }}
        onPickKit={(kit) => { setBuild(kit.build); setReplaced(kit.removed.length ? kit.removed.map((part) => part.shortName || part.name) : null); setSelected(null) }}
        onRemove={() => { setBuild(removePart(build, selectedCell.path)); setReplaced(null); setSelected(null) }}
        onClose={() => setSelected(null)} />
      : null
  const takeOff = (path: string[]) => { setBuild(removePart(build, path)); setReplaced(null); setSelected(null) }
  const bench = (size: 'normal' | 'full', maxHeight?: number) => <BuildBench layout={layout} weapon={weapon} stats={stats} ammo={ammo} selected={selected} onSelect={setSelected} onRemove={takeOff}
    drawn={drawing.drawn} size={size} maxHeight={maxHeight} onExpand={size === 'normal' ? () => setFull(true) : undefined} folded={folded} onFold={setFolded}
    popover={(size === 'full') === full ? pickAt : undefined} />

  return <div className="wb-layout">

    <section className="panel wb-bench" aria-label={uiText('Верстак')}>
      <div className="wb-toolbar">
        <WeaponChooser weapon={weapon}>{(close) => <WeaponIndex weapons={weapons} catalog={catalog} selected={weapon.id} saved={saved} onPick={(next) => { pickWeapon(next); close() }} />}</WeaponChooser>
        <span className="wb-toolbar-gap" />
        {/* «Сброс»: every stock part back (owner, 17.10.2026: «где заводская написано — сброс, он ставит все штатные детали»). */}
        <button className="button small" onClick={() => { setBuild({ ...stock, ammoId: build.ammoId }); setSelected(null) }} disabled={isStock} title={uiText('Поставить все штатные детали')}><RotateCcw size={13} />{uiText('Сброс')}</button>
        <TraderSettings shop={shop} />
        <label className={`wb-gun-price-toggle${gun.on ? ' is-on' : ''}`} title={uiText('Добавить к общей цене цену самого оружия')}>
          <input type="checkbox" checked={gun.on} onChange={(event) => gun.setOn(event.target.checked)} />
          <span>{uiText('Цена оружия')}</span>
        </label>
        <label className={`wb-gun-price-toggle${allModules ? ' is-on' : ''}`} title={uiText('Не учитывать уровень персонажа и лояльность торговцев: открыты все модули игры')}>
          <input type="checkbox" checked={allModules} onChange={(event) => setAllModules(event.target.checked)} />
          <span>{uiText('Показать все модули')}</span>
        </label>
        <span className="wb-toolbar-fill" />
        <SaveControls build={build} weapon={weapon} code={code} savedHere={savedHere ?? opened} onSaved={setSaved} onPublished={() => { setSelected(null); setSideTab('players') }} />
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
      <HandlingRow stats={stats} />
      {missing.length > 0 && <div className="wb-alert" role="status"><AlertTriangle size={14} />{uiText('Оружие не стреляет без')}: {missing.map((entry) => entry.slot.name).join(', ')}</div>}
      {replaced && <div className="wb-alert is-info" role="status"><Layers size={14} />{uiText('Снято, потому что не ставится вместе с новой деталью')}: {replaced.join(', ')}</div>}

      {bench('normal')}

      <PurchaseList cost={extra} access={access} gun={gun.on ? { weapon, choice: gun.choice } : undefined} />
    </section>

    <aside className="wb-side" ref={side}>
      <section className="panel wb-saved" aria-label={uiText('Сборки')}>
            <div className="wb-side-tabs" role="tablist">
              {/* Owner, 04.11.2026: «Мои сборки», «Готовые сборки» и «Сборки игроков». */}
              {(['mine', 'ready', 'players'] as const).map((tab) => <button key={tab} role="tab" aria-selected={sideTab === tab} className={sideTab === tab ? 'active' : undefined} onClick={() => setSideTab(tab)}>{uiText(SIDE_TABS[tab])}</button>)}
            </div>
            {sideTab === 'mine' && <FavoriteWeapons saved={saved} catalog={catalog} current={code} weaponId={weapon.id} openedId={opened?.id ?? null} onLoad={loadSaved} onChange={setSaved} onSaveOpened={saveOpened} />}
            {sideTab === 'ready' && <AutoBuilds catalog={catalog} weapon={weapon} access={access} current={code} onLoad={loadSaved} />}
            {sideTab === 'players' && <PlayerBuilds catalog={catalog} weapon={weapon} access={access} current={code} onLoad={loadSaved} />}
      </section>
    </aside>
    {full && <FullBench weapon={weapon} stats={stats} stock={stockStats} selected={selected} onSelect={setSelected} onClose={closeFull}>
      {(maxHeight) => bench('full', maxHeight)}
    </FullBench>}
  </div>
}

/**
 * The right column never reaches past the bottom of the window (owner, 18.10.2026: «правая панель с выбором модулей
 * уходит вниз»): its height is what is left below its top edge, which moves while the page scrolls until it sticks.
 */
function useSideFit() {
  const ref = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    const update = () => {
      frame = 0
      const topbar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--topbar')) || 0
      const top = Math.max(element.getBoundingClientRect().top, topbar + 12)
      element.style.setProperty('--wb-side-max', `${Math.max(320, Math.floor(window.innerHeight - top - 14))}px`)
    }
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', schedule, { passive: true })
    window.addEventListener('resize', schedule)
    return () => { window.removeEventListener('scroll', schedule); window.removeEventListener('resize', schedule); cancelAnimationFrame(frame) }
  }, [])
  return ref
}

/**
 * «Торговцы»: the loyalty of every trader for the builder's prices, «Можно купить» and the ready-made builds — the level
 * the app found (the game's traders' screen, the tasks of this mode) or the player's own, kept per mode.
 */
function TraderSettings({ shop }: { shop: GunsmithAccess }) {
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
  const infos = [...shop.infos].sort((a, b) => TRADER_ORDER.indexOf(a.key) - TRADER_ORDER.indexOf(b.key))
  return <div className={`wb-traders${open ? ' is-open' : ''}`} ref={ref}>
    <button className="button small" onClick={() => setOpen((value) => !value)} aria-expanded={open} title={uiText('Уровни торговцев')}><Store size={13} />{uiText('Торговцы')}</button>
    {open && <div className="wb-traders-panel" role="dialog" aria-label={uiText('Уровни торговцев')}>
      <p className="wb-note">{uiText('Уровни берутся из игры. Можно поменять вручную.')}</p>
      <ul>
        {infos.map((info) => <li key={info.key}>
          <span className="wb-trader-name">{info.trader.name}</span>
          <span className="wb-trader-levels" role="radiogroup" aria-label={info.trader.name}>
            {[1, 2, 3, 4].map((level) => <button key={level} role="radio" aria-checked={info.level === level} className={info.level === level ? 'is-active' : undefined} onClick={() => shop.setLevel(info.key, level)}>{level === 4 ? '★' : ['I', 'II', 'III'][level - 1]}</button>)}
          </span>
          {info.manual !== undefined
            ? <button className="wb-trader-auto" onClick={() => shop.setLevel(info.key, null)} title={uiText('Вернуть уровень из игры')}>{uiText('вручную')} ×</button>
            : <small className="wb-trader-auto">{uiText('авто')}</small>}
        </li>)}
      </ul>
    </div>}
  </div>
}

// ------------------------------------------------------------------------------------------------------------
// Weapon index (left): every weapon, by caliber or by class, with a search.
// ------------------------------------------------------------------------------------------------------------

/** «Оружие»: the weapon list opens over the board, so the board itself keeps the whole width. */
function WeaponChooser({ weapon, children }: { weapon: Weapon; children: (close: () => void) => ReactNode }) {
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
  // Closed by the pick itself (owner, 18.10.2026: «при нажатии оружие не переключается» — closing it in the capture phase
  // unmounted the list before the row's own click ran).
  return <div className={`wb-chooser${open ? ' is-open' : ''}`} ref={ref}>
    <button className="button small wb-chooser-button" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <PartIcon src={weaponIcon(weapon)} /><span>{weapon.shortName}</span><ChevronDown size={14} />
    </button>
    {open && <div className="wb-chooser-panel">{children(() => setOpen(false))}</div>}
  </div>
}

function WeaponIndex({ weapons, catalog, selected, saved, onPick }: { weapons: Weapon[]; catalog: GunCatalog; selected: string; saved: SavedBuild[]; onPick: (weapon: Weapon) => void }) {
  const [query, setQuery] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('caliber')
  const { colorOf } = useMemo(() => caliberColors(catalog.ammo), [catalog.ammo])
  const starred = useMemo(() => new Set(saved.filter((entry) => entry.favorite).map((entry) => entry.weaponId)), [saved])
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = weapons.filter((weapon) => !needle || `${weapon.name} ${weapon.shortName} ${prettyCaliber(weapon.caliber)}`.toLowerCase().includes(needle))
    if (grouping === 'favorites') {
      const favorites = rows.filter((weapon) => starred.has(weapon.id))
      return favorites.length ? [['favorites', favorites] as [string, Weapon[]]] : []
    }
    const map = new Map<string, Weapon[]>()
    for (const weapon of rows) {
      const key = grouping === 'caliber' ? weapon.caliber : weapon.weaponClass
      map.set(key, [...(map.get(key) ?? []), weapon])
    }
    return [...map.entries()].sort((a, b) => grouping === 'caliber'
      ? prettyCaliber(a[0]).localeCompare(prettyCaliber(b[0]), 'en', { numeric: true })
      : Object.keys(CLASS_NAMES).indexOf(a[0]) - Object.keys(CLASS_NAMES).indexOf(b[0]))
  }, [grouping, query, starred, weapons])
  return <nav className="wb-index" aria-label={uiText('Оружие')}>
    <label className="wb-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти оружие…')} aria-label={uiText('Найти оружие')} /></label>
    <div className="wb-segment" role="tablist" aria-label={uiText('Группировка')}>
      {(['caliber', 'class', 'favorites'] as Grouping[]).map((value) => <button key={value} role="tab" aria-selected={grouping === value} className={grouping === value ? 'is-active' : ''} onClick={() => setGrouping(value)}>
        {value === 'favorites' && <Star size={12} aria-hidden="true" />}{uiText(value === 'caliber' ? 'Калибр' : value === 'class' ? 'Класс' : 'Избранное')}
      </button>)}
    </div>
    {groups.map(([key, rows]) => <div className="wb-index-group" key={key}>
      {grouping !== 'favorites' && <h3>{grouping === 'caliber' ? <><i className="wb-caliber-dot" style={{ background: colorOf(key) }} />{prettyCaliber(key)}</> : uiText(CLASS_NAMES[key] ?? rows[0].weaponClassName ?? key)}<span>{rows.length}</span></h3>}
      {rows.map((weapon) => <button key={weapon.id} className={`wb-index-row${weapon.id === selected ? ' is-active' : ''}`} onClick={() => onPick(weapon)} aria-current={weapon.id === selected ? 'true' : undefined}>
        <PartIcon src={weaponIcon(weapon)} />
        <span className="wb-index-name">{weapon.shortName}</span>
        {starred.has(weapon.id) && grouping !== 'favorites' && <Star size={12} className="wb-index-star" aria-label={uiText('Есть в избранном')} />}
        <span className="wb-index-caliber">{grouping === 'caliber' ? uiText(CLASS_NAMES[weapon.weaponClass] ?? '').split(' ')[0] : prettyCaliber(weapon.caliber)}</span>
      </button>)}
    </div>)}
    {!groups.length && <p className="muted wb-index-empty">{uiText(grouping === 'favorites' && !query.trim() ? 'Нет избранного: отметьте сборку ★' : 'Оружие не найдено.')}</p>}
  </nav>
}

// ------------------------------------------------------------------------------------------------------------
// Stats: the main bars against the default build, then handling and price.
// ------------------------------------------------------------------------------------------------------------


function StatBars({ stats, stock, weapon }: { stats: BuildStats; stock: BuildStats; weapon: Weapon }) {
  // No MOA (owner, 17.10.2026: «моа не добавляем»): recoil and ergonomics decide a build.
  const rows: Array<{ label: string; value: string; fill: number; stockFill: number; delta: number; better: 'lower' | 'higher'; digits?: number }> = [
    { label: 'Эргономика', value: String(stats.ergonomics), fill: stats.ergonomics / 100, stockFill: stock.ergonomics / 100, delta: stats.ergonomicsRaw - stock.ergonomicsRaw, better: 'higher', digits: Math.round(Math.abs(stats.ergonomicsRaw - stock.ergonomicsRaw) * 10) % 10 ? 1 : 0 },
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

/** The interface's word first: the game's names would make «Прицеливание» the quest «Aim Drills» in English. */
const handlingLabel = (label: string) => { const shown = uiText(label); return shown === label ? label : exactUiText(label) ?? shown }

/** Aiming and arm stamina; the price is only in «Список покупок» (owner, 28.10.2026: «итог… это не пиши… Пишется только общая цена»). */
function HandlingRow({ stats }: { stats: BuildStats }) {
  const items: Array<[string, string, string?]> = [
    // Owner, 17.10.2026: EvoErgo, «Перевес», «Вес» and «Размер» went; aiming time and arm stamina stay.
    ['Прицеливание', `${stats.adsTime.toFixed(2)} ${uiText('сек.')}`],
    ['Выносливость рук', `${stats.armStamina} ${uiText('сек.')}`],
  ]
  return <div className="wb-handling">
    {items.map(([label, value, tone]) => <span className="wb-chip" key={label}><small>{handlingLabel(label)}</small><strong className={tone}>{value}</strong></span>)}
    <span className="wb-handling-note">{uiText('Прицеливание и выносливость — оценка по модели сообщества.')}</span>
  </div>
}

// ------------------------------------------------------------------------------------------------------------
// The board: the weapon in the middle, every slot around it where it sits on the gun (src/arsenal/boardLayout.ts).
// ------------------------------------------------------------------------------------------------------------


// ------------------------------------------------------------------------------------------------------------
// Right panel: the items of the chosen slot with what each changes.
// ------------------------------------------------------------------------------------------------------------

const offerLabel = (offer: GunOffer) => offer.vendor === 'flea-market' ? uiText('Барахолка') : `${offer.vendorName} ${offer.minTraderLevel ?? 1}`
const ALL_MODULES_KEY = 'raidos-wb-all-modules'
function readAllModules() {
  try { return localStorage.getItem(ALL_MODULES_KEY) === '1' } catch { return false }
}

// ------------------------------------------------------------------------------------------------------------
// Saving: a name, the star, and the list of this mode's builds.
// ------------------------------------------------------------------------------------------------------------

function SaveControls({ build, weapon, code, savedHere, onSaved, onPublished }: { build: Build; weapon: Weapon; code: string; savedHere?: SavedBuild; onSaved: (list: SavedBuild[]) => void; onPublished: () => void }) {
  const { raidMode } = useAppState()
  // «Сохранить» keeps the build here; «Опубликовать» publishes it to «Сборки игроков» for every player of this mode.
  const [naming, setNaming] = useState<'save' | 'publish' | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  // The build last published from here (owner, 21.11.2026: «при нажатии «Опубликовать» кнопка зависает… потом она куда-то исчезает,
  // опять появляется кнопка, и только после этого ещё раз нажимаешь»): the request may wait a few seconds behind the app's syncs, and
  // the form then closed with a notice gone in 2.6 s, so the first press looked lost and the build went out twice. Now the button
  // turns «Публикуем…» with a spinner, and «Опубликовано» stays on it while the build is the same.
  const [published, setPublished] = useState('')
  const isPublished = Boolean(code) && published === code
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(''), 5000); return () => window.clearTimeout(timer) }, [notice])
  const finalName = () => name.trim() || savedHere?.name || weapon.shortName
  const save = (favorite: boolean) => {
    if (!code) return
    // an opened build changed and given a name of its own is kept as a new one beside it; otherwise the opened one is saved over
    const asNew = savedHere && savedHere.code !== code && name.trim() && name.trim() !== savedHere.name
    onSaved(saveBuild(raidMode, { id: asNew ? undefined : savedHere?.id, name: finalName(), weaponId: build.weaponId, code, ...(favorite || (!asNew && savedHere?.favorite) ? { favorite: true as const } : {}) }))
    setNaming(null)
    setNotice(favorite ? 'Добавлено в избранное' : 'Сохранено')
  }
  const publish = async () => {
    if (!code || busy) return
    setBusy(true)
    try {
      await publishBuild(raidMode, { weaponId: build.weaponId, name: finalName(), code })
      setNaming(null)
      setPublished(code)
      setNotice('Опубликовано в «Сборки игроков»')
      onPublished()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось опубликовать'
      // the same build is there already (an earlier press went through): it is published
      if (/уже в каталоге/.test(message)) { setNaming(null); setPublished(code) }
      setNotice(message)
    } finally {
      setBusy(false)
    }
  }
  const star = () => {
    if (savedHere) { onSaved(toggleSavedFavorite(raidMode, savedHere.id)); setNotice(savedHere.favorite ? 'Убрано из избранного' : 'Добавлено в избранное') }
    else save(true)
  }
  const open = (mode: 'save' | 'publish') => { setName(savedHere?.name ?? ''); setNaming(mode) }
  return <div className="wb-save">
    {notice && <span className="wb-save-notice" role="status">{uiText(notice)}</span>}
    {naming
      ? <form className="wb-save-form" onSubmit={(event) => { event.preventDefault(); if (naming === 'save') save(false); else void publish() }}>
        <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder={uiText('Название сборки')} aria-label={uiText('Название сборки')} autoFocus maxLength={48} />
        <button className="button small primary" type="submit" disabled={busy} aria-busy={busy}>{naming === 'save' ? <><Save size={13} />{uiText('Сохранить')}</> : busy ? <><LoaderCircle className="spin" size={13} aria-hidden="true" />{uiText('Публикуем…')}</> : <><Upload size={13} />{uiText('Опубликовать')}</>}</button>
        <button className="icon-button" type="button" onClick={() => setNaming(null)} aria-label={uiText('Отмена')}><X size={14} /></button>
      </form>
      : <>
        <button className="button small primary" onClick={() => open('save')} disabled={!code}><Save size={13} />{uiText(savedHere?.code === code ? 'Сохранено' : 'Сохранить')}</button>
        {isPublished
          ? <button className="button small is-done" disabled title={uiText('Эта сборка уже в «Сборки игроков»')}><Check size={13} />{uiText('Опубликовано')}</button>
          : <button className="button small" onClick={() => open('publish')} disabled={!code} title={uiText('Выложить сборку в «Сборки игроков» для всех игроков')}><Upload size={13} />{uiText('Опубликовать')}</button>}
      </>}
    <button className={`icon-button wb-star${savedHere?.favorite ? ' is-starred' : ''}`} onClick={star} disabled={!code} aria-pressed={Boolean(savedHere?.favorite)} title={uiText(savedHere?.favorite ? 'Убрать из избранного' : 'В избранное')} aria-label={uiText(savedHere?.favorite ? 'Убрать из избранного' : 'В избранное')}><Star size={15} /></button>
  </div>
}

/**
 * «Избранные» (owner, 19.11.2026: «Мои сборки переименуем в избранные… по нажатию оружия… из этого АКМ выезжает вниз список моих
 * сборок. Эти названия можно изменять… я нажимаю ниже оружие… АКМ у меня складывается, и раскладываются сборки»): the weapons of
 * the saved builds of this mode (those with a starred build first, then the newest), one open at a time with its builds sliding
 * out under it; a build opens on the board, is renamed in place, and the one opened, once changed, is saved over by «Сохранить».
 */
function FavoriteWeapons({ saved, catalog, current, weaponId, openedId, onLoad, onChange, onSaveOpened }: {
  saved: SavedBuild[]; catalog: GunCatalog; current: string; weaponId: string; openedId: string | null
  onLoad: (entry: SavedBuild) => void; onChange: (list: SavedBuild[]) => void; onSaveOpened: () => void
}) {
  const { raidMode } = useAppState()
  const groups = useMemo(() => {
    const byWeapon = new Map<string, SavedBuild[]>()
    for (const entry of saved) byWeapon.set(entry.weaponId, [...(byWeapon.get(entry.weaponId) ?? []), entry])
    const order = (list: SavedBuild[]) => [...list].sort((a, b) => Number(Boolean(b.favorite)) - Number(Boolean(a.favorite)) || b.savedAt.localeCompare(a.savedAt))
    return [...byWeapon].map(([id, list]) => ({ id, builds: order(list) }))
      .sort((a, b) => Number(b.builds.some((entry) => entry.favorite)) - Number(a.builds.some((entry) => entry.favorite)) || b.builds[0]!.savedAt.localeCompare(a.builds[0]!.savedAt))
  }, [saved])
  // until the player opens or folds one himself, the weapon on the board is the one open (if it has builds)
  const [picked, setOpen] = useState<string | null | undefined>(undefined)
  const open = picked !== undefined ? picked : saved.some((entry) => entry.weaponId === weaponId) ? weaponId : null
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const rename = () => { if (renaming) { onChange(renameSavedBuild(raidMode, renaming.id, renaming.name)); setRenaming(null) } }
  if (!saved.length) return <p className="muted wb-none">{uiText('Сохраните сборку — её оружие появится здесь.')}</p>
  return <ul className="wb-favorites">
    {groups.map(({ id, builds }) => {
      const gun = catalog.weapons.find((weapon) => weapon.id === id)
      const isOpen = open === id
      return <li key={id} className={`wb-favorite${isOpen ? ' is-open' : ''}`}>
        <button type="button" className="wb-favorite-weapon" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : id)}>
          <PartIcon src={weaponIcon(gun)} />
          <span><strong>{gun?.shortName ?? '—'}</strong><small>{builds.length} {uiText(buildsWord(builds.length))}</small></span>
          {builds.some((entry) => entry.favorite) && <Star size={13} className="wb-favorite-star" aria-hidden="true" />}
          <ChevronDown size={15} className="wb-favorite-chevron" aria-hidden="true" />
        </button>
        {/* the builds slide out under the weapon; the weapons below move down by as much */}
        <div className="wb-favorite-builds" inert={!isOpen}>
          <ul>
            {builds.map((entry) => {
              const changed = entry.id === openedId && entry.code !== current
              return <li key={entry.id} className={entry.code === current || entry.id === openedId ? 'is-current' : undefined}>
                {renaming?.id === entry.id
                  ? <form className="wb-favorite-rename" onSubmit={(event) => { event.preventDefault(); rename() }}>
                    <input className="input" value={renaming.name} onChange={(event) => setRenaming({ id: entry.id, name: event.target.value })} onKeyDown={(event) => { if (event.key === 'Escape') setRenaming(null) }} aria-label={uiText('Название сборки')} autoFocus maxLength={48} />
                    <button type="submit" className="icon-button" aria-label={uiText('Готово')} title={uiText('Готово')}><Check size={14} /></button>
                  </form>
                  : <button type="button" className="wb-saved-open" onClick={() => onLoad(entry)} title={uiText('Открыть')}>
                    <span><strong>{entry.name}</strong><small>{new Date(entry.savedAt).toLocaleDateString()}</small></span>
                  </button>}
                {changed && <button type="button" className="button small primary" onClick={onSaveOpened}><Save size={12} />{uiText('Сохранить')}</button>}
                <button type="button" className="icon-button" onClick={() => setRenaming({ id: entry.id, name: entry.name })} aria-label={uiText('Переименовать')} title={uiText('Переименовать')}><Pencil size={13} /></button>
                <button type="button" className={`icon-button${entry.favorite ? ' is-starred' : ''}`} onClick={() => onChange(toggleSavedFavorite(raidMode, entry.id))} aria-pressed={Boolean(entry.favorite)} aria-label={uiText(entry.favorite ? 'Убрать из избранного' : 'В избранное')} title={uiText(entry.favorite ? 'Убрать из избранного' : 'В избранное')}><Star size={13} /></button>
                <button type="button" className="icon-button" onClick={() => onChange(deleteSavedBuild(raidMode, entry.id))} aria-label={uiText('Удалить')} title={uiText('Удалить')}><Trash2 size={13} /></button>
              </li>
            })}
          </ul>
        </div>
      </li>
    })}
  </ul>
}

/**
 * «Сборки игроков» (owner, 17.10.2026; a tab of its own since 04.11.2026): builds players published with «Опубликовать», of the
 * open weapon in this mode, the most liked first. A build opens on the board like a saved one; one like per player.
 */
const TIER_NAMES: Record<BuildTier, string> = { budget: 'Сборка до 100 000 ₽', middle: 'Сборка до 200 000 ₽', top: 'Топовая сборка' }
/** Ready builds solved, by weapon, access, prices and the owner's builds (a handful kept: a new solve takes a second). */
const autoBuildsMemo = new Map<string, TieredBuild[]>()
/** The ready builds follow the flea at most this often: a big weapon's three solves take a second or two. */
const SOLVE_EVERY_MS = 5 * 60_000

/**
 * «Готовые сборки», the program's builds of the open weapon (owner, 18.10.2026; a tab of its own since 04.11.2026): the budget,
 * middle and top builds of the optimizer (src/arsenal/tieredBuilds.ts) for the player's trader levels and flea access,
 * at the flea's current prices (solved again every SOLVE_EVERY_MS). A tier the owner set by hand shows his build
 * (src/arsenal/ownerBuilds.ts), and what his edits taught leans the rest. Solved tier by tier after the list is drawn.
 * Only the builds here (owner, 06.11.2026: «удали это все. Оставь только сборки»): the buttons that set a tier by hand are gone.
 */
function AutoBuilds({ catalog, weapon, access, current, onLoad }: { catalog: GunCatalog; weapon: Weapon; access: PurchaseAccess; current: string; onLoad: (entry: SavedBuild) => void }) {
  const ownerBuilds = useOwnerBuilds()
  const mine = ownerBuilds.builds.filter((entry) => entry.weaponId === weapon.id)
  // The catalogue changes with the flea every minute; the builds are solved again only every SOLVE_EVERY_MS of it.
  const { raidMode } = useAppState()
  const live = useLivePrices(raidMode)
  const pricesEpoch = live?.updatedAt ? Math.floor(live.updatedAt / SOLVE_EVERY_MS) : 0
  const owner = useMemo(() => Object.fromEntries(ownerBuilds.builds.filter((entry) => entry.weaponId === weapon.id)
    .flatMap((entry) => { const build = decodeBuild(entry.code, catalog); return build ? [[entry.tier, build]] : [] })) as Partial<Record<BuildTier, Build>>, [catalog, ownerBuilds.builds, weapon.id])
  const learnedKey = [...ownerBuilds.learned].map(([id, net]) => `${id}${net}`).sort().join(',')
  const key = `${weapon.id}:${access.flea ? 1 : 0}:${access.playerLevel ?? ''}:${JSON.stringify(access.traderLevels ?? {})}:${access.traderLevel}:${pricesEpoch}:${mine.map((entry) => `${entry.tier}${entry.updatedAt}`).join('')}:${learnedKey.length}:${learnedKey.slice(0, 64)}`
  const [solved, setSolved] = useState<{ key: string; builds: TieredBuild[] } | null>(null)
  const builds = autoBuildsMemo.get(key) ?? (solved?.key === key ? solved.builds : undefined)
  useEffect(() => {
    if (autoBuildsMemo.has(key)) return
    let alive = true
    const done: TieredBuild[] = []
    let index = 0
    let timer = 0
    // A tier per turn: the page stays responsive between the solves.
    const step = () => {
      if (!alive) return
      const tier = BUILD_TIERS[index++]
      if (tier) {
        try { const result = buildableWeapon(weapon) ? solveTier(weapon, catalog, tier, { access, owner, learned: ownerBuilds.learned }) : undefined; if (result) done.push(result) } catch { /* no ready build of this tier */ }
        timer = window.setTimeout(step, 0)
        return
      }
      if (autoBuildsMemo.size > 40) autoBuildsMemo.delete(autoBuildsMemo.keys().next().value!)
      autoBuildsMemo.set(key, done)
      setSolved({ key, builds: done })
    }
    timer = window.setTimeout(step, 30)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [access, catalog, key, owner, ownerBuilds.learned, weapon])

  return <div className="wb-auto">
    {!builds && <p className="muted wb-none" role="status"><RefreshCw className="spin" size={13} /> {uiText('Подбираем модули…')}</p>}
    {builds && !builds.length && <p className="muted wb-none">{uiText('Для этого оружия готовых сборок нет.')}</p>}
    {builds && builds.length > 0 && <ul className="wb-saved-list wb-auto-list">
      {builds.map((entry) => {
        const code = encodeBuild(entry.build, catalog) ?? ''
        return <li key={entry.tier} className={code && code === current ? 'is-current' : undefined}>
          <button className="wb-saved-open" disabled={!code} onClick={() => onLoad({ id: '', name: `${weapon.shortName} · ${uiText(TIER_NAMES[entry.tier])}`, weaponId: weapon.id, code, savedAt: '' })} title={uiText('Открыть')}>
            <span className="wb-auto-tier">{uiText(TIER_NAMES[entry.tier])}</span>
            <span><strong>{uiText('Отдача')} {Math.round(entry.stats.recoilVertical)} · {uiText('Эрг.')} {Math.round(entry.stats.ergonomics)}</strong><small>{formatRub(entry.cost.total)} {uiText('за модули')}</small></span>
          </button>
        </li>
      })}
    </ul>}
  </div>
}

/**
 * What a player's build costs on top of the weapon (owner, 06.11.2026: «программа смотрит модули, которые они взяли, и по этим
 * модулям берет цену, без учета оружия»): the sum its «Список покупок» shows once it is open, for this player's access.
 */
function modulesCost(code: string, weapon: Weapon | undefined, catalog: GunCatalog, access: PurchaseAccess) {
  const build = weapon ? decodeBuild(code, catalog) : null
  return build && weapon ? computeExtraCost(build, presetBuild(weapon, catalog).build, catalog, access) : undefined
}

function PlayerBuilds({ catalog, weapon, access, current, onLoad }: { catalog: GunCatalog; weapon: Weapon; access: PurchaseAccess; current: string; onLoad: (entry: SavedBuild) => void }) {
  const { raidMode } = useAppState()
  const [state, setState] = useState<{ key: string; builds: SharedBuild[]; total: number; error?: string } | null>(null)
  const key = `${raidMode}:${weapon.id}`
  const load = useCallback(() => {
    let alive = true
    listSharedBuilds(raidMode, { weaponId: weapon.id, sort: 'top' })
      .then((page) => { if (alive) setState({ key, builds: page.builds, total: page.total }) })
      .catch((error: unknown) => { if (alive) setState({ key, builds: [], total: 0, error: error instanceof Error ? error.message : 'Сервер недоступен' }) })
    return () => { alive = false }
  }, [key, raidMode, weapon.id])
  useEffect(() => load(), [load])
  const loading = state?.key !== key
  const update = (id: string, change: Partial<SharedBuild> | null) => setState((current) => current && ({ ...current, builds: change ? current.builds.map((entry) => entry.id === id ? { ...entry, ...change } : entry) : current.builds.filter((entry) => entry.id !== id), total: change ? current.total : current.total - 1 }))
  const like = async (entry: SharedBuild) => {
    try { update(entry.id, await toggleBuildLike(entry.id)) } catch (error) { setState((current) => current && ({ ...current, error: error instanceof Error ? error.message : 'Не удалось' })) }
  }
  const remove = async (entry: SharedBuild) => {
    if (!window.confirm(uiText('Убрать сборку из каталога?'))) return
    try { await removeSharedBuild(entry.id); update(entry.id, null) } catch (error) { setState((current) => current && ({ ...current, error: error instanceof Error ? error.message : 'Не удалось' })) }
  }
  const removable = (entry: SharedBuild) => entry.mine || isOwnerApp()
  // A row without the bin keeps its place, so the columns stand level (owner, 06.11.2026).
  const anyRemovable = Boolean(state?.builds.some(removable))
  return <>
    {state?.error && <p className="wb-import-bad" role="alert">{uiText(state.error)}</p>}
    {loading && <p className="muted wb-none" role="status"><RefreshCw className="spin" size={13} /> {uiText('Загружаем каталог…')}</p>}
    {!loading && <ul className="wb-saved-list wb-top-list">
      {state.builds.map((entry, index) => {
        const builtWeapon = catalog.weapons.find((candidate) => candidate.id === entry.weaponId)
        const cost = modulesCost(entry.code, builtWeapon, catalog, access)
        return <li key={entry.id} className={entry.code === current ? 'is-current' : undefined}>
          <span className="wb-top-rank">{index + 1}</span>
          <button className="wb-saved-open" onClick={() => onLoad({ id: '', name: entry.name, weaponId: entry.weaponId, code: entry.code, savedAt: '' })} title={uiText('Открыть')}>
            <PartIcon src={weaponIcon(builtWeapon)} />
            <span className="wb-top-name"><strong>{entry.name}</strong><small>{builtWeapon?.shortName ?? '—'}{entry.author ? ` · ${entry.author}` : ''}</small></span>
            {cost && <span className="wb-top-cost" title={uiText('Цена модулей, без оружия')}><strong>{cost.unavailable.length ? `${uiText('от')} ` : ''}{formatRub(cost.total)}</strong><small>{uiText('за модули')}</small></span>}
          </button>
          <button className={`wb-like${entry.liked ? ' is-liked' : ''}`} onClick={() => void like(entry)} disabled={entry.mine} aria-pressed={entry.liked} title={uiText(entry.mine ? 'Ваша сборка' : entry.liked ? 'Убрать оценку' : 'Нравится')} aria-label={uiText('Нравится')}><Heart size={13} />{entry.likes}</button>
          {removable(entry) ? <button className="icon-button" onClick={() => void remove(entry)} aria-label={uiText('Убрать из каталога')} title={uiText('Убрать из каталога')}><Trash2 size={14} /></button> : anyRemovable && <span className="wb-top-gap" aria-hidden="true" />}
        </li>
      })}
      {!state.builds.length && !state.error && <li className="muted wb-none">{uiText('Для этого оружия сборок пока нет. Соберите и нажмите «Опубликовать».')}</li>}
    </ul>}
  </>
}

// ------------------------------------------------------------------------------------------------------------
// Purchase list: every part, where it is cheapest for the player's access, and the total.
// ------------------------------------------------------------------------------------------------------------

/** A part nobody sells to this player now: what opens it, or that nobody sells it. */
function PartLock({ part, access, locale }: { part: GunPart; access: PurchaseAccess; locale: string }) {
  const questName = useQuestNames()
  const hint = unlockHint(part, access)
  if (!hint) return <small className="is-bad">{uiText(part.noFlea ? 'запрет барахолки' : 'нет в продаже')}</small>
  return <small className="wb-part-lock" title={uiText('Откроется, когда выполнится условие')}><Lock size={10} aria-hidden="true" />{unlockLabel(hint, locale, questName)}</small>
}

/** «Цена оружия»: on or off, remembered on this device; the gun's price by what this player can use now (trading/gunPrice.ts). */
const GUN_PRICE_KEY = 'raid-os-gun-include-weapon-v1'
function useGunPrice(weapon: Weapon, shop: GunsmithAccess) {
  const [on, setOnState] = useState(() => { try { return localStorage.getItem(GUN_PRICE_KEY) === '1' } catch { return false } })
  const setOn = (next: boolean) => {
    setOnState(next)
    try { localStorage.setItem(GUN_PRICE_KEY, next ? '1' : '0') } catch { /* per-viewer convenience only */ }
  }
  const metadata = useOptionalTarkovData()?.data.metadata
  const economy = useEconomySnapshot(shop.mode).data
  const fleaLevel = metadata?.fleaMarket?.minPlayerLevel ?? FLEA_PLAYER_LEVEL
  const choice = useMemo<GunPriceChoice>(() => {
    if (!on) return { kind: 'none' }
    const loyalty = new Map(shop.infos.map((info) => [info.trader.id, info.level]))
    const buyAccess = { loyalty, playerLevel: shop.playerLevel, fleaEnabled: shop.fleaEnabled, fleaLevel, ...(shop.access.taskDone ? { taskDone: shop.access.taskDone } : {}) }
    // a barter may give the bare weapon or its default preset
    const ids = [weapon.id, weapon.defaultPreset?.id].filter((id): id is string => Boolean(id))
    const buy = economy ? ids.map((id) => itemBuyOptions(id, economy, buyAccess)) : []
    return gunPriceChoice(weapon, shop.access, buy)
  }, [economy, fleaLevel, on, shop.access, shop.fleaEnabled, shop.infos, shop.playerLevel, weapon])
  return { on, setOn, choice }
}

/** Which price of the gun went into the total: «цена с барахолки», «цена по бартеру · Механик ур. 2»… */
function gunPriceLabel(choice: GunPriceChoice) {
  if (choice.kind === 'none') return uiText('оружие недоступно')
  if (choice.kind === 'flea') return uiText('цена с барахолки')
  return `${uiText(choice.kind === 'barter' ? 'цена по бартеру' : 'у торговца')} · ${uiText(choice.traderName)} ${uiText('ур.')} ${choice.level}`
}

function PurchaseList({ cost, access, gun }: { cost: BuildCost; access: PurchaseAccess; gun?: { weapon: Weapon; choice: GunPriceChoice } }) {
  const { locale } = useLocale()
  const gunPrice = gun && gun.choice.kind !== 'none' ? gun.choice.price : 0
  return <details className="wb-buy" open>
    <summary><span>{uiText('Список покупок')}</span><small>{cost.lines.length ? `${cost.lines.length} ${uiText('поз.')}` : uiText('только заводские модули')}</small><strong><small>{uiText(gun ? 'Общая цена с оружием' : 'Общая цена')}</small> {formatRub(cost.total + gunPrice)}</strong></summary>
    <p className="wb-note">{uiText('Только модули, добавленные поверх заводской сборки: штатные приходят вместе с оружием.')}</p>
    <table className="wb-buy-table">
      <tbody>{gun && <tr className={`wb-buy-gun${gun.choice.kind === 'none' ? ' is-bad' : ''}`}>
        <td><span className="wb-buy-name"><PartIcon src={weaponIcon(gun.weapon)} />{gun.weapon.shortName}</span></td>
        <td className="dim">{gunPriceLabel(gun.choice)}</td>
        <td className="mono">{gun.choice.kind !== 'none' ? formatRub(gun.choice.price) : '—'}</td>
      </tr>}{cost.lines.map((line, index) => <tr key={`${line.part.id}-${index}`}>
        <td><span className="wb-buy-name"><PartIcon src={line.part.iconLink} />{line.part.name}</span></td>
        <td className="dim">{line.offer ? offerLabel(line.offer) : <PartLock part={line.part} access={access} locale={locale} />}</td>
        <td className="mono">{line.offer ? formatRub(line.offer.priceRUB) : '—'}</td>
      </tr>)}</tbody>
    </table>
    {cost.unavailable.length > 0 && <p className="wb-note is-bad">{uiText('Без цены (бартер, крафт или нужна лояльность выше)')}: {cost.unavailable.length}</p>}
  </details>
}
