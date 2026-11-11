import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from 'lucide-react'
import type { Quest, Trader } from '../../domain/types'
import type { TaskAvailability } from '../../progression/requirementEngine'
import { provenCompleted } from '../../progression/requirementEngine'
import { uiText } from '../../i18n/renderText'
import { useMobileLayout } from '../../platform'
import { useFitBelow } from '../../app/useFitBelow'
import { layoutQuestTree, type TreeBox } from './questTreeLayout'
import { buildQuestTree, questChain, searchQuestTree, type QuestLinkKind, type QuestTreeLane, type QuestTreeModel } from './questTreeModel'
import { QuestTreeOutline } from './QuestTreeOutline'
import { StatusMark } from './StatusMark'
import { LaneUnlockBar } from './laneUnlock'
import { questTreeStatus, stepLabel } from './questTreeText'
import './questTree.css'

/** The lane chip that shows every trader at once. */
const ALL_LANES = 'all'
const MIN_ZOOM = 0.3
const MAX_ZOOM = 1.6

export type QuestTreeAvailability = ReadonlyMap<string, TaskAvailability>

/** The two buttons of «Хронология»: the catalog there was, and the tree (`?view=tree`). */
export function QuestViewSwitch() {
  const [params, setParams] = useSearchParams()
  const tree = params.get('view') === 'tree'
  const choose = (on: boolean) => setParams((current) => {
    const next = new URLSearchParams(current)
    if (on) next.set('view', 'tree')
    else { next.delete('view'); next.delete('lane') }
    return next
  })
  return <div className="segmented-filter quest-view-switch" data-testid="quest-view-switch">
    <button type="button" className={tree ? '' : 'active'} aria-pressed={!tree} onClick={() => choose(false)}>{uiText('Каталог заданий')}</button>
    <button type="button" className={tree ? 'active' : ''} aria-pressed={tree} onClick={() => choose(true)}>{uiText('Дерево квестов')}</button>
  </div>
}

interface QuestTreeViewProps {
  quests: Quest[]
  traders: Trader[]
  availability: QuestTreeAvailability
  /** The page's search field. */
  query: string
}

/** «Дерево квестов»: on the PC a canvas to move around and zoom, on the phone an outline of the same tree. */
export function QuestTreeView({ quests, traders, availability, query }: QuestTreeViewProps) {
  const mobile = useMobileLayout()
  const model = useMemo(() => buildQuestTree(quests), [quests])
  const [params, setParams] = useSearchParams()
  const selectedId = params.get('selected') ?? undefined
  const asked = params.get('lane')
  const selectedLane = selectedId ? model.laneOf.get(selectedId) : undefined
  const lane = asked === ALL_LANES || model.lanes.some((entry) => entry.key === asked) ? asked! : selectedLane ?? model.lanes[0]?.key ?? ALL_LANES

  const select = useCallback((update: { lane?: string; selected?: string }) => setParams((current) => {
    const next = new URLSearchParams(current)
    if (update.lane) next.set('lane', update.lane)
    if (update.selected) next.set('selected', update.selected)
    return next
    // A card takes a step in the history like in the lists: the back button closes it. A lane alone does not.
  }, { replace: !update.selected }), [setParams])

  const shownName = useCallback((quest: Quest) => uiText(quest.name), [])
  const matches = useMemo(() => searchQuestTree(model, query, shownName), [model, query, shownName])
  // Which match is shown, for this query; a new query starts from the first.
  const [matchPlace, setMatchPlace] = useState({ query: '', index: 0 })
  const matchIndex = matchPlace.query === query ? matchPlace.index : 0
  // What the canvas should bring into view; the token repeats a jump to the same quest.
  const [focus, setFocus] = useState<{ questId: string; token: number } | undefined>(() => selectedId ? { questId: selectedId, token: 0 } : undefined)
  const focusOn = useCallback((questId: string) => setFocus((current) => ({ questId, token: (current?.token ?? 0) + 1 })), [])

  // The tree is searched whole: a match in another trader's lane moves there.
  const goToMatch = useCallback((index: number) => {
    const questId = matches[index]
    if (!questId) return
    setMatchPlace({ query, index })
    const owner = model.laneOf.get(questId)
    if (lane !== ALL_LANES && owner && owner !== lane) select({ lane: owner })
    focusOn(questId)
  }, [focusOn, lane, matches, model, query, select])
  const firstMatch = matches[0]
  const goToMatchLatest = useRef(goToMatch)
  useEffect(() => { goToMatchLatest.current = goToMatch })
  useEffect(() => {
    if (firstMatch && !mobile) goToMatchLatest.current(0)
  }, [firstMatch, mobile, query])

  const open = useCallback((questId: string) => {
    select({ selected: questId })
    focusOn(questId)
  }, [focusOn, select])
  /** A chip: the other trader's quest, in its own lane. */
  const jump = useCallback((questId: string) => {
    const owner = model.laneOf.get(questId)
    select({ selected: questId, ...(lane !== ALL_LANES && owner ? { lane: owner } : {}) })
    focusOn(questId)
  }, [focusOn, lane, model, select])

  const root = useRef<HTMLDivElement>(null)
  useFitBelow(root, !mobile)

  return <div ref={root} className="quest-tree" data-testid="quest-tree">
    <div className="quest-tree-toolbar">
      <LaneChips model={model} traders={traders} availability={availability} lane={lane} onLane={(key) => select({ lane: key })} />
      {query.trim() && <div className="quest-tree-found" data-testid="quest-tree-found">
        {matches.length
          ? <>
            <span>{uiText(`${Math.min(matchIndex, matches.length - 1) + 1} из ${matches.length}`)}</span>
            {!mobile && <>
              <button type="button" className="icon-button" aria-label={uiText('Предыдущий')} title={uiText('Предыдущий')} onClick={() => goToMatch((matchIndex - 1 + matches.length) % matches.length)}><ChevronLeft size={15} /></button>
              <button type="button" className="icon-button" aria-label={uiText('Следующий')} title={uiText('Следующий')} onClick={() => goToMatch((matchIndex + 1) % matches.length)}><ChevronRight size={15} /></button>
            </>}
          </>
          : <span className="dim">{uiText('Ничего не найдено')}</span>}
      </div>}
    </div>
    {/* How this trader opens (report 133: «как открыть смотрителя»); the whole way lit across all traders. */}
    {lane !== ALL_LANES && <LaneUnlockBar model={model} laneKey={lane} availability={availability} onJump={jump}
      // the new lane first starts from its beginning, then the quest is brought into view
      onShowPath={(questId) => { select({ lane: ALL_LANES, selected: questId }); window.setTimeout(() => focusOn(questId), 80) }} />}
    {mobile
      ? <QuestTreeOutline model={model} availability={availability} lane={lane} matches={query.trim() ? matches : undefined} selectedId={selectedId} onOpen={open} onJump={jump} />
      : <QuestTreeCanvas model={model} traders={traders} availability={availability} lane={lane} query={query} matches={matches} currentMatch={matches[matchIndex]} selectedId={selectedId} focus={focus} onOpen={open} onJump={jump} />}
  </div>
}

const laneProgress = (lane: QuestTreeLane, availability: QuestTreeAvailability) => lane.questIds.filter((id) => provenCompleted(availability.get(id))).length

const laneTitle = (lane: QuestTreeLane) => lane.story ? 'Главы истории' : lane.trader

function LaneChips({ model, traders, availability, lane, onLane }: { model: QuestTreeModel; traders: Trader[]; availability: QuestTreeAvailability; lane: string; onLane: (key: string) => void }) {
  const images = useMemo(() => new Map(traders.map((trader) => [trader.id, trader.imageUrl])), [traders])
  return <div className="quest-tree-lanes" data-testid="quest-tree-lanes">
    {model.lanes.map((entry) => {
      const image = entry.traderId ? images.get(entry.traderId) : undefined
      return <button key={entry.key} type="button" className={`quest-tree-lane-chip${lane === entry.key ? ' active' : ''}`} aria-pressed={lane === entry.key} onClick={() => onLane(entry.key)}>
        {image && <img src={image} alt="" loading="lazy" />}
        <span>{uiText(laneTitle(entry))}</span>
        <small>{laneProgress(entry, availability)}/{entry.questIds.length}</small>
      </button>
    })}
    <button type="button" className={`quest-tree-lane-chip${lane === ALL_LANES ? ' active' : ''}`} aria-pressed={lane === ALL_LANES} onClick={() => onLane(ALL_LANES)}><span>{uiText('Все')}</span></button>
  </div>
}

interface QuestTreeCanvasProps {
  model: QuestTreeModel
  traders: Trader[]
  availability: QuestTreeAvailability
  lane: string
  query: string
  matches: string[]
  currentMatch?: string
  selectedId?: string
  focus?: { questId: string; token: number }
  onOpen: (questId: string) => void
  onJump: (questId: string) => void
}

/**
 * A plain scrolling box with the tree scaled inside: the wheel scrolls as everywhere in the app, Ctrl + wheel and the buttons
 * zoom, dragging moves the view, and Tab walks the quests with the browser keeping the focused one in sight.
 */
function QuestTreeCanvas({ model, traders, availability, lane, query, matches, currentMatch, selectedId, focus, onOpen, onJump }: QuestTreeCanvasProps) {
  const viewport = useRef<HTMLDivElement>(null)
  const laneKeys = useMemo(() => lane === ALL_LANES ? undefined : new Set([lane]), [lane])
  const layout = useMemo(() => layoutQuestTree(model, laneKeys), [model, laneKeys])
  const [zoom, setZoom] = useState(1)
  const zoomNow = useRef(zoom)
  const scrollAfterZoom = useRef<{ left: number; top: number } | null>(null)

  const applyZoom = useCallback((wanted: number, pointX?: number, pointY?: number) => {
    const element = viewport.current
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, wanted))
    if (!element || next === zoomNow.current) return
    // The point under the cursor (or the middle of the view) stays where it is.
    const x = pointX ?? element.clientWidth / 2
    const y = pointY ?? element.clientHeight / 2
    const contentX = (element.scrollLeft + x) / zoomNow.current
    const contentY = (element.scrollTop + y) / zoomNow.current
    scrollAfterZoom.current = { left: contentX * next - x, top: contentY * next - y }
    zoomNow.current = next
    setZoom(next)
  }, [])
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element || !scrollAfterZoom.current) return
    element.scrollLeft = scrollAfterZoom.current.left
    element.scrollTop = scrollAfterZoom.current.top
    scrollAfterZoom.current = null
  }, [zoom])

  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const rect = element.getBoundingClientRect()
      applyZoom(zoomNow.current * (event.deltaY < 0 ? 1.12 : 1 / 1.12), event.clientX - rect.left, event.clientY - rect.top)
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [applyZoom])

  const fit = () => {
    const element = viewport.current
    if (!element) return
    const next = Math.min(1, Math.max(MIN_ZOOM, (element.clientWidth - 8) / layout.width))
    scrollAfterZoom.current = { left: 0, top: 0 }
    zoomNow.current = next
    setZoom(next)
    if (next === zoom) { element.scrollLeft = 0; element.scrollTop = 0; scrollAfterZoom.current = null }
  }

  // A new lane starts from its beginning.
  const shownLane = useRef(lane)
  useLayoutEffect(() => {
    if (shownLane.current === lane) return
    shownLane.current = lane
    if (viewport.current) { viewport.current.scrollLeft = 0; viewport.current.scrollTop = 0 }
  }, [lane])

  // Bring the asked quest into view once its lane is laid out.
  const focused = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    const element = viewport.current
    if (!element || !focus || focused.current === focus.token) return
    const box = layout.questBoxes.get(focus.questId)
    if (!box) return
    focused.current = focus.token
    // Already in sight (the player has just pressed it): the view stays where it is.
    const zoomed = zoomNow.current
    const inSight = box.x * zoomed >= element.scrollLeft && (box.x + box.width) * zoomed <= element.scrollLeft + element.clientWidth
      && box.y * zoomed >= element.scrollTop && (box.y + box.height) * zoomed <= element.scrollTop + element.clientHeight
    if (!inSight) element.scrollTo?.({ left: (box.x + box.width / 2) * zoomed - element.clientWidth / 2, top: (box.y + box.height / 2) * zoomed - element.clientHeight / 2 })
  }, [focus, layout])

  // Dragging: a real drag only after a few pixels, so a press on a quest stays a click.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const justDragged = useRef(false)
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = viewport.current
    if (!element || event.button !== 0 || event.pointerType === 'touch') return
    drag.current = { x: event.clientX, y: event.clientY, left: element.scrollLeft, top: element.scrollTop, moved: false }
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const element = viewport.current
    const state = drag.current
    if (!element || !state) return
    const dx = event.clientX - state.x
    const dy = event.clientY - state.y
    if (!state.moved && Math.hypot(dx, dy) < 5) return
    if (!state.moved) {
      state.moved = true
      element.setPointerCapture?.(event.pointerId)
      element.classList.add('is-dragging')
    }
    element.scrollLeft = state.left - dx
    element.scrollTop = state.top - dy
  }
  const endDrag = () => {
    if (drag.current?.moved) {
      justDragged.current = true
      setTimeout(() => { justDragged.current = false }, 0)
      viewport.current?.classList.remove('is-dragging')
    }
    drag.current = null
  }

  const chain = useMemo(() => selectedId && model.quests.has(selectedId) ? questChain(model, selectedId) : undefined, [model, selectedId])
  const found = useMemo(() => new Set(matches), [matches])
  const searching = Boolean(query.trim())
  const images = useMemo(() => new Map(traders.map((trader) => [trader.id, trader.imageUrl])), [traders])

  return <>
    <div className="quest-tree-controls">
      <Legend />
      <div className="quest-tree-zoom" role="group" aria-label={uiText('Масштаб')}>
        <button type="button" className="icon-button" aria-label={uiText('Уменьшить')} title={uiText('Уменьшить')} data-testid="quest-tree-zoom-out" onClick={() => applyZoom(zoom / 1.2)}><Minus size={14} /></button>
        <span data-testid="quest-tree-zoom-value">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button" aria-label={uiText('Увеличить')} title={uiText('Увеличить')} data-testid="quest-tree-zoom-in" onClick={() => applyZoom(zoom * 1.2)}><Plus size={14} /></button>
        <button type="button" className="icon-button" aria-label={uiText('По ширине')} title={uiText('По ширине')} data-testid="quest-tree-fit" onClick={fit}><Maximize2 size={13} /></button>
      </div>
    </div>
    <div ref={viewport} className="quest-tree-viewport" data-testid="quest-tree-canvas" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} onClickCapture={(event) => { if (justDragged.current) { event.stopPropagation(); event.preventDefault() } }}>
      <div className="quest-tree-sizer" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className={`quest-tree-plane${searching ? ' is-searching' : ''}${chain ? ' has-chain' : ''}`} style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          {layout.bands.map((band) => {
            const image = band.lane.traderId ? images.get(band.lane.traderId) : undefined
            return <section key={band.lane.key} className="quest-tree-band" style={{ top: band.top, height: band.height }} aria-label={uiText(laneTitle(band.lane))}>
              <header className="quest-tree-band-head">
                {image && <img src={image} alt="" loading="lazy" />}
                <strong>{uiText(laneTitle(band.lane))}</strong>
                <small>{uiText(`${laneProgress(band.lane, availability)} из ${band.lane.questIds.length}`)}</small>
              </header>
            </section>
          })}
          <svg className="quest-tree-links" width={layout.width} height={layout.height} aria-hidden="true">
            {layout.edges.map((edge) => <path key={edge.key} d={edge.path} className={`is-${edge.kind}${chain && edge.from && edge.to && chain.has(edge.from) && chain.has(edge.to) ? ' in-chain' : ''}`} />)}
          </svg>
          {layout.boxes.map((box) => {
            if (box.kind === 'step') {
              const label = stepLabel(box.step!, model.lanes.find((entry) => entry.key === box.laneKey)!)
              return <div key={box.key} className={`quest-tree-step is-${box.step!.kind}`} style={{ left: box.x, top: box.y, width: box.width, height: box.height }} title={uiText(label.hint)}>
                <strong>{uiText(label.title)}</strong>
                {label.detail && <small>{uiText(label.detail)}</small>}
              </div>
            }
            const questId = box.questId!
            const status = questTreeStatus(availability.get(questId))
            const quest = model.quests.get(questId)!
            return box.kind === 'chip'
              ? <QuestChip key={box.key} box={box} quest={quest} sameLane={model.laneOf.get(questId) === box.laneKey} status={status.key} inChain={Boolean(chain?.has(questId))} found={found.has(questId)} onJump={onJump} />
              : <QuestCard key={box.key} box={box} quest={quest} status={status.key} statusText={status.text} selected={questId === selectedId} inChain={Boolean(chain?.has(questId))} found={found.has(questId)} current={questId === currentMatch} onOpen={onOpen} />
          })}
        </div>
      </div>
    </div>
  </>
}

const QuestCard = memo(function QuestCard({ box, quest, status, statusText, selected, inChain, found, current, onOpen }: { box: TreeBox; quest: Quest; status: string; statusText: string; selected: boolean; inChain: boolean; found: boolean; current: boolean; onOpen: (questId: string) => void }) {
  const name = uiText(quest.name)
  return <button
    type="button"
    className={`quest-tree-card is-${status}${selected ? ' is-selected' : ''}${inChain ? ' in-chain' : ''}${found ? ' is-found' : ''}${current ? ' is-current-match' : ''}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    title={statusText ? `${name} · ${uiText(statusText)}` : name}
    aria-current={selected ? 'true' : undefined}
    data-quest={quest.id}
    onClick={() => onOpen(quest.id)}
  >
    <StatusMark status={status} />
    <strong>{name}</strong>
    <small>{uiText(`ур. ${quest.level}`)}{quest.kappa ? <span className="quest-tree-kappa" title={uiText('капа')}>K</span> : null}</small>
  </button>
})

const QuestChip = memo(function QuestChip({ box, quest, sameLane, status, inChain, found, onJump }: { box: TreeBox; quest: Quest; sameLane: boolean; status: string; inChain: boolean; found: boolean; onJump: (questId: string) => void }) {
  const label = sameLane ? uiText(quest.name) : `${uiText(quest.kind === 'story' ? 'Глава истории' : quest.trader)}: ${uiText(quest.name)}`
  return <button
    type="button"
    className={`quest-tree-chip is-${status} is-${box.direction}${inChain ? ' in-chain' : ''}${found ? ' is-found' : ''}`}
    style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
    title={label}
    data-quest-link={quest.id}
    onClick={() => onJump(quest.id)}
  >
    <StatusMark status={status} />
    <span>{label}</span>
    <ChevronRight size={13} aria-hidden="true" />
  </button>
})

const STATUS_LEGEND: Array<[string, string]> = [['completed', 'Выполнено'], ['active', 'Текущее'], ['available', 'Доступно'], ['locked', 'Недоступно'], ['failed', 'Провалено']]
const LINK_LEGEND: Array<[QuestLinkKind, string]> = [['complete', 'сдать'], ['active', 'взять'], ['failed', 'провалить']]

function Legend() {
  return <div className="quest-tree-legend" data-testid="quest-tree-legend">
    {STATUS_LEGEND.map(([status, text]) => <span key={status} className={`quest-tree-legend-status is-${status}`}><StatusMark status={status} />{uiText(text)}</span>)}
    <span className="quest-tree-legend-gap" aria-hidden="true" />
    {LINK_LEGEND.map(([kind, text]) => <span key={kind} className="quest-tree-legend-link"><svg width="22" height="8" aria-hidden="true"><path d="M1 4H21" className={`is-${kind}`} /></svg>{uiText(text)}</span>)}
  </div>
}
