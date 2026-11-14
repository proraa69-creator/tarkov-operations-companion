import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, Hourglass, Infinity as Forever, Package, TrendingUp, X } from 'lucide-react'
import { uiText } from '../i18n/renderText'
import { useLocale, type AppLocale } from '../i18n/LocaleProvider'
import { useAppState } from '../state/AppState'
import { useTarkovData } from '../data/DataProvider'
import { unlockSources, useItemUnlocks, type UnlockSource } from '../progression/itemUnlocks'
import { useQuestDeferral } from '../progression/questDeferral'
import type { DeferTerm } from '../progression/deferredQuests'
import { useTraderLoyalty } from '../gunsmith/useGunsmithAccess'
import { MAX_PLAYER_LEVEL } from '../import/modeSelectScreen'
import { usePopupMenu } from './usePopupMenu'
import './deferredQuests.css'
import { TakenMenuItem } from '../overview/TakenItems'

/**
 * What a right click on the Overview was on: the item (its picture and name, where it opens for «До уровня») and the quests
 * that need it on this map, with how many each takes.
 */
export interface DeferRequest {
  item?: { id: string; name: string; iconUrl?: string }
  quests: Array<{ id: string; name: string; count?: number }>
  /** Ticked when the window opens (the quest whose line was clicked); every quest when none. */
  chosen?: string[]
}

/** `title`: what the menu names (a task's row: the quest); the item's name, else the quest's, without it. */
export interface DeferMenuState { x: number; y: number; request: DeferRequest; title?: string }

/** «До уровня»: the character's level, or a trader's loyalty. */
type LevelTerm = Exclude<DeferTerm, { days: number }>

const DAYS = [1, 2, 3, 4, 5, 6, 7, 14, 30]
const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The right click on an item of «Требования рейда» or on the gear of «Сбор на рейд» (owner, 03.11.2026: «мог просто
 * нажать на любой предмет ПКМ и отложить квест»): its name and «Отложить квест». `onClose` must keep its identity.
 */
export function DeferItemMenu({ menu, onOpen, onClose }: { menu: DeferMenuState | null; onOpen: (request: DeferRequest) => void; onClose: () => void }) {
  const ref = usePopupMenu(menu, onClose)
  if (!menu) return null
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 268))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - 86))
  const { request } = menu
  return createPortal(
    <div ref={ref} className="point-menu quest-defer-menu" role="menu" aria-label={uiText('Меню предмета')} style={{ left, top }} onContextMenu={(event) => event.preventDefault()}>
      <div className="point-menu-title">{uiText(menu.title ?? request.item?.name ?? request.quests[0]?.name ?? '')}</div>
      {/* «Взял» (report 157): a green check on the item until the raid is over */}
      <TakenMenuItem itemId={request.item?.id} onDone={onClose} />
      {request.quests.length > 0 && <button type="button" role="menuitem" onClick={() => { onClose(); onOpen(request) }}><Hourglass size={13} aria-hidden="true" />{uiText('Отложить квест')}</button>}
    </div>,
    document.body,
  )
}

const dayWord = (count: number, en: boolean) => {
  if (en) return count === 1 ? 'day' : 'days'
  const tens = count % 100
  const ones = count % 10
  return ones === 1 && tens !== 11 ? 'день' : ones >= 2 && ones <= 4 && (tens < 12 || tens > 14) ? 'дня' : 'дней'
}

const when = (time: number, locale: AppLocale) => new Date(time).toLocaleString(locale, { day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })

/** «Барахолка» / «Механик · лояльность 2». */
function sourceTitle(source: UnlockSource, en: boolean) {
  if (source.kind === 'flea') return uiText('Барахолка')
  return `${uiText(source.trader?.name ?? '')} · ${en ? 'loyalty' : 'лояльность'} ${source.loyalty ?? 1}`
}

/**
 * «с 15 уровня» (or «15 уровень · уже есть»), for a trader whose loyalty the app knows «сейчас лояльность 1» (or «уже
 * есть»), then «бартер», «после квеста «…»».
 */
function sourceDetail(source: UnlockSource, reached: boolean, loyaltyNow: number | undefined, current: number, questName: string | undefined, en: boolean) {
  const parts: string[] = []
  const levelReached = source.level !== undefined && source.level <= Math.max(1, current)
  if (loyaltyNow !== undefined) {
    if (reached) parts.push(en ? 'reached' : 'уже есть')
    else {
      parts.push(en ? `loyalty ${loyaltyNow} now` : `сейчас лояльность ${loyaltyNow}`)
      if (source.level !== undefined && !levelReached) parts.push(en ? `from level ${source.level}` : `с ${source.level} уровня`)
    }
  } else if (source.level !== undefined) parts.push(reached ? (en ? `level ${source.level} · reached` : `${source.level} уровень · уже есть`) : (en ? `from level ${source.level}` : `с ${source.level} уровня`))
  if (source.barter) parts.push(en ? 'barter' : 'бартер')
  if (questName) parts.push(en ? `after «${uiText(questName)}»` : `после квеста «${questName}»`)
  return parts.join(' · ')
}

/**
 * «Отложить квест» (owner, 03.11.2026: «при нажатии появляется окно с выбором отладки по времени или по достижению уровня,
 * если нажимаешь по достижению уровня, у него пишется с какого уровня откроется предмет на барахолке или у торговцев (на
 * каком уровне лояльности или уровне персонажа) если нажимаешь отладка по времени, то можно выбрать 1-2-3-4-5-6-7 дней»).
 * Several quests need the item: each with a tick. «До уровня» lists where the item opens (progression/itemUnlocks.ts) and
 * the level each needs; a level this mode's character already has is no term. A trader's offer goes by his loyalty as
 * «Торговцы» shows it: there already, no term; not yet, the quest waits for that loyalty. The quests go to «Отложенные квесты» of
 * this profile and mode and come back by themselves (progression/deferredQuests.ts). A quest's row in «Текущие задания»
 * opens it too, for that one quest (a quest with no item to tell of: «Свой уровень» only). «Бессрочно» (owner, 05.11.2026: «отложить
 * квест по дням… до какого-то уровня… отложить бессрочно»): it waits for «Вернуть»; every right click on a quest opens this window.
 * `onDeferred`: the quests just put aside.
 */
export function QuestDeferDialog({ request, onClose, onDeferred }: { request: DeferRequest; onClose: () => void; onDeferred?: (questIds: string[]) => void }) {
  const state = useAppState()
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const en = locale === 'en'
  const mode = state.raidMode
  const progress = state.activeProfile.modes[mode]
  // The level the app knows for this mode: the game's screen or Tarkov.dev (raised by the quests turned in since).
  const current = progress.playerLevel
  const known = Boolean(progress.levelAnchor) || current > 1
  const titleId = useId()
  const radioName = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const closeLatest = useRef(onClose)
  useEffect(() => { closeLatest.current = onClose })
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeLatest.current() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); opener?.focus() }
  }, [])

  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(request.chosen?.length ? request.chosen : request.quests.map((quest) => quest.id)))
  const [kind, setKind] = useState<'time' | 'level' | 'forever'>('time')
  const [days, setDays] = useState(1)
  // «Вернётся сам …» counts from the window's opening: the stored term from the press, a few seconds later.
  const [openedAt] = useState(() => Date.now())
  // Read only when «До уровня» is chosen: tarkov.dev's items file of the mode is big.
  const unlocks = useItemUnlocks(mode, kind === 'level' && Boolean(request.item))
  const sources = useMemo(() => (unlocks.data && request.item ? unlockSources(request.item.id, unlocks.data, data.traders) : []), [data.traders, request.item, unlocks.data])
  // A trader's loyalty is the one «Торговцы» shows for this mode (the game's traders' screen, the tasks, the player's own
  // choice), not just the character's level (owner, 03.11.2026: «уровень лояльности расходится в блоках»): a level the
  // character has does not make a loyalty. A trader with no known levels: the character's level decides, as before.
  const loyalty = useTraderLoyalty()
  const loyaltyNow = (source: UnlockSource) => (source.kind === 'trader' && source.trader ? loyalty.get(source.trader.id) : undefined)
  const reached = (source: UnlockSource) => {
    const now = loyaltyNow(source)
    return now !== undefined ? now >= (source.loyalty ?? 1) : source.level !== undefined && source.level <= Math.max(1, current)
  }
  /** What choosing it means: until the trader's loyalty when the app knows it, else until the character's level. */
  const termOf = (source: UnlockSource): LevelTerm | undefined => {
    if (reached(source)) return undefined
    if (source.trader && loyaltyNow(source) !== undefined) return { loyalty: { traderId: source.trader.id, trader: source.trader.name, level: source.loyalty ?? 1 } }
    return source.level !== undefined ? { level: source.level } : undefined
  }
  const firstOpen = sources.find((source) => termOf(source) !== undefined)
  const [choice, setChoice] = useState<string | undefined>()
  const [own, setOwn] = useState(() => String(Math.min(MAX_PLAYER_LEVEL, Math.max(2, current + 1))))
  const selected = choice ?? firstOpen?.key ?? 'own'
  const chosenSource = sources.find((source) => source.key === selected)
  const term: LevelTerm | undefined = selected === 'own' ? { level: Number(own) } : chosenSource && termOf(chosenSource)
  const termValid = term !== undefined && ('loyalty' in term || (Number.isInteger(term.level) && term.level >= 2 && term.level <= MAX_PLAYER_LEVEL && term.level > current))
  const questName = (id: string | undefined) => (id ? data.quests.find((quest) => quest.id === id)?.name : undefined)

  const ids = request.quests.map((quest) => quest.id).filter((id) => picked.has(id))
  const ready = ids.length > 0 && (kind !== 'level' || termValid)
  const toggle = (id: string) => setPicked((now) => {
    const next = new Set(now)
    if (!next.delete(id)) next.add(id)
    return next
  })
  // With their keys and items into «Избранное», unless that is switched off (progression/questDeferral.ts).
  const deferNow = useQuestDeferral()
  const submit = () => {
    if (!ready) return
    deferNow(ids, kind === 'forever' ? undefined : kind === 'time' ? { days } : term!)
    onDeferred?.(ids)
    onClose()
  }
  const [single] = request.quests

  return createPortal(
    <div className="registration-overlay deferred-quests-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog quest-defer-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <button ref={closeRef} type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2 id={titleId}>{uiText('Отложить квест')} <span className="tag">{uiText(mode.toUpperCase())}</span></h2>
        {request.item && <div className="quest-defer-item">
          <span className="deferred-item-picture">{request.item.iconUrl ? <img src={request.item.iconUrl} alt="" /> : <Package size={20} aria-hidden="true" />}</span>
          <strong>{uiText(request.item.name)}</strong>
        </div>}
        {request.quests.length > 1
          ? <fieldset className="quest-defer-quests">
            <legend>{uiText('Этот предмет нужен квестам — какие отложить:')}</legend>
            {request.quests.map((quest) => <label key={quest.id} className={`quest-defer-quest${picked.has(quest.id) ? ' is-chosen' : ''}`}>
              <input type="checkbox" checked={picked.has(quest.id)} onChange={() => toggle(quest.id)} />
              <span>{uiText(quest.name)}</span>
              {quest.count ? <b>×{quest.count}</b> : null}
            </label>)}
          </fieldset>
          : single && <p className="quest-defer-lead">{uiText('Квест')}: <strong>{uiText(single.name)}</strong></p>}

        <div className="quest-defer-kinds" role="radiogroup" aria-label={uiText('На сколько отложить')}>
          <button type="button" role="radio" aria-checked={kind === 'time'} className={kind === 'time' ? 'is-on' : ''} onClick={() => setKind('time')}><CalendarClock size={15} aria-hidden="true" />{uiText('По времени')}</button>
          <button type="button" role="radio" aria-checked={kind === 'level'} className={kind === 'level' ? 'is-on' : ''} onClick={() => setKind('level')}><TrendingUp size={15} aria-hidden="true" />{uiText('До уровня')}</button>
          <button type="button" role="radio" aria-checked={kind === 'forever'} className={kind === 'forever' ? 'is-on' : ''} onClick={() => setKind('forever')}><Forever size={15} aria-hidden="true" />{uiText('Бессрочно')}</button>
        </div>

        {kind === 'forever' && <div className="quest-defer-body"><p className="quest-defer-note">{uiText('Вернётся только по кнопке «Вернуть».')}</p></div>}
        {kind === 'forever' ? null : kind === 'time'
          ? <div className="quest-defer-body">
            <div className="quest-defer-days" role="radiogroup" aria-label={uiText('Сколько дней')}>
              {DAYS.map((count) => <button key={count} type="button" role="radio" aria-checked={days === count} aria-label={`${count} ${dayWord(count, en)}`} className={days === count ? 'is-on' : ''} onClick={() => setDays(count)}>{count}</button>)}
              <span className="quest-defer-unit">{dayWord(days, en)}</span>
            </div>
            <p className="quest-defer-note">{en ? `Comes back by itself on ${when(openedAt + days * DAY_MS, locale)}.` : `Вернётся сам ${when(openedAt + days * DAY_MS, locale)}.`}</p>
          </div>
          : <div className="quest-defer-body">
            <p className="quest-defer-note">{known
              ? (en ? `Your character in this mode is level ${current} now.` : `Сейчас у персонажа в этом режиме ${current} уровень.`)
              : uiText('Уровень персонажа в этом режиме приложению пока неизвестен: он берётся с экрана игры и из профиля игрока.')}</p>
            {!request.item ? null
              : unlocks.isPending ? <p className="quest-defer-note is-loading">{uiText('Загружаем, где продаётся предмет…')}</p>
                : unlocks.isError ? <p className="quest-defer-note">{uiText('Не удалось загрузить, где продаётся предмет. Уровень можно указать самому.')}</p>
                  : !sources.length && <p className="quest-defer-note">{uiText('Этот предмет не продаётся на барахолке и у торговцев.')}</p>}
            <div className="quest-defer-levels" role="radiogroup" aria-label={uiText('До какого уровня')}>
              {sources.map((source) => {
                const off = termOf(source) === undefined
                return <label key={source.key} className={`quest-defer-source${selected === source.key ? ' is-chosen' : ''}${off ? ' is-off' : ''}`}>
                  <input type="radio" name={radioName} checked={selected === source.key} disabled={off} onChange={() => setChoice(source.key)} />
                  <span className="quest-defer-source-copy"><strong>{sourceTitle(source, en)}</strong><small>{sourceDetail(source, reached(source), loyaltyNow(source), current, questName(source.questId), en)}</small></span>
                </label>
              })}
              <label className={`quest-defer-source is-own${selected === 'own' ? ' is-chosen' : ''}`}>
                <input type="radio" name={radioName} checked={selected === 'own'} onChange={() => setChoice('own')} />
                <span className="quest-defer-source-copy"><strong>{uiText('Свой уровень')}</strong></span>
                <input type="number" className="quest-defer-own" min={2} max={MAX_PLAYER_LEVEL} value={own} aria-label={uiText('Уровень персонажа')}
                  onFocus={() => setChoice('own')} onChange={(event) => { setChoice('own'); setOwn(event.target.value) }} />
              </label>
            </div>
            <p className="quest-defer-note">{!termValid
              ? (en ? `Choose a level above ${Math.max(1, current)}, up to ${MAX_PLAYER_LEVEL}.` : `Выберите уровень выше ${Math.max(1, current)}, до ${MAX_PLAYER_LEVEL}.`)
              : 'loyalty' in term
                ? (en ? `Comes back by itself once ${uiText(term.loyalty.trader)}’s loyalty reaches ${term.loyalty.level}.` : `Вернётся сам, когда у торговца ${term.loyalty.trader} будет лояльность ${term.loyalty.level}.`)
                : (en ? `Comes back by itself once your character reaches level ${term.level}.` : `Вернётся сам, когда персонаж достигнет ${term.level} уровня.`)}</p>
          </div>}

        <div className="deferred-quests-actions">
          <button type="button" className="button ghost" onClick={onClose}>{uiText('Отмена')}</button>
          <button type="button" className="button primary" disabled={!ready} onClick={submit}><Hourglass size={15} aria-hidden="true" />{uiText('Отложить')}{ids.length > 1 ? ` (${ids.length})` : ''}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
