import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Check, CircleDot, KeyRound, MapPin, Package, Search, Split, Trophy } from 'lucide-react'
import type { Item, ModeProgress, Quest } from '../domain/types'
import { useTarkovData } from '../data/DataProvider'
import { useLocale } from '../i18n/LocaleProvider'
import { uiLabel, uiText } from '../i18n/renderText'
import { currentStoryStageIndex, isStoryQuest, type TaskAvailability } from '../progression/requirementEngine'
import { belongsInQuestSection } from '../progression/questSections'
import { visibleStoryObjectives } from '../progression/storyObjectives'
import { storyChapterGuide, storyGuideSearchText, type StoryGuideChapter, type StoryGuideItem, type StoryGuideObjective } from '../data/storyChapterGuide'
import { endingName } from '../endings/storyEndings'
import { StageDecisionHint, StoryDecisionNotes } from '../endings/StoryDecisionNotes'
import { featureEnabled } from '../app/archivedFeatures'
import './storyChaptersAll.css'

const ROLE_LABELS: Record<StoryGuideItem['role'], string> = {
  handover: 'Передать торговцу',
  find: 'Найти',
  place: 'Заложить / оставить',
  bring: 'Взять с собой',
  key: 'Ключ',
  need: 'Нужно на месте',
}

type ChapterStatus = 'completed' | 'active' | 'failed' | 'not-started'
const STATUS_LABELS: Record<ChapterStatus, string> = { completed: 'Глава выполнена', active: 'Глава в процессе', failed: 'Глава провалена', 'not-started': 'Глава не начата' }
const STATUS_TONES: Record<ChapterStatus, string> = { completed: 'green', active: 'brass', failed: 'danger', 'not-started': '' }

interface StoryChaptersAllProps {
  availability: Map<string, TaskAvailability>
  progress: ModeProgress
  onBack: () => void
}

/**
 * «Показать все» of the Quests page's story tab: every story chapter of the base, reached or not, with every stage and
 * objective, its map points, the items to hand over and to find, keys, rewards and the routes to the endings.
 */
export function StoryChaptersAll({ availability, progress, onBack }: StoryChaptersAllProps) {
  const { data } = useTarkovData()
  const { locale } = useLocale()
  const lang = locale === 'en' ? 'en' : 'ru'
  const [query, setQuery] = useState('')
  const itemsById = useMemo(() => new Map(data.items.map((item) => [item.id, item])), [data.items])
  const iconBase = useMemo(() => data.items.map((item) => item.iconUrl).find((url): url is string => Boolean(url && /\/[0-9a-f]{24}-icon\.webp$/.test(url))), [data.items])
  const chapters = useMemo(() => data.quests.filter(isStoryQuest)
    .sort((left, right) => (left.storyOrder ?? 99) - (right.storyOrder ?? 99) || left.name.localeCompare(right.name, 'ru'))
    .map((quest) => ({ quest, guide: storyChapterGuide(quest) })), [data.quests])
  const needle = query.trim().toLowerCase()
  const shown = chapters.filter(({ guide }) => !needle || storyGuideSearchText(guide, 'ru').includes(needle) || storyGuideSearchText(guide, 'en').includes(needle))
  const mapName = (id: string) => data.maps.find((map) => map.id === id)?.name ?? id
  const jump = (id: string) => document.getElementById(`story-all-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return <section className="panel story-all" data-testid="story-all" aria-label={uiText('Все сюжетные главы')}>
    <div className="story-all-head">
      <div className="story-all-title-row">
        <button type="button" className="button ghost small" onClick={onBack}><ArrowLeft size={14} /> {uiText('Назад к главам')}</button>
        <h2>{uiText('Все сюжетные главы')} <span className="tag">{chapters.length}</span></h2>
      </div>
      <div className="story-all-search">
        <Search size={14} aria-hidden="true" />
        <input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={uiText('Поиск по главам, задачам и предметам…')} aria-label={uiText('Поиск по главам, задачам и предметам…')} />
      </div>
      <nav className="story-all-jump" aria-label={uiText('Перейти к главе')}>
        {shown.map(({ quest, guide }, index) => <button type="button" key={quest.id} onClick={() => jump(guide.id)}>
          <span>{index + 1}</span>{guide.title[lang]}
        </button>)}
      </nav>
    </div>
    {!shown.length && <div className="empty-state"><div><Search size={26} /><p>{uiText('Ничего не найдено.')}</p></div></div>}
    {shown.map(({ quest, guide }) => <ChapterCard key={quest.id} quest={quest} guide={guide} lang={lang} needle={needle}
      status={chapterStatus(quest, availability, progress)} progress={progress} itemsById={itemsById} iconBase={iconBase} mapName={mapName} />)}
  </section>
}

function chapterStatus(quest: Quest, availability: Map<string, TaskAvailability>, progress: ModeProgress): ChapterStatus {
  const status = availability.get(quest.id)?.status
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'active' || belongsInQuestSection(quest, progress, 'story')) return 'active'
  return 'not-started'
}

interface ChapterCardProps {
  quest: Quest
  guide: StoryGuideChapter
  lang: 'ru' | 'en'
  needle: string
  status: ChapterStatus
  progress: ModeProgress
  itemsById: Map<string, Item>
  iconBase?: string
  mapName: (id: string) => string
}

function ChapterCard({ quest, guide, lang, needle, status, progress, itemsById, iconBase, mapName }: ChapterCardProps) {
  const other = lang === 'en' ? 'ru' : 'en'
  const current = status === 'active' && progress.taskProgress[quest.id]?.currentStageIndex != null ? currentStoryStageIndex(quest, progress) : undefined
  const done = new Set(visibleStoryObjectives(quest, progress).filter((objective) => objective.completed && objective.stageIndex != null).map((objective) => objective.stageIndex!))
  // a chapter found by its name shows whole; otherwise only the objectives that match
  const whole = !needle || guide.title.ru.toLowerCase().includes(needle) || guide.title.en.toLowerCase().includes(needle)
  const objectives = whole ? guide.objectives : guide.objectives.filter((objective) => objectiveMatches(objective, needle))
  const tracked = guide.objectives.filter((objective) => objective.stage != null)
  const stageCount = new Set(tracked.map((objective) => objective.stage)).size
  const itemProps = { lang, itemsById, iconBase }

  return <article className="story-all-chapter" id={`story-all-${guide.id}`} data-chapter={guide.id}>
    <header className="story-all-chapter-head">
      <span className="story-all-order">{quest.storyOrder ?? '—'}</span>
      <div>
        <h3>{guide.title[lang]}</h3>
        {guide.title[other] !== guide.title[lang] && <small className="dim">{guide.title[other]}</small>}
      </div>
      <span className={`tag ${STATUS_TONES[status]}`} data-status={status}>{uiText(STATUS_LABELS[status])}</span>
    </header>
    <p className="story-all-meta dim">{uiText('Этапов в игре')}: {stageCount} · {uiText('задач в списке')}: {guide.objectives.length}</p>

    {guide.unlock && (guide.unlock[lang] || guide.unlock.en) && <div className="story-all-block">
      <h4>{uiText('Как открыть')}</h4>
      <p className="story-all-unlock">{guide.unlock[lang] || guide.unlock.en}</p>
    </div>}

    {guide.keys.length > 0 && <div className="story-all-block">
      <h4><KeyRound size={14} aria-hidden="true" /> {uiText('Ключи и нужные предметы')}</h4>
      <div className="story-all-items">{guide.keys.map((item) => <ItemChip key={item.en} item={item} {...itemProps} />)}
      </div>
    </div>}

    <div className="story-all-block">
      <h4>{uiText('Этапы и задачи')}</h4>
      <ol className="story-all-objectives">
        {objectives.map((objective, index) => {
          const previous = objectives[index - 1]
          const newBranch = objective.branch?.key !== previous?.branch?.key
          return <ObjectiveRow key={objective.key} number={guide.objectives.indexOf(objective) + 1} objective={objective} quest={quest} showBranch={newBranch}
            isCurrent={objective.stage != null && objective.stage === current} isDone={objective.stage != null && done.has(objective.stage)}
            mapName={mapName} {...itemProps} />
        })}
      </ol>
    </div>

    {guide.rewards.length > 0 && <div className="story-all-block">
      <h4><Trophy size={14} aria-hidden="true" /> {uiText('Награды')}</h4>
      <div className="story-all-rewards">{guide.rewards.map((group, index) => <div className="story-all-reward" key={`${group.title.en}-${index}`}>
        {(group.title[lang] || group.title.en) && <strong>{group.title[lang] || group.title.en}</strong>}
        {(group[lang].length ? group[lang] : group.en).map((line, lineIndex) => <p key={lineIndex}>{line}</p>)}
        {group.items.length > 0 && <div className="story-all-items">{group.items.map((item, itemIndex) =>
          <ItemChip key={`${item.id}-${itemIndex}`} item={{ ...item, role: 'find' }} reward {...itemProps} />)}</div>}
      </div>)}</div>
    </div>}

    {featureEnabled('storyEndings') && <StoryDecisionNotes quest={quest} />}
  </article>
}

function objectiveMatches(objective: StoryGuideObjective, needle: string) {
  return [objective.text.ru, objective.text.en, ...objective.steps.flatMap((step) => [step.ru, step.en]), ...objective.items.flatMap((item) => [item.ru, item.en])]
    .some((text) => text.toLowerCase().includes(needle))
}

interface ObjectiveRowProps {
  /** Place in the chapter's full list (the wiki's order), kept while searching. */
  number: number
  objective: StoryGuideObjective
  quest: Quest
  lang: 'ru' | 'en'
  showBranch: boolean
  isCurrent: boolean
  isDone: boolean
  itemsById: Map<string, Item>
  iconBase?: string
  mapName: (id: string) => string
}

function ObjectiveRow({ number, objective, quest, lang, showBranch, isCurrent, isDone, itemsById, iconBase, mapName }: ObjectiveRowProps) {
  // the map button opens the tracked stage on the Maps page, as the quest card does (src/progression/storyObjectives.ts)
  const stageMaps = objective.stage != null ? quest.stages?.[objective.stage]?.mapIds ?? [] : []
  const otherMaps = objective.maps.filter((mapId) => !stageMaps.includes(mapId))
  const stageTitle = objective.stage != null ? quest.stages?.[objective.stage]?.title : undefined
  return <>
    {showBranch && objective.branch && <li className="story-all-branch">
      <Split size={14} aria-hidden="true" />
      <span>{uiText('Ветка:')} {objective.branch[lang]}</span>
      {objective.endings.length > 0 && objective.endings.length < 4 && <span className="decision-endings">{objective.endings.map((id) =>
        <span key={id} className={`tag ending-tag is-${id}`}>{lang === 'en' ? `“${endingName(id).en}”` : `«${endingName(id).ru}»`}</span>)}</span>}
    </li>}
    {showBranch && !objective.branch && <li className="story-all-branch is-common"><span>{uiText('Для всех веток')}</span></li>}
    <li className={`story-all-objective${isCurrent ? ' is-current' : ''}${isDone ? ' is-done' : ''}`} data-stage={objective.stage ?? ''}>
      <div className="story-all-objective-head">
        <span className="story-all-stage-no">{number}</span>
        <span className="story-all-objective-text">{isDone && <Check size={14} aria-label={uiText('Выполнено')} />}{isCurrent && <CircleDot size={14} aria-hidden="true" />} {objective.text[lang]}</span>
        <span className="story-all-tags">
          {objective.count != null && objective.count > 1 && <span className="tag">×{objective.count.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')}</span>}
          {objective.optional && <span className="tag">{uiText('необязательно')}</span>}
          {isCurrent && <span className="tag brass">{uiText('Текущий этап')}</span>}
          {objective.untracked && <span className="tag" title={uiText('Этой задачи нет среди этапов, которые приложение читает из игры')}>{uiText('не отслеживается')}</span>}
        </span>
      </div>
      {objective.steps.length > 0 && <ul className="story-all-steps">{objective.steps.map((step, index) =>
        <li key={index} className={step.depth && step.depth > 1 ? 'is-nested' : ''}>{step[lang]}{step.optional ? ` (${uiText('необязательно')})` : ''}</li>)}</ul>}
      {objective.needs && <p className="story-all-needs"><KeyRound size={13} aria-hidden="true" /> {uiText('Нужно:')} {objective.needs[lang]}</p>}
      {objective.note && <p className="story-all-note">{objective.note[lang]}</p>}
      {objective.items.length > 0 && <div className="story-all-items">{objective.items.map((item) =>
        <ItemChip key={item.id ?? item.en} item={item} lang={lang} itemsById={itemsById} iconBase={iconBase} />)}</div>}
      {(stageMaps.length > 0 || otherMaps.length > 0) && <div className="story-all-maps">
        {stageMaps.map((mapId) => <Link key={mapId} className="button ghost small" data-map-link={mapId}
          to={`/maps/${encodeURIComponent(mapId)}?quest=${encodeURIComponent(quest.id)}&stage=${objective.stage}`}>
          <MapPin size={13} /> {uiText('Показать на карте')} · {uiText(mapName(mapId))}</Link>)}
        {otherMaps.map((mapId) => <span key={mapId} className="tag"><MapPin size={11} /> {uiText(mapName(mapId))}</span>)}
      </div>}
      {stageTitle && <StageDecisionHint text={stageTitle} />}
    </li>
  </>
}

interface ItemChipProps { item: StoryGuideItem; lang: 'ru' | 'en'; itemsById: Map<string, Item>; iconBase?: string; reward?: boolean }

function ItemChip({ item, lang, itemsById, iconBase, reward }: ItemChipProps) {
  const [broken, setBroken] = useState(false)
  const catalog = item.id ? itemsById.get(item.id) : undefined
  const icon = catalog?.iconUrl ?? (item.id ? iconBase?.replace(/[0-9a-f]{24}-icon\.webp$/, `${item.id}-icon.webp`) ?? `https://assets.tarkov.dev/${item.id}-icon.webp` : undefined)
  const label = [reward ? '' : uiLabel(ROLE_LABELS[item.role]), item.fir ? uiLabel('Найти в рейде') : '', item.optional ? uiText('необязательно') : ''].filter(Boolean).join(' · ')
  const body = <>
    {icon && !broken ? <img src={icon} alt="" loading="lazy" onError={() => setBroken(true)} /> : <span className="story-all-item-icon"><Package size={16} /></span>}
    <span>
      <strong>{item[lang] || item.en}{item.count != null && item.count > 1 ? ` ×${item.count.toLocaleString(lang === 'en' ? 'en-US' : 'ru-RU')}` : ''}</strong>
      {label && <small>{label}</small>}
    </span>
  </>
  return catalog
    ? <Link className="story-all-item" to={`/flea?selected=${catalog.id}`} data-item={item.id}>{body}</Link>
    : <span className="story-all-item" data-item={item.id ?? ''}>{body}</span>
}
