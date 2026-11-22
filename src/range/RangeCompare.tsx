import { useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, Play } from 'lucide-react'
import type { BuildStats } from '../arsenal/buildStats'
import type { AmmoStats, GunCatalog, Weapon } from '../arsenal/gunTypes'
import { defaultPlates, kitPieces, type ArmorCatalog, type KitChoice } from './rangeArmor'
import { seededRandom, type ArmorPiece, type BodyPart, type Health, type Round } from './rangeModel'
import { COMPARE_ZONES, SCHEMATIC, series, timeToKill, type AimSetup, type Geometry, type SeriesResult } from './rangeShot'
import { flightAt, muzzleSpeed } from './rangeFlight'
import { CLASS_COLORS } from './rangeView'

type Locale = 'ru' | 'en'
type Subject = 'ammo' | 'body' | 'helmet' | 'plate'

interface Row { key: string; label: string; detail: string; armorClass?: number; round: Round; kit: ArmorPiece[]; flightTime: number }

const RUNS = [100, 300, 1000]
const DEFAULT_ZONES = ['thorax', 'head', 'stomach', 'arms', 'legs']
const MAX_ROWS = 24

/**
 * «Сравнение»: series of characters shot at one zone until dead — the rounds of the caliber against the target's kit, or body
 * armours, helmets and plates against the chosen round — shots to kill on average (median under it) and the time at the
 * weapon's fire rate. Every run is a fresh character in fresh armour; spread and recoil as on the range.
 */
export function RangeCompare({ lang, armor, rounds, ammo, weapon, stats, health, blackedOut, choice, kit, distance, zero, setup, mode, targetName, geometry = SCHEMATIC }: {
  lang: Locale
  catalog: GunCatalog
  armor: ArmorCatalog
  rounds: AmmoStats[]
  ammo?: AmmoStats
  weapon?: Weapon
  stats?: BuildStats
  health: Health
  blackedOut: BodyPart[]
  choice: KitChoice
  kit: ArmorPiece[]
  distance: number
  zero: number
  setup: AimSetup
  mode: string
  targetName: string
  /** The target's zones (the pictured body's when there are pictures). */
  geometry?: Geometry
}) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const [subject, setSubject] = useState<Subject>('ammo')
  const [zones, setZones] = useState<string[]>(DEFAULT_ZONES)
  const [runs, setRuns] = useState(300)
  const [minClass, setMinClass] = useState(3)
  // shots one after another in a burst, the recoil climbing (off: every shot aimed afresh)
  const [inBurst, setInBurst] = useState(false)
  const [results, setResults] = useState<Record<string, SeriesResult>>({})
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const job = useRef(0)

  const roundOf = (entry: AmmoStats): { round: Round; flightTime: number } => {
    const flight = flightAt(entry, muzzleSpeed(entry, stats?.velocityModifierSum), zero, distance)
    return {
      round: { damage: flight?.damage ?? entry.damage, penetration: flight?.penetration ?? entry.penetration, armorDamage: (entry.armorDamage ?? 0) / 100, penetrationDeviation: armor.deviation[entry.id] },
      flightTime: flight?.time ?? 0,
    }
  }

  const rows: Row[] = useMemo(() => {
    if (subject === 'ammo') return rounds.slice(0, MAX_ROWS).map((entry) => ({ key: entry.id, label: entry.shortName, detail: `${Math.round(entry.damage)}${(entry.projectileCount ?? 1) > 1 ? `×${entry.projectileCount}` : ''} / ${Math.round(entry.penetration)} / ${Math.round(entry.armorDamage ?? 0)}%`, kit, ...roundOf(entry) }))
    if (!ammo) return []
    const base = roundOf(ammo)
    const withChoice = (patch: Partial<KitChoice>) => kitPieces(armor, { ...choice, ...patch })
    if (subject === 'body') return armor.list.filter((item) => (item.kind === 'armor' || item.kind === 'rig') && item.armorClass >= minClass).slice(0, 80)
      .map((item) => ({ item, kit: withChoice({ body: item.id, plates: defaultPlates(armor, item.id) }) }))
      .sort((a, b) => b.item.armorClass - a.item.armorClass)
      .slice(0, MAX_ROWS)
      .map(({ item, kit: pieces }) => ({ key: item.id, label: item.shortName, detail: `${t('класс', 'class')} ${item.armorClass}`, armorClass: item.armorClass, kit: pieces, ...base }))
    if (subject === 'helmet') return armor.list.filter((item) => item.kind === 'helmet' && item.armorClass >= minClass).slice(0, MAX_ROWS)
      .map((item) => ({ key: item.id, label: item.shortName, detail: `${t('класс', 'class')} ${item.armorClass}`, armorClass: item.armorClass, kit: withChoice({ helmet: item.id, visor: undefined, module: undefined }), ...base }))
    const body = choice.body ? armor.items.get(choice.body) : undefined
    const slot = body?.plateSlots[0]
    if (!body || !slot) return []
    return slot.allowed.map((id) => armor.items.get(id)).filter((item): item is NonNullable<typeof item> => Boolean(item && item.armorClass >= minClass))
      .sort((a, b) => b.armorClass - a.armorClass).slice(0, MAX_ROWS)
      .map((item) => ({ key: item.id, label: item.shortName, detail: `${t('класс', 'class')} ${item.armorClass}`, armorClass: item.armorClass, kit: withChoice({ plates: { ...choice.plates, [slot.name]: item.id } }), ...base }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject, rounds, ammo, armor, choice, kit, minClass, distance, zero, stats?.velocityModifierSum, lang])

  const chosenZones = COMPARE_ZONES.filter((zone) => zones.includes(zone.key))
  const settingsKey = `${subject}|${rows.map((row) => row.key).join(',')}|${zones.join(',')}|${runs}|${distance}|${zero}|${JSON.stringify(choice)}|${setup.spread}|${setup.recoil}|${mode}|${inBurst}|${blackedOut.join(',')}|${JSON.stringify(health)}`
  const [shownKey, setShownKey] = useState(settingsKey)
  if (shownKey !== settingsKey) { setShownKey(settingsKey); setResults({}); setProgress(null) }
  // a change of the settings (or leaving the tab) stops a series in progress
  useEffect(() => { job.current += 1 }, [settingsKey])
  useEffect(() => () => { job.current += 1 }, [])

  const run = async () => {
    const id = ++job.current
    const total = rows.length * chosenZones.length
    const next: Record<string, SeriesResult> = {}
    setResults({})
    setProgress({ done: 0, total })
    let done = 0
    const burst = !inBurst ? 1 : mode === 'fullauto' ? 1_000 : mode === 'burst' ? 3 : mode === 'doublet' ? 2 : 1
    for (const row of rows) {
      for (const zone of chosenZones) {
        // let the page draw between cells
        await new Promise((resolve) => window.setTimeout(resolve, 0))
        if (job.current !== id) return
        next[`${row.key}|${zone.key}`] = series(row.kit, health, blackedOut, zone, row.round, setup, runs, seededRandom(runs * 7919 + done), burst, geometry)
        done++
        setProgress({ done, total })
        setResults({ ...next })
      }
    }
    setProgress(null)
  }

  const fireRate = weapon?.fireRate ?? 0
  const best = (zoneKey: string) => Math.min(...rows.map((row) => results[`${row.key}|${zoneKey}`]?.mean ?? Infinity))

  return <div className="range-compare">
    <section className="panel range-card range-compare-setup">
      <div className="range-compare-row">
        <div className="segmented-filter">
          {([['ammo', t('Патроны', 'Rounds')], ['body', t('Бронежилеты', 'Body armour')], ['helmet', t('Шлемы', 'Helmets')], ['plate', t('Плиты', 'Plates')]] as const).map(([key, label]) => <button key={key} type="button" className={subject === key ? 'active' : ''} onClick={() => setSubject(key)}>{label}</button>)}
        </div>
        {subject !== 'ammo' && <label className="range-inline"><span>{t('Класс от', 'Class from')}</span>
          <select className="select" value={minClass} onChange={(event) => setMinClass(Number(event.target.value))}>{[1, 2, 3, 4, 5, 6].map((value) => <option key={value} value={value}>{value}</option>)}</select>
        </label>}
        <div className="segmented-filter">
          {RUNS.map((value) => <button key={value} type="button" className={runs === value ? 'active' : ''} onClick={() => setRuns(value)}>{value}</button>)}
        </div>
        <button type="button" className="button primary" onClick={() => void run()} disabled={!rows.length || !chosenZones.length || Boolean(progress)}>
          {progress ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} {t('Считать', 'Run')}
        </button>
      </div>
      <div className="range-zone-picks">
        <button type="button" className={`range-chip${inBurst ? ' is-on' : ''}`} onClick={() => setInBurst(!inBurst)} title={t('Выстрелы очередью с отдачей; без этого каждый выстрел прицельный', 'Shots in a burst with recoil; otherwise every shot is aimed')}>{t('Очередью', 'In a burst')}</button>
        <span className="range-divider" />
        {COMPARE_ZONES.map((zone) => <button key={zone.key} type="button" className={`range-chip${zones.includes(zone.key) ? ' is-on' : ''}`} onClick={() => setZones((current) => current.includes(zone.key) ? current.filter((key) => key !== zone.key) : [...current, zone.key])}>{lang === 'en' ? zone.en : zone.ru}</button>)}
      </div>
      <p className="range-note">
        {t('Цель', 'Target')}: <b>{targetName}</b> · {distance} {t('м', 'm')} · {subject === 'ammo' ? t('броня цели', 'the target’s armour') : `${t('патрон', 'round')} ${ammo?.shortName ?? '—'}`} · {setup.spread ? t('с разбросом', 'with spread') : t('без разброса', 'no spread')}{inBurst && mode !== 'single' && setup.recoil ? ` · ${t('очередью', 'in a burst')}` : ''}
        {progress && <> · {progress.done}/{progress.total}</>}
      </p>
    </section>

    <section className="panel range-card range-compare-table-wrap">
      {!rows.length && <p className="range-empty">{subject === 'plate' ? t('Выберите бронежилет с плитами.', 'Choose body armour with plates.') : t('Нечего сравнивать.', 'Nothing to compare.')}</p>}
      {rows.length > 0 && <table className="range-compare-table">
        <thead><tr>
          <th>{subject === 'ammo' ? t('Патрон', 'Round') : t('Броня', 'Armour')}</th>
          {chosenZones.map((zone) => <th key={zone.key}>{lang === 'en' ? zone.en : zone.ru}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.key}>
            <th>
              {row.armorClass ? <span className="range-class" style={{ background: CLASS_COLORS[row.armorClass] }}>{row.armorClass}</span> : null}
              <b>{row.label}</b><small>{row.detail}</small>
            </th>
            {chosenZones.map((zone) => {
              const result = results[`${row.key}|${zone.key}`]
              if (!result) return <td key={zone.key} className="is-wait">·</td>
              const isBest = subject === 'ammo' && Number.isFinite(result.mean) && result.mean === best(zone.key)
              if (!Number.isFinite(result.mean)) return <td key={zone.key} className="is-never">{t('не убил', 'no kill')}</td>
              const ttk = timeToKill(result.mean, fireRate, row.flightTime)
              return <td key={zone.key} className={isBest ? 'is-best' : ''} title={`${t('медиана', 'median')} ${result.median} · ${result.min}–${result.max} · ${t('пробитий', 'penetrated')} ${Math.round(result.throughShare * 100)}%`}>
                <b>{result.mean.toFixed(1)}</b>
                <small>{Number.isFinite(ttk) ? `${ttk.toFixed(2)} ${t('с', 's')}` : ''}{result.killedShare < 1 ? ` · ${Math.round(result.killedShare * 100)}%` : ''}</small>
              </td>
            })}
          </tr>)}
        </tbody>
      </table>}
      <p className="range-note">{t('В ячейке — выстрелов до смерти в среднем и время при скорострельности оружия. Наведите, чтобы увидеть медиану и разброс.', 'Each cell: shots to kill on average and the time at the weapon’s fire rate. Hover for the median and the range.')}</p>
    </section>
  </div>
}
