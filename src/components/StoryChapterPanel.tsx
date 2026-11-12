import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, MapPin, Minus, Plus, X } from 'lucide-react'
import type { GameMap, ModeProgress, Quest } from '../domain/types'
import { STORY_BRANCHES, STORY_CHAPTER_SEEDS } from '../data/storyChapterSeeds'
import { choicesOfStage, nextStoryStage, previousStoryStage, type RouteQuestion } from '../data/storyRoutes'
import { endingName, storyChapterId } from '../endings/storyEndings'
import { StageDecisionHint } from '../endings/StoryDecisionNotes'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import { currentStoryStageIndex } from '../progression/requirementEngine'
import { goalDone, stageDone, stageGoals, type StageGoal, type StageMarks } from '../progression/storyStageGoals'
import { useAppState } from '../state/AppState'
import './storyChapterPanel.css'

/**
 * A story chapter, marked by hand (owner, 05.11.2026: «Сюжетные квесты теперь добавляем вручную»): «Начать главу» opens its stages,
 * the player ticks where he is; then the stage's goals, ticks and counters, and at the bottom «Вернуться к прошлому этапу» on the left
 * and «Ок» or, once its goals are done, «Перейти на следующий этап» on the right. A choice that decides the route is asked at the
 * moment the way on reaches it, with where each answer leads.
 */
export function StoryChapterPanel({ quest, progress, maps, quests, onOpenChapter, onDone, changing, onChangingDone }: {
  quest: Quest
  progress: ModeProgress
  maps: GameMap[]
  /** All chapters: the one after this one takes over when it is finished. */
  quests: readonly Quest[]
  onOpenChapter: (questId: string) => void
  /** «Ок»: the phone's sheet closes. */
  onDone?: () => void
  /** The list of stages asked for from outside (the right click). */
  changing?: boolean
  onChangingDone?: () => void
}) {
  const state = useAppState()
  const { locale } = useLocale()
  const [picking, setPicking] = useState(false)
  const [saved, setSaved] = useState(false)
  const mode = state.raidMode
  const record = progress.taskProgress[quest.id]
  const started = record?.status === 'active'
  const finished = record?.status === 'completed'
  const stages = quest.stages ?? []
  const stageIndex = currentStoryStageIndex(quest, progress)
  const chapterId = storyChapterId(quest)
  const choices = progress.storyManual?.choices ?? {}
  const manualOf = (id: string) => progress.storyManual?.chapters[id]
  const chapterDone = (id: string) => progress.taskProgress[`story-${id}`]?.status === 'completed'
  const marks: StageMarks = manualOf(quest.id)?.marks[String(stageIndex)] ?? {}
  const goals = stageGoals(quest, stageIndex)
  const done = stageDone(goals, marks)
  const next = nextStoryStage(chapterId, stageIndex, stages.length, choices, chapterDone)
  const previous = previousStoryStage(chapterId, stageIndex, choices, chapterDone)
  const stage = stages[stageIndex]
  const showPicker = picking || changing === true
  const closePicker = () => { setPicking(false); onChangingDone?.() }

  useEffect(() => {
    if (!saved) return
    const timer = window.setTimeout(() => setSaved(false), 1500)
    return () => window.clearTimeout(timer)
  }, [saved])

  const finish = () => {
    state.setStoryChapter(mode, quest.id, { status: 'completed', stageIndex })
    const order = quests.filter((entry) => entry.kind === 'story').sort((left, right) => (left.storyOrder ?? 99) - (right.storyOrder ?? 99))
    const following = order.slice(order.findIndex((entry) => entry.id === quest.id) + 1).find((entry) => progress.taskProgress[entry.id]?.status !== 'completed')
    if (!following) return
    if (progress.taskProgress[following.id]?.status !== 'active') state.setStoryChapter(mode, following.id, { status: 'active', stageIndex: 0 })
    onOpenChapter(following.id)
  }

  const say = (text: { ru: string; en?: string }) => (locale === 'en' && text.en ? text.en : uiText(text.ru))
  const picker = showPicker && <StagePicker quest={quest} current={started ? stageIndex : finished ? -1 : 0} onClose={closePicker} onPick={(index) => {
    if (index === -1) state.setStoryChapter(mode, quest.id, { status: 'completed', stageIndex: Math.max(0, stages.length - 1) })
    else state.setStoryChapter(mode, quest.id, { status: 'active', stageIndex: index }, choicesOfStage(chapterId, index))
    closePicker()
  }} />

  if (!started) {
    return <section className="detail-section story-chapter">
      {finished
        ? <>
          <p className="story-chapter-note"><Check size={15} aria-hidden="true" />{uiText('Глава выполнена')}</p>
          <button type="button" className="button small ghost" onClick={() => setPicking(true)}>{uiText('Изменить главу')}</button>
        </>
        : <>
          <p className="dim">{uiText('Глава не начата')}</p>
          <button type="button" className="button primary story-chapter-start" onClick={() => setPicking(true)}>{uiText('Начать главу')}</button>
        </>}
      {picker}
    </section>
  }

  const required = goals.goals.filter((goal) => !goal.optional)
  const optional = goals.goals.filter((goal) => goal.optional)
  const goalRow = (goal: StageGoal) => <GoalRow key={goal.key} goal={goal} text={say(goal.text)} marks={marks} onChange={(value) => state.setStoryMark(mode, quest.id, stageIndex, goal.key, value)} />
  return <section className="detail-section story-chapter">
    <div className="story-chapter-head">
      <span className="tag">{locale === 'en' ? `Stage ${stageIndex + 1} of ${stages.length}` : `Этап ${stageIndex + 1} из ${stages.length}`}</span>
      <button type="button" className="story-chapter-change" onClick={() => setPicking(true)}>{uiText('Изменить главу')}</button>
    </div>
    <h4>{uiText('Главные задачи')}</h4>
    <ul className="story-goals">
      {required.map((goal, index) => <li key={goal.key}>{goal.either && required[index - 1]?.either && <span className="story-goals-or">{uiText('или')}</span>}{goalRow(goal)}</li>)}
    </ul>
    {optional.length > 0 && <>
      <h4>{uiText('Дополнительные задачи')}</h4>
      <ul className="story-goals">{optional.map((goal) => <li key={goal.key}>{goalRow(goal)}</li>)}</ul>
    </>}
    {goals.hint && <p className="story-objective-hint">{uiText(goals.hint)}</p>}
    {stage && <StageDecisionHint text={stage.title} />}
    {stage?.mapIds.length ? <div className="story-objective-maps">{stage.mapIds.map((mapId) =>
      <Link className="button ghost" key={mapId} to={`/maps/${mapId}?quest=${encodeURIComponent(quest.id)}&stage=${stageIndex}`}><MapPin size={14} />{uiText('Показать на карте')} · {uiText(maps.find((map) => map.id === mapId)?.name ?? mapId)}</Link>)}</div> : null}
    {done && next.ask && <RouteChoice question={next.ask} onPick={(option) => state.setStoryChoice(mode, next.ask!.id, option)} />}
    <div className="story-chapter-actions">
      <button type="button" className="button small ghost" disabled={previous === null} onClick={() => { if (previous !== null) state.setStoryChapter(mode, quest.id, { status: 'active', stageIndex: previous }) }}><ArrowLeft size={14} aria-hidden="true" />{uiText('Вернуться к прошлому этапу')}</button>
      {!done || next.ask
        ? <button type="button" className="button small primary" onClick={() => { setSaved(true); onDone?.() }}>{saved ? uiText('Сохранено') : uiText('Ок')}</button>
        : next.index !== null
          ? <button type="button" className="button small primary" onClick={() => state.setStoryChapter(mode, quest.id, { status: 'active', stageIndex: next.index! })}>{uiText('Перейти на следующий этап')}<ArrowRight size={14} aria-hidden="true" /></button>
          : <button type="button" className="button small primary" onClick={finish}>{uiText('Завершить главу')}<Check size={14} aria-hidden="true" /></button>}
    </div>
    {picker}
  </section>
}

function GoalRow({ goal, text, marks, onChange }: { goal: StageGoal; text: string; marks: StageMarks; onChange: (value: number) => void }) {
  const done = goalDone(goal, marks)
  const count = marks[goal.key] ?? 0
  if (goal.target) {
    return <div className={`story-goal is-counter${done ? ' is-done' : ''}`}>
      <span className="story-goal-text">{text}{goal.optional && <small> ({uiText('опционально')})</small>}</span>
      <span className="story-goal-counter">
        <button type="button" aria-label={uiText('Меньше')} disabled={count <= 0} onClick={() => onChange(count - 1)}><Minus size={13} aria-hidden="true" /></button>
        <b>{count}/{goal.target}</b>
        <button type="button" aria-label={uiText('Больше')} disabled={count >= goal.target} onClick={() => onChange(count + 1)}><Plus size={13} aria-hidden="true" /></button>
      </span>
    </div>
  }
  return <label className={`story-goal${done ? ' is-done' : ''}`}>
    <input type="checkbox" checked={done} onChange={() => onChange(done ? 0 : 1)} />
    <span className="story-goal-text">{text}{goal.optional && <small> ({uiText('опционально')})</small>}</span>
  </label>
}

/** The choice the way on stands at, with where each answer leads and to which endings. */
function RouteChoice({ question, onPick }: { question: RouteQuestion; onPick: (option: string) => void }) {
  const { locale } = useLocale()
  const language = locale === 'en' ? 'en' : 'ru'
  return <div className="story-route">
    <h4>{question.title[language]}</h4>
    {question.options.map((option) => (
      <button type="button" key={option.id} className="story-route-option" onClick={() => onPick(option.id)}>
        <strong>{option.label[language]}</strong>
        {option.decision && <small>{option.decision.outcome[language]}</small>}
        {option.decision && option.decision.endings.length < 4 && <span className="story-route-endings">{option.decision.endings.map((id) => <span key={id} className={`tag ending-tag is-${id}`}>{endingName(id)[language]}</span>)}</span>}
      </button>
    ))}
  </div>
}

/** «Начать главу», «Изменить главу»: the chapter's stages, by route; a tick on where the player is, «Ок». */
function StagePicker({ quest, current, onPick, onClose }: { quest: Quest; current: number; onPick: (index: number) => void; onClose: () => void }) {
  const { locale } = useLocale()
  const [chosen, setChosen] = useState(current)
  const chapter = storyChapterId(quest)
  const seed = chapter ? STORY_CHAPTER_SEEDS.find((entry) => entry.id === chapter) : undefined
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(
    <div className="registration-overlay story-picker-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="panel registration-dialog story-picker" role="dialog" aria-modal="true" aria-label={uiText('На каком вы этапе?')}>
        <button type="button" className="registration-close" onClick={onClose} aria-label={uiText('Закрыть')}><X size={18} /></button>
        <h2>{uiText(quest.name)}</h2>
        <p className="dim">{uiText('На каком вы этапе?')}</p>
        <div className="story-picker-list">
          {(quest.stages ?? []).map((stage, index) => {
            const branch = seed?.stages[index]?.branch
            const header = branch && branch !== seed?.stages[index - 1]?.branch ? branch : undefined
            const title = locale === 'en' && seed?.stages[index]?.en ? seed.stages[index].en : uiText(stage.title)
            return <div key={stage.id}>
              {header && <h3>{locale === 'en' ? header : STORY_BRANCHES[header] ?? header}</h3>}
              <label className={chosen === index ? 'is-chosen' : ''}>
                <input type="radio" name="story-stage" checked={chosen === index} onChange={() => setChosen(index)} />
                <span>{index + 1}. {title}</span>
              </label>
            </div>
          })}
          <label className={`story-picker-done${chosen === -1 ? ' is-chosen' : ''}`}>
            <input type="radio" name="story-stage" checked={chosen === -1} onChange={() => setChosen(-1)} />
            <span>{uiText('Глава уже выполнена')}</span>
          </label>
        </div>
        <div className="story-picker-actions">
          <button type="button" className="button primary" onClick={() => onPick(chosen)}>{uiText('Ок')}</button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
