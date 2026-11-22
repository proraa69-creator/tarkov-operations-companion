import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { RANGE_TARGETS, type ArmorCatalog, type RangeItem } from './rangeArmor'
import type { FigureIndex, FigurePicture } from './rangeFigures'
import { useFigureUrls } from './rangeFigureSource'
import { CLASS_COLORS } from './rangeView'

type Locale = 'ru' | 'en'
type Slot = 'body' | 'helmet' | 'face' | 'eyewear'
type Clothes = 'upper' | 'lower'

/** The stage in figure centimetres: wide enough for the arms, tall enough for a helmet. */
const STAGE = { left: -60, width: 120, top: 205, height: 212 }
/** Bottom first: what is worn over what. */
const ORDER: Slot[] = ['body', 'face', 'eyewear', 'helmet']

interface Choice { name: string; item: RangeItem; visor?: RangeItem; label: string; armorClass: number }

/**
 * «Конструктор» (owner, 22.11.2026: «Делай, короче, просто вид спереди и сзади. И чтобы одевалась броня, каска и так далее. Менялась по
 * кнопке»): a character from the front and the back, and every body armour, rig, helmet (with its visor where it comes with one), mask
 * and pair of glasses of the game put on and changed by a button. The pictures are the game's own models (E:\SPT-photo\studio: each item
 * worn on the same hidden body, the body hiding what is behind it), laid over the character.
 */
export function RangeOutfit({ index, armor, lang }: { index: FigureIndex; armor: ArmorCatalog; lang: Locale }) {
  const t = (ru: string, en: string) => lang === 'en' ? en : ru
  const characters = useMemo(() => [
    ...['pmcusec', 'pmcbear'].filter((key) => index.pictures[`body-${key}`]).map((key) => ({ name: `body-${key}`, label: `${lang === 'en' ? 'PMC' : 'ЧВК'} ${key === 'pmcusec' ? 'USEC' : 'BEAR'}` })),
    ...RANGE_TARGETS.filter((target) => target.group !== 'pmc' && index.pictures[`bare-${target.key}`]).map((target) => ({ name: `bare-${target.key}`, label: lang === 'en' ? target.en : target.ru })),
  ], [index, lang])
  const choices = useMemo(() => {
    const bySlot: Record<Slot, Choice[]> = { body: [], helmet: [], face: [], eyewear: [] }
    for (const name of Object.keys(index.pictures)) {
      if (!name.startsWith('worn-') || !index.pictures[name]?.front) continue
      const [id, visorId] = name.slice(5).split('-')
      const item = armor.items.get(id!)
      if (!item) continue
      const visor = visorId ? armor.items.get(visorId) : undefined
      const slot: Slot | undefined = item.kind === 'helmet' ? 'helmet' : item.kind === 'armor' || item.kind === 'rig' ? 'body' : item.kind === 'face' ? 'face' : item.kind === 'eyewear' ? 'eyewear' : undefined
      if (!slot) continue
      const label = `${item.shortName}${visor ? (lang === 'en' ? ' (visor)' : ' (с забралом)') : ''}`
      bySlot[slot].push({ name, item, visor, label, armorClass: Math.max(item.armorClass, visor?.armorClass ?? 0) })
    }
    for (const list of Object.values(bySlot)) list.sort((a, b) => b.armorClass - a.armorClass || a.label.localeCompare(b.label))
    return bySlot
  }, [index, armor, lang])

  const [character, setCharacter] = useState(() => characters[0]?.name ?? '')
  // a PMC wears the clothes chosen here (owner, 22.11.2026: «Сними еще одежду разную, футболки штаны что бы можно было менять»)
  const side = character === 'body-pmcusec' ? 'usec' : character === 'body-pmcbear' ? 'bear' : ''
  const clothes = useMemo(() => {
    const lists: Record<Clothes, Array<{ name: string; label: string }>> = { upper: [], lower: [] }
    for (const [name, label] of Object.entries(index.labels ?? {})) {
      const kind = name.startsWith('upper-') ? 'upper' : name.startsWith('lower-') ? 'lower' : undefined
      if (kind && label.side.split(',').includes(side) && index.pictures[name]?.front) lists[kind].push({ name, label: lang === 'en' ? label.en : label.ru })
    }
    for (const list of Object.values(lists)) list.sort((a, b) => a.label.localeCompare(b.label))
    return lists
  }, [index, side, lang])
  const [dressed, setDressed] = useState<Record<string, string>>({})
  const upper = dressed[`${side}:upper`] ?? clothes.upper[0]?.name ?? ''
  const lower = dressed[`${side}:lower`] ?? clothes.lower[0]?.name ?? ''
  const head = side ? `head-pmc${side}` : ''
  const clothed = Boolean(side && index.pictures[head] && upper && lower)
  const base = clothed ? [lower, upper, head] : [character]
  const [worn, setWorn] = useState<Record<Slot, string>>(() => ({
    body: choices.body.find((choice) => choice.name === 'worn-5c0e541586f7747fa54205c9')?.name ?? choices.body[0]?.name ?? '',
    helmet: choices.helmet.find((choice) => choice.name.startsWith('worn-5aa7e276e5b5b000171d0647-'))?.name ?? choices.helmet[0]?.name ?? '',
    face: '',
    eyewear: '',
  }))
  const put = (slot: Slot, name: string) => setWorn((current) => ({ ...current, [slot]: current[slot] === name ? '' : name }))

  const layers = [...base, ...ORDER.map((slot) => worn[slot])].filter(Boolean)
  const files = layers.flatMap((name) => (['front', 'back'] as const).map((view) => index.pictures[name]?.[view]?.file).filter((file): file is string => Boolean(file)))
  const urls = useFigureUrls(files)
  const wornChoices = ORDER.map((slot) => choices[slot].find((choice) => choice.name === worn[slot])).filter((choice): choice is Choice => Boolean(choice))

  if (!characters.length) return <section className="panel range-card"><p className="range-empty">{t('В этой сборке нет снимков для конструктора.', 'This build has no pictures for the outfit builder.')}</p></section>

  const slots: Array<[Slot, string]> = [['body', t('Бронежилет или разгрузка', 'Body armour or rig')], ['helmet', t('Каска', 'Helmet')], ['face', t('Маска', 'Mask')], ['eyewear', t('Очки', 'Glasses')]]
  return <div className="range-outfit">
    <aside className="range-side">
      <section className="panel range-card">
        <h2 className="range-card-title">{t('Персонаж', 'Character')}</h2>
        <select className="select" value={character} onChange={(event) => setCharacter(event.target.value)}>
          {characters.map((entry) => <option key={entry.name} value={entry.name}>{entry.label}</option>)}
        </select>
      </section>
      {clothed && (['upper', 'lower'] as const).map((kind) => <ClothesList key={kind} title={kind === 'upper' ? t('Верх', 'Top') : t('Низ', 'Bottom')} choices={clothes[kind]} value={kind === 'upper' ? upper : lower} onChange={(name) => setDressed((current) => ({ ...current, [`${side}:${kind}`]: name }))} lang={lang} />)}
      {slots.map(([slot, title]) => <OutfitList key={slot} title={title} choices={choices[slot]} value={worn[slot]} onChange={(name) => put(slot, name)} lang={lang} />)}
    </aside>
    <section className="panel range-outfit-stage">
      <div className="range-outfit-views">
        {(['front', 'back'] as const).map((view) => <figure key={view} className="range-outfit-view">
          {layers.map((name) => index.pictures[name]?.[view]).filter((picture): picture is FigurePicture => Boolean(picture)).map((picture) => urls[picture.file]
            ? <img key={picture.file} src={urls[picture.file]} alt="" draggable={false} style={{
              left: `${(picture.x - STAGE.left) / STAGE.width * 100}%`,
              top: `${(STAGE.top - picture.top) / STAGE.height * 100}%`,
              width: `${picture.width / STAGE.width * 100}%`,
              height: `${picture.height / STAGE.height * 100}%`,
            }} />
            : null)}
          <figcaption>{view === 'front' ? t('Спереди', 'Front') : t('Сзади', 'Back')}</figcaption>
        </figure>)}
      </div>
      <div className="range-outfit-facts">
        {wornChoices.map((choice) => <ItemFacts key={choice.name} choice={choice} lang={lang} onOff={() => setWorn((current) => ({ ...current, ...Object.fromEntries(ORDER.filter((slot) => current[slot] === choice.name).map((slot) => [slot, ''])) }))} />)}
      </div>
    </section>
  </div>
}

function ClothesList({ title, choices, value, onChange, lang }: { title: string; choices: Array<{ name: string; label: string }>; value: string; onChange: (name: string) => void; lang: Locale }) {
  const [query, setQuery] = useState('')
  const shown = query.trim() ? choices.filter((choice) => choice.label.toLowerCase().includes(query.trim().toLowerCase())) : choices
  return <section className="panel range-card">
    <h2 className="range-card-title">{title} <small>{choices.length}</small></h2>
    {choices.length > 8 && <label className="range-outfit-search"><Search size={13} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={lang === 'en' ? 'Search' : 'Поиск'} /></label>}
    <div className="range-outfit-list">
      {shown.map((choice) => <button key={choice.name} type="button" className={`range-outfit-choice${value === choice.name ? ' is-on' : ''}`} onClick={() => onChange(choice.name)}>
        <span>{choice.label}</span>
      </button>)}
    </div>
  </section>
}

function OutfitList({ title, choices, value, onChange, lang }: { title: string; choices: Choice[]; value: string; onChange: (name: string) => void; lang: Locale }) {
  const [query, setQuery] = useState('')
  const shown = query.trim() ? choices.filter((choice) => `${choice.label} ${choice.item.name}`.toLowerCase().includes(query.trim().toLowerCase())) : choices
  if (!choices.length) return null
  return <section className="panel range-card">
    <h2 className="range-card-title">{title} <small>{choices.length}</small></h2>
    {choices.length > 8 && <label className="range-outfit-search"><Search size={13} /><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={lang === 'en' ? 'Search' : 'Поиск'} /></label>}
    <div className="range-outfit-list">
      <button type="button" className={`range-outfit-choice${value === '' ? ' is-on' : ''}`} onClick={() => onChange(value)}>{lang === 'en' ? 'None' : 'Нет'}</button>
      {shown.map((choice) => <button key={choice.name} type="button" className={`range-outfit-choice${value === choice.name ? ' is-on' : ''}`} onClick={() => onChange(choice.name)}>
        <span className="range-class" style={{ background: CLASS_COLORS[choice.armorClass] }}>{choice.armorClass}</span>
        <span>{choice.label}</span>
      </button>)}
    </div>
  </section>
}

function ItemFacts({ choice, lang, onOff }: { choice: Choice; lang: Locale; onOff: () => void }) {
  const pieces = [...choice.item.pieces, ...(choice.visor?.pieces ?? [])]
  const durability = pieces.reduce((sum, piece) => sum + piece.maxDurability, 0)
  return <div className="range-outfit-fact">
    <img src={choice.item.icon} alt="" loading="lazy" />
    <div>
      <b>{choice.item.name}{choice.visor ? (lang === 'en' ? ', visor' : ', с забралом') : ''}</b>
      <small>{lang === 'en' ? 'class' : 'класс'} {choice.armorClass} · {lang === 'en' ? 'durability' : 'прочность'} {Math.round(durability)}{choice.item.plateSlots.length ? ` · ${lang === 'en' ? 'plates' : 'плиты'}: ${choice.item.plateSlots.length}` : ''}</small>
    </div>
    <button type="button" className="button" onClick={onOff}>{lang === 'en' ? 'Take off' : 'Снять'}</button>
  </div>
}
