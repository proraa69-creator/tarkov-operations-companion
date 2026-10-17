import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, Crosshair, Gauge, Hand, Lightbulb, Package, RefreshCw, Scale, Search, Star, Timer, Wallet, Wind } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { installedParts } from '../arsenal/buildModel'
import { computeStats, type BuildStats, type HandlingOptions } from '../arsenal/buildStats'
import { presetBuild } from '../arsenal/buildModel'
import { formatRub, PartIcon, prettyCaliber } from '../arsenal/gunFormat'
import type { GunCatalog, GunOffer, Weapon } from '../arsenal/gunTypes'
import { BUILD_TIERS, listedWeapon, solveTieredBuilds, type BuildTier, type TieredBuild, type TieredLine } from '../arsenal/tieredBuilds'
import { anchorOf, hasOutline, pictureRatio, slotLabel, type Anchor } from '../arsenal/weaponAnchors'
import { classNotes, pickAmmo, RECOIL_NOTE, weaponNotes } from '../arsenal/buildAdvice'
import { acceptFavorite, favoriteChange, snapshotOf, toggleFavorite, useFavorites } from '../arsenal/buildFavorites'
import { usesDataGateway } from '../data/tarkovApi'
import '../styles/weaponBuilds.css'

/** Categories of «Сборка оружия» (owner, 17.10.2026): every firearm that fires cartridges, in this order. */
const CATEGORIES: Array<[string, string]> = [
  ['assault-rifle', 'Штурмовые винтовки'], ['assault-carbine', 'Штурмовые карабины'], ['smg', 'Пистолеты-пулемёты'],
  ['marksman-rifle', 'Марксманские винтовки'], ['sniper-rifle', 'Болтовые винтовки'], ['shotgun', 'Дробовики'],
  ['machinegun', 'Пулемёты'], ['handgun', 'Пистолеты'], ['revolver', 'Револьверы'],
]
const TIER_NAMES: Record<BuildTier, string> = { budget: 'Бюджетная', middle: 'Средняя', top: 'Топ' }
const TIER_NOTES: Record<BuildTier, string> = {
  budget: 'Самые дешёвые модули с лучшей отдачей и эргономикой за свои деньги',
  middle: 'Заметно лучше за разумную цену',
  top: 'Лучшая сборка; аналог на 1–2 пункта хуже берётся, если он намного дешевле',
}

/**
 * The default build's picture: tarkov.dev's 512 px cut-out in development; in the app our server's copy, which keeps
 * only the inventory (grid) picture so far — same framing, on its dark cell background (blended into the stage).
 */
const gridPictures = () => usesDataGateway()
function pictureUrl(id: string) {
  return gridPictures() ? `https://raidos.app/v1/item-images/${id}-grid.webp` : `https://assets.tarkov.dev/${id}-512.webp`
}

/** A weapon whose default build has no picture: the bare weapon's, else nothing. */
function fallbackPicture(image: HTMLImageElement, weapon: Weapon) {
  const own = pictureUrl(weapon.id)
  if (image.src !== own && weapon.defaultPreset) image.src = own
  else image.style.visibility = 'hidden'
}

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
        <p className="page-subtitle">{uiText('Три готовые сборки на каждое оружие — бюджетная, средняя и топ — только из совместимых модулей, которые продаются у торговцев или на барахолке.')}</p>
      </div>
    </header>
    {query.isLoading && <div className="empty-state" role="status"><div><RefreshCw className="spin" size={26} /><h2>{uiText('Загружаем оружие и модули')}</h2></div></div>}
    {!catalog && query.isError && <div className="empty-state" role="alert"><div><AlertTriangle size={26} /><h2>{uiText('Источник данных недоступен')}</h2><button className="button" onClick={() => void query.refetch()}><RefreshCw size={14} />{uiText('Повторить')}</button></div></div>}
    {catalog && <Builds catalog={catalog} />}
  </div>
}

function Builds({ catalog }: { catalog: GunCatalog }) {
  const { raidMode } = useAppState()
  const [params, setParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const weapons = useMemo(() => catalog.weapons.filter((weapon) => listedWeapon(weapon, catalog, hasOutline)).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [catalog])
  const favorites = useFavorites(raidMode)
  const selected = weapons.find((weapon) => weapon.id === params.get('weapon')) ?? weapons.find((weapon) => weapon.shortName === 'M4A1') ?? weapons[0]
  const tier = (BUILD_TIERS as string[]).includes(params.get('tier') ?? '') ? params.get('tier') as BuildTier : 'middle'
  const open = (weaponId: string, nextTier: BuildTier = 'middle') => setParams((current) => {
    const next = new URLSearchParams(current)
    next.set('weapon', weaponId); next.set('tier', nextTier)
    return next
  }, { replace: true })
  const needle = query.trim().toLowerCase()
  const matches = (weapon: Weapon) => !needle || weapon.name.toLowerCase().includes(needle) || weapon.shortName.toLowerCase().includes(needle)

  return <div className="wb-layout">
    <aside className="panel wb-index" aria-label={uiText('Оружие')}>
      <label className="wb-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Найти оружие…')} aria-label={uiText('Найти оружие')} />
      </label>
      {favorites.length > 0 && !needle && <section className="wb-index-group is-favorites">
        <h3><Star size={12} aria-hidden="true" /> {uiText('Избранное')}</h3>
        {favorites.map((favorite) => {
          const weapon = weapons.find((entry) => entry.id === favorite.weaponId)
          if (!weapon) return null
          const active = weapon.id === selected?.id && favorite.tier === tier
          return <button key={`${favorite.weaponId}-${favorite.tier}`} type="button" className={`wb-index-row${active ? ' is-active' : ''}`} onClick={() => open(weapon.id, favorite.tier)}>
            <span className="wb-index-name">{weapon.shortName}</span>
            <span className={`wb-index-tier is-${favorite.tier}`}>{uiText(TIER_NAMES[favorite.tier])}</span>
          </button>
        })}
      </section>}
      {CATEGORIES.map(([id, name]) => {
        const list = weapons.filter((weapon) => weapon.weaponClass === id && matches(weapon))
        if (!list.length) return null
        return <section key={id} className="wb-index-group">
          <h3>{uiText(name)} <span>{list.length}</span></h3>
          {list.map((weapon) => (
            <button key={weapon.id} type="button" className={`wb-index-row${weapon.id === selected?.id ? ' is-active' : ''}`} onClick={() => open(weapon.id, tier)}>
              <span className="wb-index-name">{weapon.shortName}</span>
              <span className="wb-index-caliber">{prettyCaliber(weapon.caliber)}</span>
              {favorites.some((favorite) => favorite.weaponId === weapon.id) && <Star size={11} className="wb-index-star" aria-label={uiText('В избранном')} />}
            </button>
          ))}
        </section>
      })}
      {needle && !weapons.some(matches) && <p className="dim wb-index-empty">{uiText('Ничего не нашлось')}</p>}
    </aside>
    {selected && <WeaponBuilds key={selected.id} weapon={selected} catalog={catalog} tier={tier} onTier={(next) => open(selected.id, next)} />}
  </div>
}

function WeaponBuilds({ weapon, catalog, tier, onTier }: { weapon: Weapon; catalog: GunCatalog; tier: BuildTier; onTier: (tier: BuildTier) => void }) {
  const { raidMode } = useAppState()
  const favorites = useFavorites(raidMode)
  // ~1 ms for most weapons, up to ~0.3 s for the AR-15 family: after the first paint, so the click is answered at once.
  const [builds, setBuilds] = useState<TieredBuild[] | null>(null)
  useEffect(() => {
    const timer = window.setTimeout(() => setBuilds(solveTieredBuilds(weapon, catalog)), 30)
    return () => window.clearTimeout(timer)
  }, [weapon, catalog])
  const [handlingOptions, setHandlingOptions] = useHandlingOptions()
  const preset = useMemo(() => presetBuild(weapon, catalog).build, [weapon, catalog])
  const stock = useMemo(() => computeStats(preset, weapon, catalog), [preset, weapon, catalog])
  const build = builds?.find((entry) => entry.tier === tier) ?? builds?.[0]
  const pictureId = weapon.defaultPreset?.id ?? weapon.id
  const current = build ? snapshotOf(build, catalog) : undefined
  const saved = favorites.find((favorite) => favorite.weaponId === weapon.id && favorite.tier === build?.tier)
  const change = saved && current ? favoriteChange(saved, current) : undefined

  return <section className="panel wb-weapon">
    <div className="wb-weapon-head">
      <div>
        <h2>{weapon.name}</h2>
        <div className="wb-tags"><span className="tag">{weapon.weaponClassName}</span><span className="tag">{prettyCaliber(weapon.caliber)}</span>{weapon.fireRate > 0 && <span className="tag">{weapon.fireRate} {uiText('выстр/мин')}</span>}</div>
      </div>
      {current && <button type="button" className={`button small wb-favorite${saved ? ' is-saved' : ''}`} aria-pressed={Boolean(saved)} onClick={() => toggleFavorite(raidMode, current)}>
        <Star size={14} aria-hidden="true" /> {uiText(saved ? 'В избранном' : 'В избранное')}
      </button>}
    </div>
    <div className="wb-tiers" role="tablist" aria-label={uiText('Сборка')}>
      {BUILD_TIERS.map((entry) => {
        const tierBuild = builds?.find((candidate) => candidate.tier === entry)
        return <button key={entry} type="button" role="tab" aria-selected={entry === tier} className={`wb-tier is-${entry}${entry === tier ? ' is-active' : ''}`} onClick={() => onTier(entry)} disabled={builds !== null && !tierBuild}>
          <span className="wb-tier-name">{uiText(TIER_NAMES[entry])}</span>
          <span className="wb-tier-price">{tierBuild ? formatRub(tierBuild.cost.total) : builds ? '—' : '…'}</span>
          {tierBuild && <span className="wb-tier-stats">{uiText('эрг.')} {tierBuild.stats.ergonomics} · {uiText('отдача')} {tierBuild.stats.recoilVertical}</span>}
        </button>
      })}
    </div>
    {change && saved && current && <div className="wb-change" role="status">
      <RefreshCw size={14} aria-hidden="true" />
      <span>{uiText('Сборка изменилась с')} {new Date(saved.savedAt).toLocaleDateString('ru-RU')}{change.added.length + change.removed.length > 0 && <>: {uiText('модулей заменено')} — {Math.max(change.added.length, change.removed.length)}</>}{Math.abs(change.priceDelta) >= 1 && <>, {uiText('цена')} {change.priceDelta > 0 ? '+' : '−'}{formatRub(Math.abs(change.priceDelta))}</>}{change.ergonomicsDelta !== 0 && <>, {uiText('эргономика')} {change.ergonomicsDelta > 0 ? '+' : ''}{change.ergonomicsDelta}</>}</span>
      <button type="button" className="button small ghost" onClick={() => acceptFavorite(raidMode, current)}>{uiText('Понятно')}</button>
    </div>}
    {!builds && <div className="wb-solving" role="status"><RefreshCw className="spin" size={16} /> {uiText('Подбираем модули…')}</div>}
    {build && <>
      {[...classNotes(weapon), ...weaponNotes(weapon)].length > 0 && <ul className="wb-advice">{[...classNotes(weapon), ...weaponNotes(weapon)].map((note) => <li key={note}><Lightbulb size={13} aria-hidden="true" /> {uiText(note)}</li>)}</ul>}
      <p className="wb-tier-note">{uiText(TIER_NOTES[build.tier])}{build.purchase === 'found' && <> · <strong>{uiText('оружие не продаётся — в цене только модули')}</strong></>}{build.purchase === 'preset' && <> · {uiText('покупается заводская сборка, её модули уже в цене')}</>}</p>
      <WeaponStage key={`${weapon.id}-${build.tier}`} weapon={weapon} build={build} catalog={catalog} pictureId={pictureId} />
      <StatsRow build={build} stock={stock} handling={computeStats(build.build, weapon, catalog, pickAmmo(weapon, catalog.ammo, build.tier)?.ammo, handlingOptions)} />
      <HandlingSettings value={handlingOptions} onChange={setHandlingOptions} />
      <AmmoRow weapon={weapon} catalog={catalog} tier={build.tier} />
      <ShoppingList build={build} catalog={catalog} />
      <p className="wb-data-note">{uiText('Цены барахолки — средние за сутки; сборки пересчитываются при каждом обновлении данных игры')} · {uiText('данные от')} {new Date(catalog.loadedAt).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</p>
    </>}
  </section>
}

/** The round to load for the tier (src/arsenal/buildAdvice.ts). */
function AmmoRow({ weapon, catalog, tier }: { weapon: Weapon; catalog: GunCatalog; tier: BuildTier }) {
  const pick = pickAmmo(weapon, catalog.ammo, tier)
  if (!pick) return null
  return <div className="wb-ammo">
    <Crosshair size={14} aria-hidden="true" />
    <span>{uiText('Патрон')}:</span>
    <PartIcon src={pick.ammo.iconLink} />
    <strong>{pick.ammo.shortName}</strong>
    <span className="wb-ammo-stats">{uiText('пробитие')} {pick.ammo.penetration} · {uiText('урон')} {pick.ammo.damage}{pick.ammo.projectileCount > 1 ? `×${pick.ammo.projectileCount}` : ''}</span>
    <span className="wb-ammo-price"><Seller offer={pick.offer} /> {formatRub(pick.offer.priceRUB)} {uiText('за шт.')}</span>
  </div>
}

/** Everything to buy for the build, mounts included, in installation order. */
function ShoppingList({ build, catalog }: { build: TieredBuild; catalog: GunCatalog }) {
  const parts = installedParts(build.build, catalog)
  return <details className="wb-list">
    <summary>{uiText('Список покупок')} · {parts.length + 1} {uiText('поз.')}</summary>
    <table>
      <tbody>
        {build.cost.lines.map((line, index) => {
          const slot = index === 0 ? null : parts[index - 1]?.path.at(-1)
          return <tr key={`${index}-${line.part.id}`}>
            <td><PartIcon src={line.part.iconLink} /></td>
            <td className="wb-list-slot">{slot ? uiText(slotLabel(slot)) : uiText(build.purchase === 'preset' ? 'Заводская сборка' : 'Оружие')}</td>
            <td>{line.part.name}</td>
            <td>{line.included ? uiText('в комплекте') : line.offer ? <Seller offer={line.offer} /> : uiText(index === 0 && build.purchase === 'found' ? 'только из рейда' : 'нет в продаже')}</td>
            <td className="wb-list-price">{line.offer ? formatRub(line.offer.priceRUB) : '—'}</td>
          </tr>
        })}
      </tbody>
    </table>
  </details>
}

function StatsRow({ build, stock, handling }: { build: TieredBuild; stock: ReturnType<typeof computeStats>; handling: BuildStats }) {
  const { stats } = build
  const delta = (value: number, base: number, lowerBetter = false) => {
    const diff = Math.round(value - base)
    if (!diff) return null
    const good = lowerBetter ? diff < 0 : diff > 0
    return <small className={good ? 'wb-better' : 'wb-worse'}>{diff > 0 ? '+' : ''}{diff}</small>
  }
  const estimate = uiText('Оценка по модели сообщества игроков (подбор по замерам в игре), не цифра из игры.')
  return <>
    <div className="wb-stats">
      <div className="wb-stat"><Gauge size={15} /><span>{uiText('Эргономика')}</span><strong>{stats.ergonomics}</strong>{delta(stats.ergonomics, stock.ergonomics)}</div>
      <div className="wb-stat" title={uiText(`С патроном сборки: ${handling.recoilVertical}; без патрона (как в игре): ${handling.recoilVerticalNoAmmo}`)}><Crosshair size={15} /><span>{uiText('Верт. отдача')}</span><strong>{stats.recoilVertical}</strong>{delta(stats.recoilVertical, stock.recoilVertical, true)}</div>
      <div className="wb-stat"><Crosshair size={15} /><span>{uiText('Гориз. отдача')}</span><strong>{stats.recoilHorizontal}</strong>{delta(stats.recoilHorizontal, stock.recoilHorizontal, true)}</div>
      <div className="wb-stat" title={uiText(`Без патронов ${stats.weight.toFixed(2)} кг; с полным магазином ${handling.weightLoaded.toFixed(2)} кг`)}><Scale size={15} /><span>{uiText('Вес')}</span><strong>{stats.weight.toFixed(2)} {uiText('кг')}</strong></div>
      <div className="wb-stat is-price"><Wallet size={15} /><span>{uiText('Итого')}</span><strong>{formatRub(build.cost.total)}</strong></div>
    </div>
    <div className="wb-stats wb-stats-handling">
      {handling.moa !== undefined && <div className="wb-stat" title={uiText('Разброс: центр попаданий ствола × 35, с точностью патрона и модулей. Чем меньше, тем кучнее.')}><Crosshair size={15} /><span>{uiText('Точность')}</span><strong>{handling.moa.toFixed(2)} MOA</strong></div>}
      {handling.velocity !== undefined && <div className="wb-stat" title={uiText(`Начальная скорость патрона с поправкой ствола и дульного устройства (${handling.velocityModifierSum > 0 ? '+' : ''}${handling.velocityModifierSum.toFixed(1)} %).`)}><Wind size={15} /><span>{uiText('Скорость пули')}</span><strong>{Math.round(handling.velocity)} {uiText('м/с')}</strong></div>}
      <div className={`wb-stat${handling.overswing ? ' is-warn' : ''}`} title={`${uiText('EvoErgo: насколько вес сборки (с полным магазином) ниже веса, при котором оружие начинает «заносить» при её эргономике. Ниже нуля — перевес: оружие тяжело водить.')} ${estimate}`}><Activity size={15} /><span>{uiText('EvoErgo')}</span><strong>{handling.evoErgo > 0 ? '+' : ''}{handling.evoErgo.toFixed(1)}</strong>{handling.overswing && <small className="wb-worse">{uiText('перевес')}</small>}<small className="wb-estimate">{uiText('оценка')}</small></div>
      <div className="wb-stat" title={`${uiText('Время вскидки в прицел.')} ${estimate}`}><Timer size={15} /><span>{uiText('Прицеливание')}</span><strong>{handling.adsTime.toFixed(2)} {uiText('с')}</strong><small className="wb-estimate">{uiText('оценка')}</small></div>
      <div className="wb-stat" title={`${uiText('Сколько секунд можно держать прицел, пока не устанут руки (зависит от навыка «Сила»).')} ${estimate}`}><Hand size={15} /><span>{uiText('Выносливость рук')}</span><strong>{Math.round(handling.armStamina)} {uiText('с')}</strong><small className="wb-estimate">{uiText('оценка')}</small></div>
      {handling.headshot100 !== undefined && <div className="wb-stat" title={uiText(`Дальше этой дистанции не каждая пуля попадёт в голову; 80 % попаданий — до ${handling.headshot80} м.`)}><Crosshair size={15} /><span>{uiText('В голову 100 %')}</span><strong>{handling.headshot100} {uiText('м')}</strong></div>}
    </div>
    <small className="wb-stats-note">{uiText('Разница — против заводской сборки')} · {uiText(RECOIL_NOTE)}</small>
  </>
}

const HANDLING_KEY = 'raidos-handling-options-v1'

/** The player's Strength skill and equipment ergonomics penalty for the handling estimates, kept on this device. */
function useHandlingOptions(): [HandlingOptions, (next: HandlingOptions) => void] {
  const [value, setValue] = useState<HandlingOptions>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HANDLING_KEY) ?? 'null') as HandlingOptions | null
      return saved && typeof saved === 'object' ? { strength: clampInt(saved.strength, 0, 51, 50), ergoPenaltyPercent: clampInt(saved.ergoPenaltyPercent, 0, 100, 0) } : { strength: 50, ergoPenaltyPercent: 0 }
    } catch { return { strength: 50, ergoPenaltyPercent: 0 } }
  })
  const update = (next: HandlingOptions) => {
    setValue(next)
    try { localStorage.setItem(HANDLING_KEY, JSON.stringify(next)) } catch { /* storage blocked: this session only */ }
  }
  return [value, update]
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

function HandlingSettings({ value, onChange }: { value: HandlingOptions; onChange: (next: HandlingOptions) => void }) {
  return <details className="wb-handling-settings">
    <summary>{uiText('Параметры персонажа для оценок')}</summary>
    <label><span>{uiText('Навык «Сила»')}</span><input type="number" className="input" min={0} max={51} value={value.strength ?? 50} onChange={(event) => onChange({ ...value, strength: clampInt(Number(event.target.value), 0, 51, 50) })} /></label>
    <label><span>{uiText('Штраф эргономики от снаряжения, %')}</span><input type="number" className="input" min={0} max={100} value={value.ergoPenaltyPercent ?? 0} onChange={(event) => onChange({ ...value, ergoPenaltyPercent: clampInt(Number(event.target.value), 0, 100, 0) })} /></label>
  </details>
}

interface Callout { key: string; label: string; anchor: Anchor; line: TieredLine }

/** Weapon picture with a callout for every part: a dot on the part's place, a line to its card above or below. */
function WeaponStage({ weapon, build, catalog, pictureId }: { weapon: Weapon; build: TieredBuild; catalog: GunCatalog; pictureId: string }) {
  const [active, setActive] = useState<string | null>(null)
  const ratio = pictureRatio(pictureId) ?? 2.5
  const callouts: Callout[] = installedParts(build.build, catalog)
    // A mount carrying something is shown by what it carries (its price is in the total and the list below).
    .filter((entry, _, all) => !(/mount/i.test(entry.part.category ?? '') && all.some((other) => other.path.length > entry.path.length && entry.path.every((id, index) => other.path[index] === id))))
    .map((entry) => ({
      key: entry.path.join('/'),
      label: slotLabel(entry.path.at(-1) ?? ''),
      anchor: anchorOf(entry, pictureId),
      line: build.cost.lines.find((line) => line.part.id === entry.part.id) ?? { part: entry.part },
    }))
  const { top, bottom } = layoutCallouts(callouts)
  // Stage geometry in viewBox units: the picture in the middle band, card rows above and below.
  const W = 1000
  const imageW = 600
  const imageH = imageW / ratio
  const rowH = 96
  const gap = 40
  const H = rowH * 2 + gap * 2 + imageH
  const imageX = (W - imageW) / 2
  const imageY = rowH + gap
  const point = (anchor: Anchor) => ({ x: imageX + anchor.x * imageW, y: imageY + anchor.y * imageH })
  const cardX = (index: number, count: number) => (W / count) * (index + 0.5)
  const weaponLine = build.cost.lines[0]

  return <div className="wb-stage-wrap">
    <div className="wb-stage" style={{ aspectRatio: `${W} / ${H}` }}>
      <img className={`wb-picture${gridPictures() ? ' is-grid' : ''}`} src={pictureUrl(pictureId)} alt={weapon.name}
        style={{ left: `${imageX / W * 100}%`, top: `${imageY / H * 100}%`, width: `${imageW / W * 100}%`, height: `${imageH / H * 100}%` }}
        onError={(event) => fallbackPicture(event.currentTarget, weapon)} />
      <svg className="wb-lines" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
        {[...top.map((callout, index) => ({ callout, x: cardX(index, top.length), y: rowH })), ...bottom.map((callout, index) => ({ callout, x: cardX(index, bottom.length), y: H - rowH }))].map(({ callout, x, y }) => {
          const target = point(callout.anchor)
          const elbowY = y < target.y ? y + gap * 0.5 : y - gap * 0.5
          return <g key={callout.key} className={`wb-line${active === callout.key ? ' is-active' : ''}`}>
            <polyline points={`${x},${y} ${x},${elbowY} ${target.x},${target.y}`} />
            <circle cx={target.x} cy={target.y} r={active === callout.key ? 7 : 5} />
          </g>
        })}
      </svg>
      <div className="wb-row is-top" style={{ height: `${rowH / H * 100}%` }}>
        {top.map((callout) => <PartCard key={callout.key} callout={callout} active={active === callout.key} onHover={setActive} />)}
      </div>
      <div className="wb-row is-bottom" style={{ height: `${rowH / H * 100}%` }}>
        {bottom.map((callout) => <PartCard key={callout.key} callout={callout} active={active === callout.key} onHover={setActive} />)}
      </div>
    </div>
    <div className="wb-buy-weapon">
      <Package size={14} /> {uiText(build.purchase === 'preset' ? 'Заводская сборка' : 'Оружие')}: <strong>{weaponLine.part.shortName}</strong>
      {weaponLine.offer ? <> · <Seller offer={weaponLine.offer} /> · <strong>{formatRub(weaponLine.offer.priceRUB)}</strong></> : <> · {uiText('только из рейда или по бартеру')}</>}
    </div>
  </div>
}

/** Cards above for the top of the weapon, below for its underside; middle parts go to the emptier row; each row left to right. */
function layoutCallouts(callouts: Callout[]) {
  const top: Callout[] = []
  const bottom: Callout[] = []
  const MAX_ROW = 8
  for (const callout of [...callouts].sort((a, b) => (a.anchor.edge === 'middle' ? 1 : 0) - (b.anchor.edge === 'middle' ? 1 : 0))) {
    const wantsTop = callout.anchor.edge === 'top' || (callout.anchor.edge === 'middle' && top.length <= bottom.length)
    if ((wantsTop && top.length < MAX_ROW) || bottom.length >= MAX_ROW) top.push(callout)
    else bottom.push(callout)
  }
  const byX = (a: Callout, b: Callout) => a.anchor.x - b.anchor.x
  return { top: top.sort(byX), bottom: bottom.sort(byX) }
}

function PartCard({ callout, active, onHover }: { callout: Callout; active: boolean; onHover: (key: string | null) => void }) {
  const { line } = callout
  return <div className={`wb-card${active ? ' is-active' : ''}`} onMouseEnter={() => onHover(callout.key)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(callout.key)} onBlur={() => onHover(null)} tabIndex={0}>
    <span className="wb-card-slot">{uiText(callout.label)}</span>
    <span className="wb-card-body">
      <PartIcon src={line.part.iconLink} />
      <span className="wb-card-name" title={line.part.name}>{line.part.shortName}</span>
    </span>
    <span className="wb-card-price">{line.included ? uiText('в комплекте') : line.offer ? <><Seller offer={line.offer} /> {formatRub(line.offer.priceRUB)}</> : uiText('нет в продаже')}</span>
  </div>
}

function Seller({ offer }: { offer: GunOffer }) {
  if (offer.vendor === 'flea-market') return <span className="wb-seller is-flea">{uiText('Барахолка')}</span>
  return <span className="wb-seller">{offer.traderImage && <img src={offer.traderImage} alt="" />}{uiText(offer.vendorName)}{offer.minTraderLevel ? ` ${['I', 'II', 'III', 'IV'][offer.minTraderLevel - 1] ?? ''}` : ''}</span>
}
