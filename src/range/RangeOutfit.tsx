import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { Pause, Play, RotateCcw } from 'lucide-react'
import type { ArmorCatalog, RangeItem } from './rangeArmor'
import type { FigureIndex, FigurePicture } from './rangeFigures'
import { useFigureUrls } from './rangeFigureSource'
import { CLASS_COLORS } from './rangeView'

type Locale = 'ru' | 'en'

/** The turn's steps: 36 pictures, 10° apart (E:\SPT-photo\studio: the camera round the body, the lights with it). */
export const SPIN_STEPS = 36
const spinView = (step: number) => `r${String(((step % SPIN_STEPS) + SPIN_STEPS) % SPIN_STEPS * 10).padStart(3, '0')}`

/** The stage in figure centimetres: wide enough for the arms, tall enough for a helmet. */
const STAGE = { left: -60, width: 120, top: 205, height: 212 }

interface Layer { id: string; item?: RangeItem; visor?: RangeItem; label: string }

/**
 * «Конструктор» (owner, 22.11.2026: «Сделай мне 3д модель чвк и несколько бронежилетов что бы можно было переключать их и несколько
 * касок … конструктор одежды персонажа»): the PMC turned round by hand or by itself, a body armour or rig and a helmet put on and taken
 * off. Pictures of the game's own models from 36 sides (no model leaves the game), the body hiding what is behind it in each.
 */
export function RangeOutfit({ index, armor, lang }: { index: FigureIndex; armor: ArmorCatalog; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const layers = useMemo(() => {
    const vests: Layer[] = []
    const helmets: Layer[] = []
    for (const name of Object.keys(index.pictures)) {
      if (!name.startsWith('spin-') || name.startsWith('spin-body-')) continue
      const [id, visorId] = name.slice(5).split('-')
      const item = armor.items.get(id!)
      const visor = visorId ? armor.items.get(visorId) : undefined
      const label = item ? `${item.shortName}${visor ? (lang === 'en' ? ' (visor)' : ' (с забралом)') : ''}` : id!
      const layer = { id: name, item, visor, label }
      if (item?.kind === 'helmet') helmets.push(layer)
      else vests.push(layer)
    }
    const byName = (a: Layer, b: Layer) => a.label.localeCompare(b.label)
    return { vests: vests.sort(byName), helmets: helmets.sort(byName) }
  }, [index, armor, lang])
  const bodies = ['spin-body-pmcusec', 'spin-body-pmcbear'].filter((name) => index.pictures[name])
  const [body, setBody] = useState(bodies[0] ?? '')
  const [vest, setVest] = useState(() => layers.vests[0]?.id ?? '')
  const [helmet, setHelmet] = useState(() => layers.helmets[0]?.id ?? '')
  const [step, setStep] = useState(0)
  const [spinning, setSpinning] = useState(true)

  // every picture of the chosen layers, all 36 sides, so the turn never waits for one
  const chosen = useMemo(() => [body, vest, helmet].filter(Boolean), [body, vest, helmet])
  const files = useMemo(() => chosen.flatMap((name) => Array.from({ length: SPIN_STEPS }, (_, i) => index.pictures[name]?.[spinView(i)]?.file).filter((file): file is string => Boolean(file))), [chosen, index])
  const urls = useFigureUrls(files)
  const ready = files.length > 0 && files.every((file) => urls[file])

  useEffect(() => {
    if (!spinning) return
    const timer = window.setInterval(() => setStep((value) => value + 1), 140)
    return () => window.clearInterval(timer)
  }, [spinning])

  const drag = useRef<{ x: number; step: number } | null>(null)
  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { x: event.clientX, step }
    setSpinning(false)
    try { event.currentTarget.setPointerCapture(event.pointerId) } catch { /* not captured */ }
  }
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    // a full turn for about 540 px of dragging
    setStep(drag.current.step - Math.round((event.clientX - drag.current.x) / 15))
  }
  const onUp = () => { drag.current = null }

  const view = spinView(step)
  const pictures = chosen.map((name) => index.pictures[name]?.[view]).filter((picture): picture is FigurePicture => Boolean(picture))
  const vestLayer = layers.vests.find((layer) => layer.id === vest)
  const helmetLayer = layers.helmets.find((layer) => layer.id === helmet)

  if (!bodies.length) return <section className="panel range-card"><p className="range-empty">{t('В этой сборке нет снимков для конструктора.', 'This build has no pictures for the outfit builder.')}</p></section>

  return <div className="range-outfit">
    <aside className="range-side">
      <section className="panel range-card">
        <h2 className="range-card-title">{t('Персонаж', 'Character')}</h2>
        <div className="segmented-filter">
          {bodies.map((name) => <button key={name} type="button" className={body === name ? 'active' : ''} onClick={() => setBody(name)}>{name.endsWith('usec') ? 'USEC' : 'BEAR'}</button>)}
        </div>
      </section>
      <OutfitList title={t('Бронежилет или разгрузка', 'Body armour or rig')} layers={layers.vests} value={vest} onChange={setVest} lang={lang} />
      <OutfitList title={t('Каска', 'Helmet')} layers={layers.helmets} value={helmet} onChange={setHelmet} lang={lang} />
    </aside>
    <section className="panel range-outfit-stage">
      <div className="range-outfit-tools">
        <button type="button" className="button" onClick={() => setSpinning(!spinning)}>{spinning ? <Pause size={14} /> : <Play size={14} />} {spinning ? t('Стоп', 'Stop') : t('Вращать', 'Turn')}</button>
        <button type="button" className="button" onClick={() => { setStep(0); setSpinning(false) }}><RotateCcw size={14} /> {t('Спереди', 'Front')}</button>
        <input type="range" min={0} max={SPIN_STEPS - 1} value={((step % SPIN_STEPS) + SPIN_STEPS) % SPIN_STEPS} onChange={(event) => { setSpinning(false); setStep(Number(event.target.value)) }} aria-label={t('Поворот', 'Turn')} />
        <span className="range-note">{t('Тяните мышью, чтобы повернуть', 'Drag to turn')}</span>
      </div>
      <div className={`range-outfit-view${ready ? '' : ' is-loading'}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {pictures.map((picture) => urls[picture.file]
          ? <img key={picture.file.replace(/\.r\d{3}\./, '.')} src={urls[picture.file]} alt="" draggable={false} style={{
            left: `${(picture.x - STAGE.left) / STAGE.width * 100}%`,
            top: `${(STAGE.top - picture.top) / STAGE.height * 100}%`,
            width: `${picture.width / STAGE.width * 100}%`,
            height: `${picture.height / STAGE.height * 100}%`,
          }} />
          : null)}
        {!ready && <span className="range-outfit-wait">{t('Загружаем снимки…', 'Loading the pictures…')}</span>}
      </div>
      <div className="range-outfit-facts">
        {[vestLayer, helmetLayer].filter((layer): layer is Layer => Boolean(layer?.item)).map((layer) => <ItemFacts key={layer.id} layer={layer} lang={lang} />)}
      </div>
    </section>
  </div>
}

function OutfitList({ title, layers, value, onChange, lang }: { title: string; layers: Layer[]; value: string; onChange: (id: string) => void; lang: Locale }) {
  return <section className="panel range-card">
    <h2 className="range-card-title">{title}</h2>
    <div className="range-outfit-list">
      <button type="button" className={`range-outfit-choice${value === '' ? ' is-on' : ''}`} onClick={() => onChange('')}>{lang === 'en' ? 'None' : 'Нет'}</button>
      {layers.map((layer) => <button key={layer.id} type="button" className={`range-outfit-choice${value === layer.id ? ' is-on' : ''}`} onClick={() => onChange(layer.id)}>
        {layer.item ? <span className="range-class" style={{ background: CLASS_COLORS[Math.max(layer.item.armorClass, layer.visor?.armorClass ?? 0)] }}>{Math.max(layer.item.armorClass, layer.visor?.armorClass ?? 0)}</span> : null}
        <span>{layer.label}</span>
      </button>)}
    </div>
  </section>
}

function ItemFacts({ layer, lang }: { layer: Layer; lang: Locale }) {
  const item = layer.item!
  const pieces = [...item.pieces, ...(layer.visor?.pieces ?? [])]
  const durability = pieces.reduce((sum, piece) => sum + piece.maxDurability, 0)
  return <div className="range-outfit-fact">
    <img src={item.icon} alt="" loading="lazy" />
    <div>
      <b>{item.name}{layer.visor ? (lang === 'en' ? ', visor' : ', с забралом') : ''}</b>
      <small>{lang === 'en' ? 'class' : 'класс'} {Math.max(item.armorClass, layer.visor?.armorClass ?? 0)} · {lang === 'en' ? 'durability' : 'прочность'} {Math.round(durability)}{item.plateSlots.length ? ` · ${lang === 'en' ? 'plates' : 'плиты'}: ${item.plateSlots.length}` : ''}</small>
    </div>
  </div>
}
