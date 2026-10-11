import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Package } from 'lucide-react'
import type { PurchaseAccess } from '../arsenal/buildStats'
import type { GunPart } from '../arsenal/gunTypes'
import type { Item, Trader, WeaponBuildRequirement } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { displayPrice } from '../domain/itemPrices'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { useAppState } from '../state/AppState'
import { formatPrice } from '../shared/format'
import { useHoverCard } from '../components/useHoverCard'
import type { GunsmithPlan, SlotAlternatives } from './gunsmithSolver'
import { partSellers, type PartSeller } from './partSellers'
import { TraderBadge } from './ShoppingTable'
import { traderKey } from './traderLevels'

/** Where the mod data is: the alternatives need it (src/arsenal/gunCatalog.ts). */
export type ModsStatus = 'loading' | 'ready' | 'unavailable'

type Role = 'required' | 'any-of' | 'build'
interface Card { id?: string; name: string; role: Role }

/**
 * «Обязательные модули» of a Gunsmith task (owner, 11.10.2026): one block — the parts the game checks and the rest of the
 * wiki's build — each with its picture, flea price and who sells it from which loyalty level. Hovering a part opens a
 * window with the parts that go into the same place and keep the task's requirements (src/gunsmith/gunsmithSolver.ts).
 */
export function BuildPartCards({ build, compact, mods, access, plan, modsStatus }: {
  build: WeaponBuildRequirement
  compact?: boolean
  mods?: Map<string, GunPart>
  access?: PurchaseAccess
  /** The example build (undefined while it is being made, null when the weapon is not in the mod data). */
  plan?: GunsmithPlan | null
  modsStatus?: ModsStatus
}) {
  const { data } = useTarkovData()
  const items = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const traders = useMemo(() => new Map((data.traders ?? []).map((trader) => [traderKey(trader), trader])), [data.traders])
  const sellers = useMemo(() => partSellers(build, mods), [build, mods])
  const cards = useMemo(() => {
    const listed = new Set<string>()
    const out: Card[] = []
    const add = (card: Card) => {
      if (card.id && listed.has(card.id)) return
      if (card.id) listed.add(card.id)
      out.push(card)
    }
    for (const id of build.partIds) add({ id, name: items.get(id)?.name ?? id, role: 'required' })
    for (const id of build.anyOfIds ?? []) add({ id, name: items.get(id)?.name ?? id, role: 'any-of' })
    for (const part of build.wikiParts ?? []) add({ id: part.itemId, name: (part.itemId ? items.get(part.itemId)?.name : undefined) ?? part.name, role: 'build' })
    return out
  }, [build, items])
  if (!cards.length) return null

  return <div className="gs-block">
    <h5>{uiText('Обязательные модули')}</h5>
    <div className="gs-parts">
      {cards.map((card) => <PartCard key={card.id ?? card.name} card={card} item={card.id ? items.get(card.id) : undefined} compact={compact}
        sellers={card.id ? sellers.get(card.id) : undefined} traders={traders} access={access}
        fitting={card.id ? plan?.fitting.find((slot) => slot.part.id === card.id) : undefined} plan={plan} modsStatus={modsStatus} />)}
    </div>
  </div>
}

function PartCard({ card, item, compact, sellers, traders, access, fitting, plan, modsStatus }: {
  card: Card
  item?: Item
  compact?: boolean
  sellers?: PartSeller[]
  traders: Map<string, Trader>
  access?: PurchaseAccess
  fitting?: SlotAlternatives
  plan?: GunsmithPlan | null
  modsStatus?: ModsStatus
}) {
  const { locale } = useLocale()
  const mode = useAppState().raidMode
  const { data } = useTarkovData()
  const price = item ? displayPrice(item, mode) : undefined
  const hover = useHoverCard(<>
    <Sellers sellers={sellers} traders={traders} access={access} locale={locale} />
    <Alternatives card={card} fitting={fitting} plan={plan} modsStatus={modsStatus} locale={locale} items={data.items} />
  </>)
  // The card: picture, name, flea price. Who sells it and what can go instead are in the hover window.
  const body = <>
    {item?.iconUrl ? <img src={item.iconUrl} alt="" loading="lazy" /> : <span className="gs-part-empty"><Package size={18} /></span>}
    <span>
      <strong>{uiText(item?.shortName ?? item?.name ?? card.name)}</strong>
      {!compact && <small>{uiText(item?.name ?? card.name)}</small>}
      {price?.kind === 'flea' && <small className="gs-part-price">{formatPrice(price.price)}</small>}
    </span>
  </>
  return <>
    {card.id
      ? <Link className="gs-part" to={`/flea?selected=${card.id}`} {...hover.anchorProps}>{body}</Link>
      : <span className="gs-part" tabIndex={0} {...hover.anchorProps}>{body}</span>}
    {hover.card}
  </>
}

/** «Продают»: each trader with the loyalty level the part needs (I, II, III, a crown for 4), barters marked. */
function Sellers({ sellers, traders, access, locale }: { sellers?: PartSeller[]; traders: Map<string, Trader>; access?: PurchaseAccess; locale: AppLocale }) {
  if (!sellers?.length) return null
  return <div className="gs-sellers">
    <p className="hover-card-title">{locale === 'en' ? 'Sold by' : 'Продают'}</p>
    <ul>
      {sellers.slice(0, 4).map((seller) => {
        const trader = traders.get(seller.trader)
        const name = trader?.name ?? seller.trader
        const have = access?.traderLevels?.[seller.trader]
        const locked = have !== undefined && have < seller.level
        const level = locale === 'en' ? `loyalty ${seller.level}` : `уровень ${seller.level}`
        const extra = [seller.barter ? (locale === 'en' ? 'barter' : 'бартер') : '', locked ? (locale === 'en' ? `you have ${have}` : `у вас ${have}`) : ''].filter(Boolean).join(', ')
        return <li key={`${seller.trader}-${seller.level}-${seller.barter ? 'b' : 'c'}`}>
          <TraderBadge trader={trader} name={name} level={seller.level} barter={seller.barter} locked={locked} small />
          <span><strong>{uiText(name)}</strong> — {level}{extra ? <span className={locked ? 'gs-sellers-locked' : 'dim'}> ({extra})</span> : null}</span>
        </li>
      })}
    </ul>
  </div>
}

const MESSAGES: Record<string, { ru: string; en: string }> = {
  required: { ru: 'Задание требует именно этот модуль — замены нет.', en: 'The task asks for exactly this part — no replacement.' },
  'any-of': { ru: 'Подойдёт любой модуль из списка задания.', en: 'Any part of the task’s list will do.' },
  uncomputed: { ru: 'Модуль влияет на то, что игра проверяет сама (дальность, точность, размер): замену проверьте при осмотре оружия.', en: 'This part changes what the game checks itself (distance, accuracy, size): check a replacement when inspecting the weapon.' },
  none: { ru: 'Других модулей, которые сюда встают и сохраняют требования, нет.', en: 'No other part fits here and keeps the requirements.' },
  unplaced: { ru: 'Для этого модуля замены не подобраны.', en: 'No replacements found for this part.' },
  loading: { ru: 'Подбираю аналоги…', en: 'Finding alternatives…' },
  unavailable: { ru: 'Аналоги появятся, когда загрузятся данные модулей.', en: 'Alternatives appear once the mod data is loaded.' },
}

/** The hover window: the parts that can go instead of this one, cheapest first, with the price difference. */
function Alternatives({ card, fitting, plan, modsStatus, locale, items }: { card: Card; fitting?: SlotAlternatives; plan?: GunsmithPlan | null; modsStatus?: ModsStatus; locale: AppLocale; items: Item[] }) {
  const say = (key: string) => MESSAGES[key][locale === 'en' ? 'en' : 'ru']
  const title = locale === 'en' ? 'Can go instead' : 'Можно поставить вместо'
  const message = card.role !== 'build' ? say(card.role)
    : modsStatus === 'unavailable' || plan === null ? say('unavailable')
      : !plan ? say('loading')
        : !fitting ? say('unplaced')
          : fitting.uncomputed ? say('uncomputed')
            : !fitting.options.length ? say('none') : ''
  const icon = (id: string, fallback?: string) => items.find((entry) => entry.id === id)?.iconUrl ?? fallback
  const nameOf = (id: string, fallback: string) => items.find((entry) => entry.id === id)?.name ?? fallback
  return <div className="gs-alternatives">
    <p className="hover-card-title">{title}</p>
    {message
      ? <p className="dim">{message}</p>
      : <ul className="hover-card-items">
        {fitting!.options.map((option) => {
          const difference = Math.round(-option.saving)
          const delta = difference === 0 ? (locale === 'en' ? 'same price' : 'та же цена')
            : difference < 0 ? (locale === 'en' ? `${formatPrice(-difference)} cheaper` : `дешевле на ${formatPrice(-difference)}`)
              : (locale === 'en' ? `${formatPrice(difference)} more` : `дороже на ${formatPrice(difference)}`)
          return <li key={option.part.id}>
            {icon(option.part.id, option.part.iconLink) ? <img src={icon(option.part.id, option.part.iconLink)} alt="" /> : <span />}
            <span>
              <strong>{uiText(nameOf(option.part.id, option.part.name))}</strong>
              <small className="dim">{option.offer ? `${formatPrice(option.offer.priceRUB)} · ` : ''}{delta}</small>
            </span>
          </li>
        })}
      </ul>}
  </div>
}
