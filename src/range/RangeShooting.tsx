import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { useFigureIndex, useFigureUrls, useRangeJson } from './rangeFigureSource'
import { RangeScopeView } from './RangeScopeView'
import { RangeScopePicker } from './RangeScopePicker'
import { cmToMrad, DROP_TABLE_DISTANCES, holdover, markStepAt, mradToMoa, type ScopeData, type ScopeMode } from './rangeScope'
import { RangePicker } from './RangePicker'
import { drawnVariant, oneOfEachModel } from './rangeLists'
import { swayMrad, swayNow } from './rangeSway'
import { RangeHelpTip } from './RangeHelpTip'
import { COVER_TEXTURE_FILES } from './rangeCoverData'
import { CLASS_COLORS, markOf } from './rangeView'
import { flightAt, flightPath } from './rangeFlight'
import type { Tracer } from './RangeTracer'
import { COLLIDER_NAMES, COVER_NAMES, FIRE_MODE_NAMES, GROUP_NAMES, OUTCOME_NAMES, PART_NAMES, PART_SHORT, pick, pieceLabel, START_STATES } from './rangeLabels'
import { buildPartMasks, type PartMasks } from './partMasks'
import { playShot } from './rangeSound'
import { createRecoil, degreesToCm, RECOIL_TICK, similarRecoil, type RecoilReading, type RecoilSim } from './rangeRecoil'
import { RangeBuild } from './RangeBuild'
import { decodeSaved, MODE_NAMES, savedBuildsOf } from './rangeBuilds'
import type { View } from './rangeHitboxes'
import '../styles/range.css'

type Locale = 'ru' | 'en'
type Group = 'all' | 'pmc' | 'scav' | 'boss' | 'follower'
type KitMode = 'character' | 'random' | 'custom'

const ZEROS = [50, 100, 150, 200, 300, 400]
/**
 * Without optics: the target seen at ×1 through the open sights, its real size at the distance (owner, 23.11.2026: «я выставил 415
 * метров. Потом нажимаю в режим без оптики… приближаюсь я на 5 метров. И дистанция не работает»: the old board drew the character
 * at one size whatever the distance); the wheel brings it closer up to ×4.
 */
const IRON_SIGHTS: ScopeMode = { zoom: 1, zoomMax: 4, fovDeg: 40, ffp: true }
/** The distances one button away (owner, 23.11.2026: «быстро показывать человеку, какие ему нужно ввести поправки»). */
const QUICK_DISTANCES = [100, 200, 300, 400, 500, 600, 800]
/** The spread of a build without a centre of impact (no barrel in it), MOA. */
const FALLBACK_MOA = 3
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
  // the pictures of the character in its kit (test builds carry them): what can be drawn worn
  const figureIndex = useFigureIndex()
  const drawn = useMemo(() => figureIndex ? (id: string) => Boolean(figureIndex.pictures[`worn-${id}`]) : undefined, [figureIndex])
  const [kitMode, setKitMode] = useState<KitMode>('character')
  const [chosen, setChoice] = useState<KitChoice>(() => likelyKit(armor, target))
  const lockedKit = useMemo(() => likelyKit(armor, target), [armor, target])
  // no masks or glasses on the targets one dresses (owner, 23.11.2026: «маска, очки убери»); bosses and guards keep theirs
  const choice = locked ? lockedKit : drawnKit(withoutFaceKit(chosen), armor, drawn)
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
  // the target a bullet in flight was fired at: its hole shows only on that one
  const liveNumber = useRef(live.number)
  useEffect(() => { liveNumber.current = live.number })
  /**
   * Bullets in flight (a single shot with «Траектория»): the shot is worked out as it leaves, as the game's own order of hits
   * does not change, but the target, its HP and the counters show it when the bullet gets there (owner, 23.11.2026: «нам не
   * нужны прямые выстрелы… нужно сделать в точности как у них»). `held`: the target as it looks until then.
   */
  const inFlight = useRef(0)
  const [held, setHeld] = useState<Live | null>(null)
  const [marks, setMarks] = useState<FiredShot[]>([])
  const newTarget = () => { setLive(fresh(targetCount + 1)); setTargetCount(targetCount + 1); setMarks([]) }
  const newTargetLatest = useRef(newTarget)
  useEffect(() => { newTargetLatest.current = newTarget })
  // a new character, kit or start state is a new target
  if (live.signature !== signature) newTarget()
  const [log, setLog] = useState<Array<FiredShot & { n: number; target: number }>>([])
  const [counters, setCounters] = useState({ kills: 0, shots: 0, hits: 0, through: 0, damage: 0 })

  // ——— range settings
  const [view, setView] = useState<View>('front')
  // the character in its kit, and the game's hit zones laid on that body
  const figures = useMemo(() => figureIndex ? { front: figureLayers(figureIndex, target.key, choice, 'front'), back: figureLayers(figureIndex, target.key, choice, 'back') } : undefined, [figureIndex, target.key, choice])
  const geometry = useMemo(() => figures ? figureGeometry({ front: figures.front?.base.zones, back: figures.back?.base.zones }) : SCHEMATIC, [figures])
  const shownFigure = figures?.[view]
  const figureUrls = useFigureUrls(shownFigure ? [shownFigure.base, ...shownFigure.layers].map((picture) => picture.file) : [])
  const masks = usePartMasks(shownFigure, figureUrls)
  const [distance, setDistance] = useState(50)
  // a scope: its reticle and the target at the distance seen through it (src/range/RangeScopeView.tsx)
  const scopes = useRangeJson<ScopeData[]>('scopes.json')
  const [scopeId, setScopeId] = useState('')
  const scope = scopes?.find((entry) => entry.id === scopeId)
  const [scopeModeIndex, setScopeModeIndex] = useState(0)
  const scopeMode = scope?.modes[Math.min(scopeModeIndex, scope.modes.length - 1)]
  const [zoomState, setZoom] = useState<{ key: string; zoom: number }>({ key: '', zoom: 1 })
  const zoom = zoomState.key === `${scopeId}|${scopeModeIndex}` ? zoomState.zoom : scopeMode?.zoom ?? 1
  const reticleUrls = useFigureUrls([scopeMode?.reticle, scopeMode?.reticleMax].filter((file): file is string => Boolean(file)))
  const textureUrls = useFigureUrls(Object.values(COVER_TEXTURE_FILES))
  const coverTextures = { brick: textureUrls[COVER_TEXTURE_FILES.brick], container: textureUrls[COVER_TEXTURE_FILES.container], crate: textureUrls[COVER_TEXTURE_FILES.crate] }
  const zeros = scope?.zeros?.length ? scope.zeros : ZEROS
  const [zeroChoice, setZero] = useState(100)
  const zero = zeros.includes(zeroChoice) ? zeroChoice : zeros[0] ?? 100
  const [cover, setCover] = useState<Cover>('none')
  const [toggles, setToggles] = useState({ spread: true, recoil: true, sway: false, sound: true, trace: true })

  // the sight is zeroed with the weapon's default round, as in the game: another round lands off the zero
  const zeroAmmo = rounds.find((round) => round.id === weapon?.defaultAmmoId) ?? ammo
  const flight = ammo ? flightAt(ammo, stats?.velocity, zero, distance, zeroAmmo) : undefined
  // a single shot's bullet in flight (src/range/RangeTracer.tsx)
  const [tracer, setTracer] = useState<Tracer | null>(null)
  const round: Round | undefined = ammo ? {
    damage: flight?.damage ?? ammo.damage,
    penetration: flight?.penetration ?? ammo.penetration,
    armorDamage: (ammo.armorDamage ?? 0) / 100,
    penetrationDeviation: armor.deviation[ammo.id],
  } : undefined
  // the game's own recoil (src/range/rangeRecoil.ts): the bullet goes where the barrel points as it leaves
  const setup: AimSetup = {
    // a build without a barrel has no centre of impact: the spread of a usual rifle rather than none
    distance, moa: stats?.moa ?? FALLBACK_MOA, spread: toggles.spread, recoil: false, sway: false,
    recoilVertical: stats?.recoilVertical ?? 0, recoilHorizontal: stats?.recoilHorizontal ?? 0, dropCm: flight?.drop ?? 0,
  }
  // «Раскачка»: the weapon's drift at the target, cm (src/range/rangeSway.ts)
  const swayCm = toggles.sway ? swayMrad(stats?.ergonomics) * 0.1 * distance : 0
  // the game's recoil of the weapon, else of the most alike one (14 weapons lack it: src/range/rangeRecoil.ts)
  const recoilData = useMemo(() => weapon ? similarRecoil(weapon, catalog.weapons) : undefined, [weapon, catalog.weapons])
  const roundRecoil = ammo?.recoilModifier ?? 0
  const modsRecoil = stats ? stats.recoilModifierSum - roundRecoil : 0
  const simKey = `${weapon?.id}|${modsRecoil.toFixed(4)}|${roundRecoil.toFixed(4)}`
  const simRef = useRef<{ key: string; sim: RecoilSim } | null>(null)
  const recoilSim = () => {
    if (!recoilData || !weapon) return undefined
    if (simRef.current?.key !== simKey) simRef.current = { key: simKey, sim: createRecoil(recoilData, modsRecoil, roundRecoil, Math.random, weapon.recoilVertical || recoilData.up) }
    return simRef.current.sim
  }
  /** The recoil now, and the aim it was read at (for the barrel's mark). */
  const [recoilState, setRecoilNow] = useState<{ reading: RecoilReading; aim: { x: number; y: number } } | null>(null)
  const recoilNow = recoilState?.reading ?? null
  const recoilCm = (reading: RecoilReading | null | undefined, key: 'bore' | 'view') => reading && toggles.recoil
    ? { x: degreesToCm(reading[key].right, distance), y: degreesToCm(reading[key].up, distance) }
    : { x: 0, y: 0 }

  // ——— firing: a full magazine for each weapon, round and magazine size
  const magKey = `${weapon?.id}|${ammo?.id}|${capacity}`
  const [magazine, setMagazine] = useState({ key: magKey, left: capacity })
  if (magazine.key !== magKey) setMagazine({ key: magKey, left: capacity })
  const mag = magazine.key === magKey ? magazine.left : capacity
  const aimRef = useRef<{ x: number; y: number }>({ x: 0, y: 135 })
  const burstRef = useRef(0)
  const shotNumber = useRef(0)
  /** The trigger: held, the shots it has left, the time on the 1/60 s ticks of the game's recoil, the next shot's time. */
  const trigger = useRef({ held: false, left: 0, time: 0, next: 0, frame: undefined as number | undefined, last: 0, spare: 0 })
  useEffect(() => () => { if (trigger.current.frame !== undefined) cancelAnimationFrame(trigger.current.frame) }, [])
  const reload = () => setMagazine({ key: magKey, left: capacity })
  const reloadRef = useRef(reload)
  useEffect(() => { reloadRef.current = reload })
  // R reloads, F gives a new target, in the scope and out of it (owner, 23.11.2026: «Кнопка «Перезарядить» — это R, а кнопка «Новая
  // цель» — это F… действие основное везде»): by the key itself, so a Russian layout works the same
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.altKey || event.metaKey || event.repeat) return
      if ((event.target as HTMLElement | null)?.closest('input, select, textarea')) return
      if (event.code === 'KeyR') reloadRef.current()
      else if (event.code === 'KeyF') { event.preventDefault(); newTargetLatest.current() }
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
    // where the barrel points as the bullet leaves; then this shot's own kick
    const sim = recoilSim()
    const bore = recoilCm(sim?.read(), 'bore')
    const sway = swayCm ? swayNow(swayCm) : { x: 0, y: 0 }
    // a weapon without the game's recoil data (src/range/rangeRecoil.json) still kicks: the estimate from its figures
    const shotSetup = { ...setup, recoil: toggles.recoil && !recoilData, recoilOffset: { x: bore.x + sway.x, y: bore.y + sway.y } }
    sim?.shot()
    const pellets = Math.max(1, ammo.projectileCount ?? 1)
    const fired: FiredShot[] = []
    for (let pellet = 0; pellet < pellets; pellet++) {
      // buckshot: each pellet its own bullet, about 3 cm per metre across round the aim
      const aim = pellets > 1 ? { x: aimRef.current.x + gauss() * 0.75 * distance, y: aimRef.current.y + gauss() * 0.75 * distance } : aimRef.current
      fired.push(shootOnce(kit, body, view, aim, shotSetup, round, cover, burstRef.current, Math.random, geometry))
    }
    burstRef.current += 1
    shotNumber.current += 1
    const n = shotNumber.current
    const damage = fired.reduce((sum, shot) => sum + Object.values(shot.outcome?.applied ?? {}).reduce((a, b) => a + (b ?? 0), 0), 0)
    const hits = fired.filter((shot) => shot.outcome).length
    const through = fired.filter((shot) => shot.outcome?.penetrated).length
    const killed = fired.some((shot) => shot.outcome?.killed)
    const show = () => {
      setMarks((current) => [...current, ...fired].slice(-400))
      setLog((current) => [...fired.map((shot) => ({ ...shot, n, target: live.number })), ...current].slice(0, 300))
    }
    // a single shot with «Траектория»: the bullet flies at its own speed and the hole shows when it gets there
    const first = fired[0]
    const path = toggles.trace && mode === 'single' ? flightPath(ammo, stats?.velocity, zero, distance, zeroAmmo) : undefined
    const tracing = Boolean(path?.length && first)
    const flightMs = (path?.[path.length - 1]?.time ?? 0) * 1000
    if (path?.length && first) {
      const end = path[path.length - 1]!
      const lineY = first.point.y - end.drop
      setTracer({ id: n, points: path.map((point) => ({ x: first.point.x, y: lineY + point.drop * distance / point.distance, drop: point.drop, time: point.time, speed: point.speed, energy: point.energy, distance: point.distance })) })
      const forTarget = live.number
      window.setTimeout(() => { if (liveNumber.current === forTarget) show() }, flightMs)
    } else show()
    const after: Live = { ...live, kit, body, shots: live.shots + 1, ...(killed ? { killedAt: live.shots + 1 } : {}) }
    const count = () => setCounters((current) => ({ kills: current.kills + (killed ? 1 : 0), shots: current.shots + 1, hits: current.hits + hits, through: current.through + through, damage: current.damage + damage }))
    if (tracing) {
      if (inFlight.current === 0) setHeld(live)
      inFlight.current += 1
      window.setTimeout(() => {
        inFlight.current = Math.max(0, inFlight.current - 1)
        count()
        setHeld(inFlight.current > 0 ? after : null)
      }, flightMs)
    } else count()
    setLive(after)
    return !body.dead && mag - 1 > 0
  }
  // the ticks call the latest closures (this render's magazine, target and recoil)
  const fireRef = useRef(fireOnce)
  useEffect(() => { fireRef.current = fireOnce })
  const simRefFn = useRef(recoilSim)
  useEffect(() => { simRefFn.current = recoilSim })

  /**
   * The game's 1/60 s ticks while the trigger is held and until the weapon has come back to rest: a shot when its time comes (the
   * weapon's fire rate), then the recoil's tick. At most one shot a frame (each shot changes the target's state for the next).
   */
  const run = () => {
    const state = trigger.current
    if (state.frame !== undefined) return
    state.last = performance.now()
    state.spare = 0
    const frame = (now: number) => {
      try {
        step(now)
      } catch {
        // a failed tick must not leave the trigger stuck: with `frame` still set no shot would ever start the ticks again (the
        // recoil and automatic fire «пропадает» until the page is opened anew)
        state.frame = undefined
        state.held = false
        setRecoilNow(null)
      }
    }
    const step = (now: number) => {
      state.spare += Math.min(0.1, (now - state.last) / 1000)
      state.last = now
      const sim = simRefFn.current()
      let shotThisFrame = false
      while (state.spare >= RECOIL_TICK) {
        if (state.held && state.left > 0 && state.time >= state.next - 1e-9) {
          if (shotThisFrame) break
          shotThisFrame = true
          const interval = 60 / (weapon?.fireRate && weapon.fireRate > 0 ? weapon.fireRate : 600)
          if (fireRef.current()) { state.left -= 1; state.next += interval } else state.left = 0
          if (state.left <= 0 && !AUTO.has(mode)) state.held = false
        }
        state.spare -= RECOIL_TICK
        state.time += RECOIL_TICK
        sim?.tick(state.held && state.left > 0)
      }
      if (sim) setRecoilNow({ reading: sim.read(), aim: { ...aimRef.current } })
      if (!state.held && (!sim || sim.resting())) { state.frame = undefined; setRecoilNow(null); return }
      state.frame = requestAnimationFrame(frame)
    }
    state.frame = requestAnimationFrame(frame)
  }

  const fireStart = (point: { x: number; y: number }) => {
    aimRef.current = point
    if (live.body.dead) return
    burstRef.current = 0
    const state = trigger.current
    const rate = weapon?.fireRate && weapon.fireRate > 0 ? weapon.fireRate : 600
    state.held = true
    state.time = 0
    state.next = 60 / rate
    // automatic fire: shots until the trigger is let go; a burst its shots; a single shot just this one
    state.left = AUTO.has(mode) ? Number.POSITIVE_INFINITY : BURST[mode] ? BURST[mode]! - 1 : 0
    if (!fireOnce()) state.left = 0
    if (state.left <= 0 && !AUTO.has(mode)) state.held = false
    run()
  }
  const fireEnd = () => { if (AUTO.has(mode)) trigger.current.held = false }
  const onScopeAim = useCallback((point: { x: number; y: number }) => { aimRef.current = point }, [])

  const shown = held && held.number === live.number ? held : live
  const body = shown.body
  const kit = shown.kit
  const killedAt = shown.killedAt
  const last = log[0]
  const total = totalHealth(body.current)
  const maxTotal = totalHealth(body.max)
  const flash = last?.outcome && last.target === live.number ? { part: last.outcome.part, n: last.n } : undefined
  const markStep = scopeMode ? markStepAt(scopeMode, zoom) : undefined
  const hold = flight ? holdover(flight.drop, distance, markStep) : undefined
  const scene = { view, body, marks, cover, coverTextures, figure: shownFigure ? { ...shownFigure, urls: figureUrls } : undefined, masks, flash }

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
        {/* the build small, its modules changed at their cells (owner, 22.11.2026: «Сборка оружия должна быть слева в окошечке маленьком, не на весь экран») */}
        {weapon && startBuild && <RangeBuild key={`${weapon.id}|${buildKey}`} weapon={weapon} catalog={catalog} start={startBuild} ammo={ammo} lang={lang}
          onChange={(next) => setEdited({ start: startBuild, build: next })} />}
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
        : <ArmorChooser armor={armor} choice={choice} lang={lang} onChange={editKit} drawn={drawn} />}
    </aside>

    <main className="range-main">
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
        <div className="range-distance-chips" role="group" aria-label={t('Дистанция', 'Distance')}>
          {QUICK_DISTANCES.map((value) => <button key={value} type="button" className={distance === value ? 'is-on' : ''} onClick={() => setDistance(value)}>{value}</button>)}
        </div>
        <label className="range-inline"><span>{t('Пристрелка', 'Zero')}</span>
          <select className="select" value={zero} onChange={(event) => setZero(Number(event.target.value))}>
            {ZEROS.map((value) => <option key={value} value={value}>{value} {t('м', 'm')}</option>)}
          </select>
        </label>
        <div className="segmented-filter">
          {fireModes.map((value) => <button key={value} type="button" className={mode === value ? 'active' : ''} onClick={() => setFireMode(value)}>{pick(FIRE_MODE_NAMES[value] ?? [value, value], lang)}</button>)}
        </div>
        <div className="range-inline"><span>{t('Прицел', 'Scope')}</span>
          <RangeScopePicker scopes={scopes ?? []} value={scopeId} onChange={(id) => { setScopeId(id); setScopeModeIndex(0) }} parts={catalog.mods} lang={lang} />
        </div>
        {scope && scope.modes.length > 1 && <div className="segmented-filter">
          {scope.modes.map((entry, index) => <button key={index} type="button" className={index === scopeModeIndex ? 'active' : ''} onClick={() => setScopeModeIndex(index)}>×{entry.zoom}{entry.zoomMax && entry.zoomMax > entry.zoom ? `–${entry.zoomMax}` : ''}</button>)}
        </div>}
        <label className="range-inline"><span>{t('Укрытие', 'Cover')}</span>
          <select className="select" value={cover} onChange={(event) => setCover(event.target.value as Cover)}>
            {COVERS.map((value) => <option key={value} value={value}>{pick(COVER_NAMES[value], lang)}</option>)}
          </select>
        </label>
        <div className="range-toggles">
          {([['spread', t('Разброс', 'Spread')], ['recoil', t('Отдача', 'Recoil')], ['sway', t('Раскачка', 'Sway')], ['sound', t('Звук', 'Sound')], ['trace', t('Траектория', 'Trajectory')]] as const).map(([key, label]) => <button key={key} type="button" className={`range-chip${toggles[key] ? ' is-on' : ''}`} onClick={() => setToggles((current) => ({ ...current, [key]: !current[key] }))}>{label}</button>)}
        </div>
      </div>

      <div className="panel range-stage">
        <div className="range-stage-head">
          <span className="range-mag" title={t('R — перезарядка', 'R — reload')}>{t('Магазин', 'Magazine')} <b>{mag}</b> / {capacity}{mag === 0 && <em> · {t('R — перезарядка', 'R — reload')}</em>}</span>
          <span className="range-total">{t('HP', 'HP')} <b>{Math.max(0, Math.round(total))}</b> / {maxTotal}</span>
          <div className="range-stage-actions">
            <button type="button" className="button" onClick={reload} title={t('Перезарядить — R', 'Reload — R')}><RotateCcw size={14} /> {t('Перезарядить', 'Reload')} <kbd className="range-key">R</kbd></button>
            <button type="button" className="button" onClick={newTarget} title={t('Новая цель — F', 'New target — F')}><Crosshair size={14} /> {t('Новая цель', 'New target')} <kbd className="range-key">F</kbd></button>
            <button type="button" className="button" onClick={() => setMarks([])}><Eraser size={14} /> {t('Убрать отметки', 'Clear marks')}</button>
          </div>
        </div>
        {hold && <HoldLine hold={hold} markStep={markStep} zero={zero} distance={distance} zoom={zoom} lang={lang} />}
        <div className="range-target-wrap">
          <RangeScopeView scene={scene} distance={distance} mode={scopeMode ?? IRON_SIGHTS} modes={scope?.modes ?? [IRON_SIGHTS]} modeIndex={scope ? Math.min(scopeModeIndex, scope.modes.length - 1) : 0} onMode={setScopeModeIndex}
            zoom={zoom} onZoom={(next) => setZoom({ key: `${scopeId}|${scopeModeIndex}`, zoom: next })} irons={!scope}
            reticleUrls={reticleUrls} dropCm={flight?.drop ?? 0} boreCm={recoilCm(recoilNow, 'bore')} viewCm={recoilCm(recoilNow, 'view')} swayCm={swayCm} lang={lang}
            tracer={toggles.trace ? tracer : null}
            onFireStart={fireStart} onFireEnd={fireEnd} onAim={onScopeAim} />
          {body.dead && <div className="range-dead">
            <b>{t('Убит', 'Killed')}</b>
            <span>{killedAt ? `${killedAt} ${t('выстр.', 'shots')} · ${weapon?.fireRate ? `${((killedAt - 1) * 60 / weapon.fireRate + (flight?.time ?? 0)).toFixed(2)} ${t('с', 's')}` : ''}` : ''}</span>
            <button type="button" className="button primary" onClick={newTarget}>{t('Новая цель', 'New target')}</button>
          </div>}
        </div>
        {ammo && <DropTable rows={DROP_TABLE_DISTANCES.flatMap((at) => {
          const point = flightAt(ammo, stats?.velocity, zero, at, zeroAmmo)
          return point ? [{ distance: at, time: point.time, speed: point.speed, energy: point.energy, ...holdover(point.drop, at, markStep) }] : []
        })} distance={distance} zero={zero} marks={markStep !== undefined} ammoName={ammo.shortName} zeroAmmoName={zeroAmmo && zeroAmmo.id !== ammo.id ? zeroAmmo.shortName : undefined} lang={lang} />}
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

function ArmorChooser({ armor, choice, lang, onChange, drawn }: { armor: ArmorCatalog; choice: KitChoice; lang: Locale; onChange: (patch: Partial<KitChoice>) => void; drawn?: (id: string) => boolean }) {
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
  const pictured = (item: RangeItem) => ({
    id: item.id,
    name: item.shortName,
    sub: `${t('класс', 'class')} ${item.armorClass} · ${item.name}`,
    ...(item.icon ? { picture: <img src={item.icon} alt="" loading="lazy" draggable={false} /> } : {}),
  })
  const listed = (items: RangeItem[], chosen?: RangeItem) => {
    const list = oneOfEachModel(items, drawn).sort((a, b) => b.armorClass - a.armorClass || a.shortName.localeCompare(b.shortName))
    return chosen && !list.some((item) => item.id === chosen.id) ? [chosen, ...list] : list
  }
  const picker = (label: string, value: string | undefined, items: RangeItem[], set: (id: string | undefined) => void) => <div key={label} className="range-field">
    <span>{label}{value && armor.items.get(value) ? <> {classBadge(armor.items.get(value)!.armorClass)}</> : null}</span>
    <RangePicker groups={[{ items: items.map(pictured) }]} value={value ?? ''} onChange={(id) => set(id || undefined)} none={t('Нет', 'None')} label={label} />
  </div>
  // the visors drawn on this helmet only (a visor with no picture of it lowered on that helmet would not show)
  const visors = helmet ? helmet.visors.map((id) => armor.items.get(id)!).filter((visor) => visor && (!drawn || Boolean(drawn(`${helmet.id}-${visor.id}`)))) : []
  // body armour and armoured rigs in one list (owner, 23.11.2026: «В одном списке должны быть бронеразгрузки и бронежилеты»)
  const bodies = [...of(['armor']), ...of(['rig']).filter((item) => item.plateSlots.length > 0 || item.armorClass > 0)]
  return <section className="panel range-card">
    <h2 className="range-card-title">{t('Броня', 'Armour')}</h2>
    {picker(t('Шлем', 'Helmet'), choice.helmet, listed(of(['helmet']), helmet), (id) => onChange({ helmet: id, visor: undefined, module: undefined }))}
    {helmet && visors.length > 0 && select(t('Забрало', 'Visor'), choice.visor, visors, (id) => onChange({ visor: id }))}
    {helmet && helmet.modules.length > 0 && select(t('Модуль шлема', 'Helmet module'), choice.module, helmet.modules.map((id) => armor.items.get(id)!).filter(Boolean), (id) => onChange({ module: id }))}
    {picker(t('Бронежилет или бронеразгрузка', 'Body armour or armoured rig'), choice.body, listed(bodies, body), (id) => onChange({ body: id, plates: defaultPlates(armor, id) }))}
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

/** A dressed target's kit without a face piece or glasses (owner, 23.11.2026). */
function withoutFaceKit(choice: KitChoice): KitChoice {
  if (!choice.face && !choice.eyewear) return choice
  return { ...choice, face: undefined, eyewear: undefined }
}

/** A figure with a decimal comma in Russian; never «-0,0». */
const number = (value: number, lang: Locale, digits = 1) => {
  const shown = Math.abs(value) < 0.5 * 10 ** -digits ? 0 : value
  return shown.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}
/** Centimetres up to a metre, then metres: «43,4 см», «2,29 м». */
const length = (cm: number, lang: Locale) => cm < 100 ? `${number(cm, lang)} ${lang === 'en' ? 'cm' : 'см'}` : `${number(cm / 100, lang, 2)} ${lang === 'en' ? 'm' : 'м'}`
/** «1 риска», «3 риски», «5 рисок», «1,5 риски». */
function marksWord(count: number, lang: Locale) {
  if (lang === 'en') return count === 1 ? 'mark' : 'marks'
  if (!Number.isInteger(count)) return 'риски'
  const tens = count % 100
  const ones = count % 10
  if (tens >= 11 && tens <= 14) return 'рисок'
  if (ones === 1) return 'риска'
  if (ones >= 2 && ones <= 4) return 'риски'
  return 'рисок'
}

/**
 * The hold at the distance (owner, 23.11.2026: «вынос вверх 1,5 МРАДа. Там сделай вопросик в кружочке и объясни, что это значит.
 * Объясни, что нужно выносом целиться на риску ниже… И где МОА пишется у нас, там тоже вопросик. И напиши единицы измерения»):
 * mrad and MOA with what they mean, the reticle's marks when their step is known, and how to aim with them.
 */
function HoldLine({ hold, markStep, zero, distance, zoom, lang }: { hold: ReturnType<typeof holdover>; markStep?: number; zero: number; distance: number; zoom: number; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const below = hold.mrad >= 0
  const none = Math.abs(hold.mrad) < 0.05
  const marks = hold.marks !== undefined ? Math.round(Math.abs(hold.marks) * 10) / 10 : undefined
  const aim = none
    ? t('Цельтесь центром сетки: на этой дистанции пуля приходит в центр.', 'Aim with the centre: at this distance the bullet goes to the centre.')
    : marks !== undefined
      ? below
        ? t(`Поставьте цель на ${number(marks, lang)} ${marksWord(marks, lang)} ниже центра сетки — туда же показывает полоска в прицеле.`, `Put the target ${number(marks, lang)} ${marksWord(marks, lang)} below the centre — the bar in the scope shows the same place.`)
        : t(`Поставьте цель на ${number(marks, lang)} ${marksWord(marks, lang)} выше центра сетки — туда же показывает полоска в прицеле.`, `Put the target ${number(marks, lang)} ${marksWord(marks, lang)} above the centre — the bar in the scope shows the same place.`)
      : below
        ? t('Поставьте цель на полоску в прицеле: она ниже центра ровно на вынос.', 'Put the target on the bar in the scope: it is below the centre by exactly the hold.')
        : t('Поставьте цель на полоску в прицеле: она выше центра ровно на вынос.', 'Put the target on the bar in the scope: it is above the centre by exactly the hold.')
  return <div className="range-holdover">
    <div className="range-hold-main">
      <b>{none ? t('Вынос не нужен', 'No hold') : `${below ? t('Вынос вверх', 'Hold up') : t('Вынос вниз', 'Hold down')} ${number(Math.abs(hold.mrad), lang)} ${t('мрад', 'mrad')}`}</b>
      <RangeHelpTip label={t('Что такое вынос', 'What the hold is')}>
        {t(
          'Вынос — насколько поднять ствол над целью, чтобы пуля до неё долетела. Пуля летит дугой: дальше дистанции пристрелки она падает ниже точки прицеливания. Поэтому целятся не центром сетки, а риской ниже центра: цель ставят на риску, которая ниже центра на величину выноса. Центр тогда смотрит выше цели, ствол поднят — и пуля попадает. Полоска в прицеле показывает это место. Вместо выноса можно поднять барабан вертикальных поправок на столько же мрад или MOA и целиться центром.',
          'The hold is how far to raise the barrel above the target for the bullet to reach it. The bullet flies in an arc: past the zero distance it falls below the point of aim. So you aim not with the centre but with a mark below it: put the target on the mark that is below the centre by the hold. The centre then looks above the target, the barrel is raised and the bullet hits. The bar in the scope shows that place. Instead of holding, you can dial the elevation turret by as many mrad or MOA and aim with the centre.',
        )}
      </RangeHelpTip>
      {!none && <b>{number(Math.abs(hold.moa), lang)} MOA</b>}
      <RangeHelpTip label={t('Что такое мрад и MOA', 'What mrad and MOA are')}>
        {t(
          'Мрад и MOA — единицы угла, поэтому в сантиметрах они растут вместе с дистанцией. 1 мрад = 10 см на 100 м, 20 см на 200 м, 50 см на 500 м. 1 MOA = 2,9 см на 100 м, 5,8 см на 200 м, 14,5 см на 500 м. 1 мрад ≈ 3,44 MOA. Считать так: см = мрад × дистанция в метрах ÷ 10. Падение пули растёт быстрее дистанции, поэтому вынос в мрад и MOA тоже растёт с дистанцией — смотрите таблицу ниже.',
          'Mrad and MOA are angles, so in centimetres they grow with the distance. 1 mrad = 10 cm at 100 m, 20 cm at 200 m, 50 cm at 500 m. 1 MOA = 2.9 cm at 100 m, 5.8 cm at 200 m, 14.5 cm at 500 m. 1 mrad ≈ 3.44 MOA. To count: cm = mrad × distance in metres ÷ 10. The drop grows faster than the distance, so the hold in mrad and MOA grows with it too — see the table below.',
        )}
      </RangeHelpTip>
      {!none && marks !== undefined && markStep !== undefined && <b>{number(marks, lang)} {marksWord(marks, lang)}</b>}
      {!none && marks !== undefined && markStep !== undefined && <RangeHelpTip label={t('Что такое риски', 'What the marks are')}>
        {t(
          `Риски — отметки на вертикальной линии сетки ниже центра. У этой сетки на ×${number(zoom, lang, zoom % 1 ? 1 : 0)} между соседними рисками ${number(markStep, lang, 2)} мрад (${number(mradToMoa(markStep), lang, 2)} MOA). Вынос ${number(Math.abs(hold.mrad), lang)} мрад — это ${number(marks, lang)} ${marksWord(marks, lang)}.`,
          `The marks are the ticks on the reticle's vertical line below the centre. On this reticle at ×${number(zoom, lang, zoom % 1 ? 1 : 0)} two neighbouring marks are ${number(markStep, lang, 2)} mrad apart (${number(mradToMoa(markStep), lang, 2)} MOA). A hold of ${number(Math.abs(hold.mrad), lang)} mrad is ${number(marks, lang)} ${marksWord(marks, lang)}.`,
        )}
      </RangeHelpTip>}
    </div>
    <span className="range-hold-aim">{aim}</span>
    <span>{t('пуля', 'the bullet')} {hold.dropCm <= 0 ? t('ниже', 'below') : t('выше', 'above')} {t('линии прицела на', 'the sight line by')} {length(Math.abs(hold.dropCm), lang)} · {distance} {t('м', 'm')} · {t('пристрелка', 'zero')} {zero} {t('м', 'm')} · ×{number(zoom, lang, zoom % 1 ? 1 : 0)}</span>
  </div>
}

/** How far the bullet falls at each distance (owner, 23.11.2026: «Напиши, на сколько… падает пуля на каждой дистанции»). */
/**
 * The bullet at each distance as the game flies it (src/arsenal/ballistics.ts, checked against EFT.Ballistics.TrajectoryCalculator:
 * the G1 drag of the round's mass, diameter and coefficient, air 1.2 kg/m³, gravity 9.81 m/s², steps of 0.01 s; the sight zeroed
 * with the weapon's default round): its height against the line of sight and the hold, its time in flight, speed and energy (owner,
 * 23.11.2026: «исходя из их траектории в игре, вычисли время полета пули, скорость, энергию пули, силу притяжения… на разные
 * дистанции»).
 */
function DropTable({ rows, distance, zero, marks, ammoName, zeroAmmoName, lang }: {
  rows: Array<{ distance: number; time: number; speed: number; energy: number } & ReturnType<typeof holdover>>; distance: number; zero: number; marks: boolean; ammoName: string; zeroAmmoName?: string; lang: Locale
}) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const nearest = rows.reduce<number | undefined>((best, row) => best === undefined || Math.abs(row.distance - distance) < Math.abs(best - distance) ? row.distance : best, undefined)
  return <details className="range-drops" open>
    <summary>{t('Падение пули по дистанциям', 'Bullet drop by distance')} · {ammoName} · {t('пристрелка', 'zero')} {zero} {t('м', 'm')}{zeroAmmoName ? ` ${t('по', 'with')} ${zeroAmmoName}` : ''}</summary>
    <table>
      <thead><tr>
        <th>{t('Дистанция', 'Distance')}</th><th>{t('Пуля от линии прицела', 'Bullet vs sight line')}</th><th>{t('Вынос, мрад', 'Hold, mrad')}</th><th>MOA</th>{marks && <th>{t('Рисок', 'Marks')}</th>}
        <th>{t('Время', 'Time')}</th><th>{t('Скорость', 'Speed')}</th><th>{t('Энергия', 'Energy')}</th>
      </tr></thead>
      <tbody>{rows.map((row) => <tr key={row.distance} className={row.distance === nearest ? 'is-current' : row.distance === zero ? 'is-zero' : undefined}>
        <td>{row.distance} {t('м', 'm')}{row.distance === zero ? ` · ${t('пристрелка', 'zero')}` : ''}</td>
        <td>{Math.abs(row.dropCm) < 0.05 ? '0' : `${row.dropCm < 0 ? '↓' : '↑'} ${length(Math.abs(row.dropCm), lang)}`}</td>
        <td>{number(Math.abs(cmToMrad(row.dropCm, row.distance)), lang)}</td>
        <td>{number(Math.abs(row.moa), lang)}</td>
        {marks && <td>{row.marks !== undefined ? number(Math.abs(row.marks), lang) : '—'}</td>}
        <td>{row.time.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {t('с', 's')}</td>
        <td>{Math.round(row.speed)} {t('м/с', 'm/s')}</td>
        <td>{Math.round(row.energy).toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')} {t('Дж', 'J')}</td>
      </tr>)}</tbody>
    </table>
    <p>{t('↓ — пуля ниже линии прицела: вынос вверх; ↑ — выше: вынос вниз. Риски — на кратности, что сейчас в прицеле.', '↓ — the bullet below the sight line: hold up; ↑ — above it: hold down. Marks at the magnification in the scope now.')}</p>
  </details>
}

/** A dressed target's helmet and body armour as a colour of their model that can be drawn worn (src/range/rangeLists.ts). */
function drawnKit(choice: KitChoice, armor: ArmorCatalog, drawn?: (id: string) => boolean): KitChoice {
  if (!drawn) return choice
  const helmet = drawnVariant(choice.helmet ? armor.items.get(choice.helmet) : undefined, armor.list.filter((item) => item.kind === 'helmet'), drawn)
  const body = drawnVariant(choice.body ? armor.items.get(choice.body) : undefined, armor.list.filter((item) => item.kind === 'armor' || item.kind === 'rig'), drawn)
  if ((helmet?.id ?? choice.helmet) === choice.helmet && (body?.id ?? choice.body) === choice.body) return choice
  return {
    ...choice,
    ...(helmet && helmet.id !== choice.helmet ? { helmet: helmet.id, visor: undefined, module: undefined } : {}),
    ...(body && body.id !== choice.body ? { body: body.id, plates: defaultPlates(armor, body.id) } : {}),
  }
}
