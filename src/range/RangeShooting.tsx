import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, RotateCcw, Shuffle, Eraser, Crosshair, Lock } from 'lucide-react'
import { useAppState } from '../state/AppState'
import { useLocale } from '../i18n/LocaleProvider'
import { useGunCatalog } from '../arsenal/gunCatalog'
import { installedParts, presetBuild } from '../arsenal/buildModel'
import { computeStats } from '../arsenal/buildStats'
import { prettyCaliber } from '../arsenal/gunFormat'
import type { Build, GunCatalog } from '../arsenal/gunTypes'
import { useArmorCatalog } from './rangeArmorSource'
import { defaultPlates, kitPieces, likelyKit, randomKit, RANGE_TARGETS, type ArmorCatalog, type KitChoice, type RangeItem, type RangeTargetData } from './rangeArmor'
import { BODY_PARTS, cloneKit, freshBody, PMC_HEALTH, totalHealth, type ArmorPiece, type BodyPart, type BodyState, type Health, type Round } from './rangeModel'
import { figureGeometry, SCHEMATIC, shootOnce, type AimSetup, type Cover, type FiredShot } from './rangeShot'
import { figureLayers } from './rangeFigures'
import { useFigureIndex, useFigureUrls } from './rangeFigureSource'
import { RangeTarget } from './RangeTarget'
import { CLASS_COLORS, markOf, spreadAt } from './rangeView'
import { flightAt } from './rangeFlight'
import { COLLIDER_NAMES, COVER_NAMES, FIRE_MODE_NAMES, GROUP_NAMES, OUTCOME_NAMES, PART_NAMES, PART_SHORT, pick, pieceLabel, START_STATES } from './rangeLabels'
import { buildPartMasks, type PartMasks } from './partMasks'
import { playShot } from './rangeSound'
import { RangeBuild } from './RangeBuild'
import { decodeSaved, MODE_NAMES, savedBuildsOf } from './rangeBuilds'
import type { View } from './rangeHitboxes'
import '../styles/range.css'

type Locale = 'ru' | 'en'
type Group = 'all' | 'pmc' | 'scav' | 'boss' | 'follower'
type KitMode = 'character' | 'random' | 'custom'

const ZEROS = [50, 100, 150, 200, 300, 400]
const BURST: Record<string, number> = { burst: 3, doublet: 2 }
const AUTO = new Set(['fullauto'])
/** Grenades, flares and the like: not for shooting at a character's armour. */
const NOT_AT_TARGETS = new Set(['Caliber40x46', 'Caliber40mmRU', 'Caliber30x29', 'Caliber26x75', 'Caliber20x1mm'])
/**
 * Bosses and their guards wear what they always wear (owner, 22.11.2026: «все предметы, которые на боссах идут стандартно, их нельзя
 * снять и поменять на другие предметы, чтобы не было видно лица… килла, тагила, рыцарь, все должны быть в масках»): their usual kit,
 * a visor lowered, nothing to change.
 */
const LOCKED_GROUPS = new Set(['boss', 'follower'])
const COVERS: Cover[] = ['none', 'left', 'right', 'low', 'window']

/**
 * «Тир» in «Баллистика» (owner, 22.11.2026: «Тир у нас будет в баллистике… В тире у нас будет только стрельба»): shoot a character
 * in armour with a weapon, a build and a round; every hit goes through the game's own armour and health rules
 * (src/range/rangeModel.ts). Test builds only (src/app/rangeFeature.ts).
 */
export function RangeShooting() {
  const { raidMode } = useAppState()
  const { locale } = useLocale()
  const lang: Locale = locale === 'en' ? 'en' : 'ru'
  const guns = useGunCatalog(raidMode, locale)
  const armor = useArmorCatalog(raidMode, locale)
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  if (!guns.data || !armor.data) return <div className="panel range-loading">
    {guns.error || armor.error
      ? <span>{t('Не удалось загрузить данные. Попробуйте позже.', 'Could not load the data. Try again later.')}</span>
      : <><LoaderCircle className="spin" size={18} /> <span>{t('Загружаем оружие и броню…', 'Loading weapons and armour…')}</span></>}
  </div>
  return <Range catalog={guns.data} armor={armor.data} lang={lang} />
}

function Range({ catalog, armor, lang }: { catalog: GunCatalog; armor: ArmorCatalog; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru

  // ——— weapon, build, round
  const weapons = useMemo(() => catalog.weapons.filter((weapon) => !NOT_AT_TARGETS.has(weapon.caliber) && catalog.ammo.some((round) => round.caliber === weapon.caliber)).sort((a, b) => a.shortName.localeCompare(b.shortName)), [catalog])
  const calibers = useMemo(() => [...new Set(weapons.map((weapon) => weapon.caliber))].sort((a, b) => prettyCaliber(a).localeCompare(prettyCaliber(b))), [weapons])
  const [caliber, setCaliber] = useState(() => calibers.includes('Caliber556x45NATO') ? 'Caliber556x45NATO' : calibers[0] ?? '')
  const caliberWeapons = useMemo(() => weapons.filter((weapon) => weapon.caliber === caliber), [weapons, caliber])
  const [weaponId, setWeaponId] = useState(() => caliberWeapons.find((weapon) => weapon.id === '5447a9cd4bdc2dbd208b4567')?.id ?? caliberWeapons[0]?.id ?? '')
  const weapon = caliberWeapons.find((entry) => entry.id === weaponId) ?? caliberWeapons[0]
  const savedBuilds = useMemo(() => weapon ? savedBuildsOf(weapon.id) : [], [weapon])
  const [buildKey, setBuildKey] = useState('preset')
  const startBuild: Build | undefined = useMemo(() => {
    if (!weapon) return undefined
    const saved = savedBuilds.find((entry) => `${entry.mode}:${entry.id}` === buildKey)
    return decodeSaved(saved, catalog) ?? presetBuild(weapon, catalog).build
  }, [weapon, savedBuilds, buildKey, catalog])
  // the build as changed in the small window
  const [edited, setEdited] = useState<{ start?: Build; build?: Build }>({})
  const build = edited.start === startBuild && edited.build ? edited.build : startBuild
  const rounds = useMemo(() => catalog.ammo.filter((round) => round.caliber === caliber).sort((a, b) => b.penetration - a.penetration), [catalog, caliber])
  const [ammoId, setAmmoId] = useState('')
  const ammo = rounds.find((round) => round.id === ammoId) ?? rounds.find((round) => round.id === weapon?.defaultAmmoId) ?? rounds[0]
  const stats = useMemo(() => build && weapon ? computeStats(build, weapon, catalog, ammo) : undefined, [build, weapon, catalog, ammo])
  const capacity = useMemo(() => build ? Math.max(0, ...installedParts(build, catalog).map((entry) => entry.part.capacity ?? 0)) || 30 : 30, [build, catalog])
  const fireModes = useMemo(() => {
    const modes = (weapon?.fireModes ?? ['single']).map((mode) => mode.toLowerCase())
    return [...new Set(modes.map((mode) => mode === 'semiauto' || mode === 'doubleaction' ? 'single' : mode))]
  }, [weapon])
  const [fireMode, setFireMode] = useState('single')
  const mode = fireModes.includes(fireMode) ? fireMode : fireModes[0] ?? 'single'

  // ——— target
  const [group, setGroup] = useState<Group>('pmc')
  const targets = useMemo(() => RANGE_TARGETS.filter((target) => group === 'all' || target.group === group), [group])
  const [targetKey, setTargetKey] = useState('pmcusec')
  const target: RangeTargetData = targets.find((entry) => entry.key === targetKey) ?? targets[0] ?? RANGE_TARGETS[0]!
  const locked = LOCKED_GROUPS.has(target.group)
  const [variant, setVariant] = useState(0)
  const health: Health = useMemo(() => {
    const raw = target.health[Math.min(variant, target.health.length - 1)] ?? PMC_HEALTH
    return Object.fromEntries(BODY_PARTS.map((part) => [part, Number(raw[part]) || PMC_HEALTH[part]])) as Health
  }, [target, variant])
  const [startKey, setStartKey] = useState('healthy')
  const blackedOut = START_STATES.find((state) => state.key === startKey)?.parts ?? []
  const [kitMode, setKitMode] = useState<KitMode>('character')
  const [chosen, setChoice] = useState<KitChoice>(() => likelyKit(armor, target))
  const lockedKit = useMemo(() => likelyKit(armor, target), [armor, target])
  const choice = locked ? lockedKit : chosen
  const chooseTarget = (key: string) => {
    setTargetKey(key)
    setVariant(0)
    const next = RANGE_TARGETS.find((entry) => entry.key === key)
    if (next && kitMode !== 'custom') setChoice(kitMode === 'random' ? randomKit(armor, next, Math.random) : likelyKit(armor, next))
  }
  const editKit = (patch: Partial<KitChoice>) => { setKitMode('custom'); setChoice((current) => ({ ...current, ...patch })) }
  const freshKit = useMemo(() => kitPieces(armor, choice), [armor, choice])

  // ——— the target's state: a fresh character in a fresh kit, changed by every shot (each shot makes a new state)
  const signature = `${target.key}|${variant}|${startKey}|${JSON.stringify(choice)}`
  const [targetCount, setTargetCount] = useState(1)
  const fresh = (number: number): Live => ({ signature, number, kit: cloneKit(freshKit), body: freshBody(health, blackedOut), shots: 0 })
  const [live, setLive] = useState<Live>(() => fresh(1))
  const [marks, setMarks] = useState<FiredShot[]>([])
  const newTarget = () => { setLive(fresh(targetCount + 1)); setTargetCount(targetCount + 1); setMarks([]) }
  // a new character, kit or start state is a new target
  if (live.signature !== signature) newTarget()
  const [log, setLog] = useState<Array<FiredShot & { n: number; target: number }>>([])
  const [counters, setCounters] = useState({ kills: 0, shots: 0, hits: 0, through: 0, damage: 0 })

  // ——— range settings
  const [view, setView] = useState<View>('front')
  // the pictures of the character in its kit (test builds carry them), and the game's hit zones laid on that body
  const figureIndex = useFigureIndex()
  const figures = useMemo(() => figureIndex ? { front: figureLayers(figureIndex, target.key, choice, 'front'), back: figureLayers(figureIndex, target.key, choice, 'back') } : undefined, [figureIndex, target.key, choice])
  const geometry = useMemo(() => figures ? figureGeometry({ front: figures.front?.base.zones, back: figures.back?.base.zones }) : SCHEMATIC, [figures])
  const shownFigure = figures?.[view]
  const figureUrls = useFigureUrls(shownFigure ? [shownFigure.base, ...shownFigure.layers].map((picture) => picture.file) : [])
  const masks = usePartMasks(shownFigure, figureUrls)
  const [distance, setDistance] = useState(50)
  const [zero, setZero] = useState(100)
  const [cover, setCover] = useState<Cover>('none')
  const [toggles, setToggles] = useState({ spread: true, recoil: true, sway: false, sound: true })

  const flight = useMemo(() => ammo ? flightAt(ammo, stats?.velocity, zero, distance) : undefined, [ammo, stats?.velocity, zero, distance])
  const round: Round | undefined = ammo ? {
    damage: flight?.damage ?? ammo.damage,
    penetration: flight?.penetration ?? ammo.penetration,
    armorDamage: (ammo.armorDamage ?? 0) / 100,
    penetrationDeviation: armor.deviation[ammo.id],
  } : undefined
  const setup: AimSetup = {
    distance, moa: stats?.moa, spread: toggles.spread, recoil: toggles.recoil, sway: toggles.sway,
    recoilVertical: stats?.recoilVertical ?? 0, recoilHorizontal: stats?.recoilHorizontal ?? 0, dropCm: flight?.drop ?? 0,
  }

  // ——— firing: a full magazine for each weapon, round and magazine size
  const magKey = `${weapon?.id}|${ammo?.id}|${capacity}`
  const [magazine, setMagazine] = useState({ key: magKey, left: capacity })
  if (magazine.key !== magKey) setMagazine({ key: magKey, left: capacity })
  const mag = magazine.key === magKey ? magazine.left : capacity
  const aimRef = useRef<{ x: number; y: number }>({ x: 0, y: 135 })
  const burstRef = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  const shotNumber = useRef(0)
  const stop = () => { if (timer.current !== undefined) window.clearInterval(timer.current); timer.current = undefined; burstRef.current = 0 }
  useEffect(() => () => { if (timer.current !== undefined) window.clearInterval(timer.current) }, [])
  const reload = () => setMagazine({ key: magKey, left: capacity })
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload })
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'r' && event.key.toLowerCase() !== 'к') return
      if ((event.target as HTMLElement | null)?.closest('input, select, textarea')) return
      reloadRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const fireOnce = () => {
    if (!round || !ammo) return false
    if (mag <= 0 || live.body.dead) return false
    const kit = cloneKit(live.kit)
    const body = cloneBody(live.body)
    setMagazine({ key: magKey, left: mag - 1 })
    if (toggles.sound) playShot(0.45)
    const pellets = Math.max(1, ammo.projectileCount ?? 1)
    const fired: FiredShot[] = []
    for (let pellet = 0; pellet < pellets; pellet++) {
      // buckshot: each pellet its own bullet, about 3 cm per metre across round the aim
      const aim = pellets > 1 ? { x: aimRef.current.x + gauss() * 0.75 * distance, y: aimRef.current.y + gauss() * 0.75 * distance } : aimRef.current
      fired.push(shootOnce(kit, body, view, aim, setup, round, cover, burstRef.current, Math.random, geometry))
    }
    burstRef.current += 1
    shotNumber.current += 1
    const n = shotNumber.current
    const damage = fired.reduce((sum, shot) => sum + Object.values(shot.outcome?.applied ?? {}).reduce((a, b) => a + (b ?? 0), 0), 0)
    const hits = fired.filter((shot) => shot.outcome).length
    const through = fired.filter((shot) => shot.outcome?.penetrated).length
    const killed = fired.some((shot) => shot.outcome?.killed)
    setMarks((current) => [...current, ...fired].slice(-400))
    setLog((current) => [...fired.map((shot) => ({ ...shot, n, target: live.number })), ...current].slice(0, 300))
    setCounters((current) => ({ kills: current.kills + (killed ? 1 : 0), shots: current.shots + 1, hits: current.hits + hits, through: current.through + through, damage: current.damage + damage }))
    setLive({ ...live, kit, body, shots: live.shots + 1, ...(killed ? { killedAt: live.shots + 1 } : {}) })
    return !body.dead && mag - 1 > 0
  }
  // the timer of a burst or of automatic fire calls the latest closure (this render's magazine and target)
  const fireRef = useRef(fireOnce)
  useEffect(() => { fireRef.current = fireOnce })

  const fireStart = (point: { x: number; y: number }) => {
    aimRef.current = point
    stop()
    if (live.body.dead) return
    burstRef.current = 0
    if (!fireOnce()) return
    const rate = weapon?.fireRate && weapon.fireRate > 0 ? weapon.fireRate : 600
    const interval = 60_000 / rate
    if (AUTO.has(mode)) timer.current = window.setInterval(() => { if (!fireRef.current()) stop() }, interval)
    else if (BURST[mode]) {
      let left = BURST[mode]! - 1
      timer.current = window.setInterval(() => { if (left-- <= 0 || !fireRef.current()) stop() }, interval)
    }
  }
  const fireEnd = () => { if (AUTO.has(mode)) stop() }

  const body = live.body
  const kit = live.kit
  const killedAt = live.killedAt
  const last = log[0]
  const hpLabels = Object.fromEntries(BODY_PARTS.map((part) => [part, `${Math.max(0, Math.round(body.current[part]))}`])) as Record<BodyPart, string>
  const total = totalHealth(body.current)
  const maxTotal = totalHealth(body.max)
  const flash = last?.outcome && last.target === live.number ? { part: last.outcome.part, n: last.n } : undefined

  return <div className="range-layout">
    <aside className="range-side">
      <section className="panel range-card">
        <h2 className="range-card-title">{t('Оружие', 'Weapon')}</h2>
        <label className="range-field"><span>{t('Калибр', 'Caliber')}</span>
          <select className="select" value={caliber} onChange={(event) => { setCaliber(event.target.value); const first = weapons.find((entry) => entry.caliber === event.target.value); setWeaponId(first?.id ?? ''); setBuildKey('preset'); setAmmoId('') }}>
            {calibers.map((value) => <option key={value} value={value}>{prettyCaliber(value)}</option>)}
          </select>
        </label>
        <label className="range-field"><span>{t('Оружие', 'Weapon')}</span>
          <select className="select" value={weapon?.id ?? ''} onChange={(event) => { setWeaponId(event.target.value); setBuildKey('preset') }}>
            {caliberWeapons.map((entry) => <option key={entry.id} value={entry.id}>{entry.shortName}</option>)}
          </select>
        </label>
        <label className="range-field"><span>{t('Сборка', 'Build')}</span>
          <select className="select" value={buildKey} onChange={(event) => setBuildKey(event.target.value)}>
            <option value="preset">{weapon?.shortName ?? ''} · {t('заводская', 'default')}</option>
            {savedBuilds.map((entry) => <option key={`${entry.mode}:${entry.id}`} value={`${entry.mode}:${entry.id}`}>{weapon?.shortName ?? ''} · {pick(MODE_NAMES[entry.mode], lang)} · {entry.name}</option>)}
          </select>
        </label>
        <label className="range-field"><span>{t('Патрон', 'Round')}</span>
          <select className="select" value={ammo?.id ?? ''} onChange={(event) => setAmmoId(event.target.value)}>
            {rounds.map((entry) => <option key={entry.id} value={entry.id}>{entry.shortName} · {Math.round(entry.damage)}{(entry.projectileCount ?? 1) > 1 ? `×${entry.projectileCount}` : ''} / {Math.round(entry.penetration)} / {Math.round(entry.armorDamage ?? 0)}%</option>)}
          </select>
        </label>
        <div className="range-facts">
          <Fact label={t('Урон', 'Damage')} value={ammo ? `${Math.round(ammo.damage)}${(ammo.projectileCount ?? 1) > 1 ? `×${ammo.projectileCount}` : ''}` : '—'} />
          <Fact label={t('Пробитие', 'Penetration')} value={ammo ? `${Math.round(ammo.penetration)}` : '—'} />
          <Fact label={t('Урон броне', 'Armour damage')} value={ammo ? `${Math.round(ammo.armorDamage ?? 0)}%` : '—'} />
          <Fact label={t('Скорость', 'Velocity')} value={stats?.velocity ? `${Math.round(stats.velocity)} ${t('м/с', 'm/s')}` : '—'} />
          <Fact label="MOA" value={stats?.moa ? `≈${stats.moa.toFixed(2)}` : '—'} />
          <Fact label={t('Отдача', 'Recoil')} value={stats ? `${stats.recoilVertical} / ${stats.recoilHorizontal}` : '—'} />
          <Fact label={t('Эргономика', 'Ergonomics')} value={stats ? `${Math.round(stats.ergonomics)}` : '—'} />
          <Fact label={t('Скорострельность', 'Fire rate')} value={weapon?.fireRate ? `${weapon.fireRate}` : '—'} />
          <Fact label={t('Магазин', 'Magazine')} value={`${capacity}`} />
        </div>
      </section>

      <section className="panel range-card">
        <h2 className="range-card-title">{t('Цель', 'Target')}</h2>
        <div className="segmented-filter range-groups">
          {(['all', 'pmc', 'scav', 'boss', 'follower'] as Group[]).map((key) => <button key={key} type="button" className={group === key ? 'active' : ''} onClick={() => { setGroup(key); const first = RANGE_TARGETS.find((entry) => key === 'all' || entry.group === key); if (first && !(key === 'all' || target.group === key)) chooseTarget(first.key) }}>{pick(GROUP_NAMES[key], lang)}</button>)}
        </div>
        <label className="range-field"><span>{t('Персонаж', 'Character')}</span>
          <select className="select" value={target.key} onChange={(event) => chooseTarget(event.target.value)}>
            {targets.map((entry) => <option key={entry.key} value={entry.key}>{pick([entry.ru, entry.en], lang)} · {totalHealth(Object.fromEntries(BODY_PARTS.map((part) => [part, Number(entry.health[0]?.[part]) || 0])) as Health)} HP</option>)}
          </select>
        </label>
        {target.health.length > 1 && <label className="range-field"><span>{t('Вариант здоровья', 'Health variant')}</span>
          <select className="select" value={variant} onChange={(event) => setVariant(Number(event.target.value))}>
            {target.health.map((entry, index) => <option key={index} value={index}>{totalHealth(entry as Health)} HP</option>)}
          </select>
        </label>}
        <label className="range-field"><span>{t('Начальное состояние', 'Start state')}</span>
          <select className="select" value={startKey} onChange={(event) => setStartKey(event.target.value)}>
            {START_STATES.map((state) => <option key={state.key} value={state.key}>{lang === 'en' ? state.en : state.ru}</option>)}
          </select>
        </label>
        {!locked && <div className="range-field"><span>{t('Экипировка', 'Equipment')}</span>
          <div className="segmented-filter">
            <button type="button" className={kitMode === 'character' ? 'active' : ''} onClick={() => { setKitMode('character'); setChoice(likelyKit(armor, target)) }}>{t('Обычная', 'Usual')}</button>
            <button type="button" className={kitMode === 'random' ? 'active' : ''} onClick={() => { setKitMode('random'); setChoice(randomKit(armor, target, Math.random)) }}><Shuffle size={13} /> {t('Случайная', 'Random')}</button>
            <button type="button" className={kitMode === 'custom' ? 'active' : ''} onClick={() => setKitMode('custom')}>{t('Своя', 'Custom')}</button>
          </div>
        </div>}
      </section>

      {locked
        ? <LockedKit armor={armor} choice={choice} lang={lang} />
        : <ArmorChooser armor={armor} choice={choice} lang={lang} onChange={editKit} />}
    </aside>

    <main className="range-main">
      {weapon && startBuild && <section className="panel range-card range-build-panel">
        <h2 className="range-card-title">{t('Сборка', 'Build')} <small>{weapon.shortName}{stats ? ` · ${t('эрго', 'ergo')} ${Math.round(stats.ergonomics)} · ${t('отдача', 'recoil')} ${stats.recoilVertical}/${stats.recoilHorizontal}${stats.moa ? ` · ${stats.moa.toFixed(2)} MOA` : ''}` : ''}</small></h2>
        <RangeBuild key={`${weapon.id}|${buildKey}`} weapon={weapon} catalog={catalog} start={startBuild} ammo={ammo} lang={lang}
          onChange={(next) => setEdited({ start: startBuild, build: next })} />
      </section>}
      <div className="panel range-toolbar">
        <div className="segmented-filter">
          <button type="button" className={view === 'front' ? 'active' : ''} onClick={() => setView('front')}>{t('Спереди', 'Front')}</button>
          <button type="button" className={view === 'back' ? 'active' : ''} onClick={() => setView('back')}>{t('Сзади', 'Back')}</button>
        </div>
        <label className="range-distance">
          <span>{t('Дистанция', 'Distance')}</span>
          <input type="range" min={5} max={1000} step={5} value={distance} onChange={(event) => setDistance(Number(event.target.value))} />
          <b className="range-distance-value">{distance} {t('м', 'm')}</b>
        </label>
        <label className="range-inline"><span>{t('Пристрелка', 'Zero')}</span>
          <select className="select" value={zero} onChange={(event) => setZero(Number(event.target.value))}>
            {ZEROS.map((value) => <option key={value} value={value}>{value} {t('м', 'm')}</option>)}
          </select>
        </label>
        <div className="segmented-filter">
          {fireModes.map((value) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setFireMode(value)}>{pick(FIRE_MODE_NAMES[value] ?? [value, value], lang)}</button>)}
        </div>
        <label className="range-inline"><span>{t('Укрытие', 'Cover')}</span>
          <select className="select" value={cover} onChange={(event) => setCover(event.target.value as Cover)}>
            {COVERS.map((value) => <option key={value} value={value}>{pick(COVER_NAMES[value], lang)}</option>)}
          </select>
        </label>
        <div className="range-toggles">
          {([['spread', t('Разброс', 'Spread')], ['recoil', t('Отдача', 'Recoil')], ['sway', t('Раскачка', 'Sway')], ['sound', t('Звук', 'Sound')]] as const).map(([key, label]) => <button key={key} type="button" className={`range-chip${toggles[key] ? ' is-on' : ''}`} onClick={() => setToggles((current) => ({ ...current, [key]: !current[key] }))}>{label}</button>)}
        </div>
      </div>

      <div className="panel range-stage">
        <div className="range-stage-head">
          <span className="range-mag" title={t('R — перезарядка', 'R — reload')}>{t('Магазин', 'Magazine')} <b>{mag}</b> / {capacity}{mag === 0 && <em> · {t('R — перезарядка', 'R — reload')}</em>}</span>
          <span className="range-total">{t('HP', 'HP')} <b>{Math.max(0, Math.round(total))}</b> / {maxTotal}</span>
          <div className="range-stage-actions">
            <button type="button" className="button" onClick={reload}><RotateCcw size={14} /> R</button>
            <button type="button" className="button" onClick={newTarget}><Crosshair size={14} /> {t('Новая цель', 'New target')}</button>
            <button type="button" className="button" onClick={() => setMarks([])}><Eraser size={14} /> {t('Убрать отметки', 'Clear marks')}</button>
          </div>
        </div>
        <div className="range-target-wrap">
          <RangeTarget view={view} kit={kit} body={body} marks={marks} cover={cover} spreadCm={toggles.spread ? spreadAt(stats?.moa, distance) : undefined}
            onFireStart={fireStart} onFireEnd={fireEnd} onAimMove={(point) => { aimRef.current = point }} labels={hpLabels}
            figure={shownFigure ? { ...shownFigure, urls: figureUrls } : undefined} masks={masks} flash={flash} />
          {body.dead && <div className="range-dead">
            <b>{t('Убит', 'Killed')}</b>
            <span>{killedAt ? `${killedAt} ${t('выстр.', 'shots')} · ${weapon?.fireRate ? `${((killedAt - 1) * 60 / weapon.fireRate + (flight?.time ?? 0)).toFixed(2)} ${t('с', 's')}` : ''}` : ''}</span>
            <button type="button" className="button primary" onClick={newTarget}>{t('Новая цель', 'New target')}</button>
          </div>}
        </div>
        <div className="range-health">
          {BODY_PARTS.map((part) => <div key={part} className={`range-hp-row${body.destroyed[part] ? ' is-out' : ''}`}>
            <span>{pick(PART_SHORT[part], lang)}</span>
            <i><s style={{ width: `${Math.max(0, body.current[part] / body.max[part]) * 100}%` }} /></i>
            <b>{Math.max(0, Math.round(body.current[part]))}/{body.max[part]}</b>
          </div>)}
        </div>
        {kit.length > 0 && <div className="range-health range-armor-hp">
          {kit.map((piece) => <div key={piece.key} className={`range-hp-row${piece.durability <= 0 ? ' is-out' : ''}`} title={piece.name}>
            <span>{classBadge(piece.armorClass)} {pieceLabel(piece.key, piece.name, lang)}</span>
            <i><s style={{ width: `${Math.max(0, piece.durability / piece.maxDurability) * 100}%`, background: CLASS_COLORS[piece.armorClass] }} /></i>
            <b>{piece.durability.toFixed(1)}/{piece.maxDurability}</b>
          </div>)}
        </div>}
      </div>

      <div className="range-counters">
        <Fact label={t('Целей', 'Kills')} value={`${counters.kills}`} />
        <Fact label={t('Патронов', 'Rounds')} value={`${counters.shots}`} />
        <Fact label={t('Попаданий', 'Hits')} value={`${counters.hits}`} />
        <Fact label={t('Пробитий', 'Penetrations')} value={`${counters.through}`} />
        <Fact label={t('Урон', 'Damage')} value={`${Math.round(counters.damage)}`} />
        <button type="button" className="button range-reset" onClick={() => { setCounters({ kills: 0, shots: 0, hits: 0, through: 0, damage: 0 }); setLog([]); shotNumber.current = 0 }}>{t('Сбросить счёт', 'Reset')}</button>
      </div>
    </main>

    <aside className="range-side range-results">
      <section className="panel range-card">
        <h2 className="range-card-title">{t('Урон', 'Damage')}</h2>
        <DamageResult shot={last} lang={lang} />
      </section>
    </aside>
  </div>
}

/** The masks of the shown figure's body parts, made again when its pictures change. */
function usePartMasks(figure: { base: { file: string; zones?: unknown }; layers: Array<{ file: string }> } | undefined, urls: Record<string, string>) {
  const [masks, setMasks] = useState<{ key: string; masks?: PartMasks }>({ key: '' })
  const files = figure ? [figure.base, ...figure.layers].map((picture) => picture.file) : []
  const ready = files.length > 0 && files.every((file) => urls[file])
  const key = ready ? files.join('|') : ''
  useEffect(() => {
    if (!key || !figure) return
    let live = true
    const pictures = [figure.base, ...figure.layers] as Parameters<typeof buildPartMasks>[0]
    buildPartMasks(pictures, urls, (figure.base as Parameters<typeof buildPartMasks>[0][number]).zones ?? [])
      .then((made) => { if (live) setMasks({ key, masks: made }) })
      .catch(() => { if (live) setMasks({ key }) })
    return () => { live = false }
    // the pictures' files say when the figure changed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return masks.key === key ? masks.masks : undefined
}

interface Live {
  signature: string
  /** Which target this is (the log groups shots by it). */
  number: number
  kit: ArmorPiece[]
  body: BodyState
  shots: number
  killedAt?: number
}

function cloneBody(body: BodyState): BodyState {
  return { max: { ...body.max }, current: { ...body.current }, destroyed: { ...body.destroyed }, dead: body.dead }
}

function gauss() {
  const u = Math.max(1e-9, Math.random()), v = Math.random()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className="range-fact"><span>{label}</span><b>{value}</b></div>
}

function classBadge(armorClass: number) {
  return <span className="range-class" style={{ background: CLASS_COLORS[armorClass] }}>{armorClass}</span>
}

/** A boss's or guard's own kit: shown, not changed. */
function LockedKit({ armor, choice, lang }: { armor: ArmorCatalog; choice: KitChoice; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const ids = [choice.helmet, choice.visor, choice.module, choice.face, choice.eyewear, choice.body, ...Object.values(choice.plates)].filter((id): id is string => Boolean(id))
  const items = ids.map((id) => armor.items.get(id)).filter((item): item is RangeItem => Boolean(item))
  return <section className="panel range-card">
    <h2 className="range-card-title"><Lock size={13} /> {t('Снаряжение', 'Equipment')}</h2>
    <p className="range-locked-note">{t('Своё снаряжение босса: не снимается и не меняется.', 'The boss’s own kit: it cannot be taken off or changed.')}</p>
    {items.length ? <ul className="range-locked-list">
      {items.map((item) => <li key={item.id}>{classBadge(item.armorClass)} {item.shortName}</li>)}
    </ul> : <p className="range-empty">{t('Брони нет.', 'No armour.')}</p>}
  </section>
}

function ArmorChooser({ armor, choice, lang, onChange }: { armor: ArmorCatalog; choice: KitChoice; lang: Locale; onChange: (patch: Partial<KitChoice>) => void }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const of = (kinds: RangeItem['kind'][]) => armor.list.filter((item) => kinds.includes(item.kind))
  const helmet = choice.helmet ? armor.items.get(choice.helmet) : undefined
  const body = choice.body ? armor.items.get(choice.body) : undefined
  const option = (item: RangeItem) => <option key={item.id} value={item.id}>{item.armorClass} · {item.shortName}</option>
  const select = (label: string, value: string | undefined, items: RangeItem[], set: (id: string | undefined) => void) => <label key={label} className="range-field">
    <span>{label}{value && armor.items.get(value) ? <> {classBadge(armor.items.get(value)!.armorClass)}</> : null}</span>
    <select className="select" value={value ?? ''} onChange={(event) => set(event.target.value || undefined)}>
      <option value="">{t('Нет', 'None')}</option>
      {items.map(option)}
    </select>
  </label>
  return <section className="panel range-card">
    <h2 className="range-card-title">{t('Броня', 'Armour')}</h2>
    {select(t('Шлем', 'Helmet'), choice.helmet, of(['helmet']), (id) => onChange({ helmet: id, visor: undefined, module: undefined }))}
    {helmet && helmet.visors.length > 0 && select(t('Забрало', 'Visor'), choice.visor, helmet.visors.map((id) => armor.items.get(id)!).filter(Boolean), (id) => onChange({ visor: id }))}
    {helmet && helmet.modules.length > 0 && select(t('Модуль шлема', 'Helmet module'), choice.module, helmet.modules.map((id) => armor.items.get(id)!).filter(Boolean), (id) => onChange({ module: id }))}
    {select(t('Маска', 'Mask'), choice.face, of(['face']).filter((item) => !armor.list.some((other) => other.kind === 'helmet' && other.visors.includes(item.id))), (id) => onChange({ face: id }))}
    {select(t('Очки', 'Glasses'), choice.eyewear, of(['eyewear']), (id) => onChange({ eyewear: id }))}
    {select(t('Бронежилет или разгрузка', 'Body armour or rig'), choice.body, of(['armor', 'rig']), (id) => onChange({ body: id, plates: defaultPlates(armor, id) }))}
    {body?.plateSlots.map((slot) => select(pieceLabel(`x:${slot.name}`, slot.name, lang), choice.plates[slot.name], slot.allowed.map((id) => armor.items.get(id)!).filter(Boolean).sort((a, b) => b.armorClass - a.armorClass), (id) => onChange({ plates: { ...choice.plates, [slot.name]: id } })))}
  </section>
}

function DamageResult({ shot, lang }: { shot?: FiredShot & { n: number }; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  if (!shot) return <p className="range-empty">{t('Нажмите на мишень, чтобы выстрелить. Зажмите — очередь.', 'Click the target to fire. Hold for automatic fire.')}</p>
  if (shot.cover) return <p className="range-empty">{t('Пуля попала в укрытие.', 'The cover took the bullet.')}</p>
  if (!shot.outcome || !shot.spot) return <p className="range-empty">{t('Промах.', 'Miss.')}</p>
  const outcome = shot.outcome
  return <div className="range-result">
    <div className="range-result-head">
      <b>{pick(COLLIDER_NAMES[shot.spot.collider], lang)}</b>
      <span>→ {pick(PART_NAMES[outcome.part], lang)}</span>
      <em style={{ color: markOf(shot).fill }}>{outcome.penetrated ? t('пробил', 'penetrated') : t('не пробил', 'stopped')}</em>
    </div>
    <div className="range-facts">
      <Fact label={t('Пробитие пули', 'Bullet penetration')} value={outcome.penetration.toFixed(1)} />
      <Fact label={t('Урон телу', 'Body damage')} value={outcome.damage.toFixed(1)} />
    </div>
    {outcome.stages.flatMap((stage) => stage.layers).map((layer, index) => <div key={index} className={`range-layer is-${layer.outcome}`}>
      <div>{classBadge(layer.armorClass)} <b>{pieceLabel(layer.key, layer.name, lang)}</b> <em>{pick(OUTCOME_NAMES[layer.outcome], lang)}</em></div>
      <small>{t('шанс пробития', 'penetration chance')} {layer.chance.toFixed(0)}% · {t('прочность', 'durability')} {layer.durabilityBefore.toFixed(1)} → {layer.durabilityAfter.toFixed(1)} / {layer.maxDurability}</small>
    </div>)}
    {Object.entries(outcome.applied).length > 0 && <div className="range-applied">
      {Object.entries(outcome.applied).map(([part, value]) => <span key={part}>{pick(PART_SHORT[part as BodyPart], lang)} −{(value ?? 0).toFixed(1)}</span>)}
    </div>}
    {outcome.killed && <p className="range-kill">{t('Цель убита.', 'Target killed.')}</p>}
  </div>
}

