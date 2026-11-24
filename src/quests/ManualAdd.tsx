import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ListPlus, Search, X } from 'lucide-react'
import type { Quest, RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { isLiveGameQuest, isStoryQuest, type TaskAvailability } from '../progression/requirementEngine'
import { useAppState } from '../state/AppState'
import './manualMarks.css'

const MODE_NAMES: Record<RaidMode, { ru: string; en: string }> = { pvp: { ru: 'PvP', en: 'PvP' }, pve: { ru: 'PvE', en: 'PvE' }, seasonal: { ru: 'Сезон', en: 'Season' } }

/** RU / EN texts of «Ручное добавление». */
export function manualAddText(locale: 'ru' | 'en') {
  return locale === 'en'
    ? {
      button: 'Add manually', title: 'Add quests manually', close: 'Close',
      lead: (mode: string) => `Tick the quests you have taken in the game (${mode}) and press «Add». From then on the game's logs keep them up to date.`,
      search: 'Search quests…', list: 'Quests', level: (level: number) => `level ${level}`, current: 'already current', completed: 'completed',
      nothing: 'Nothing found', cancel: 'Cancel', add: (count: number) => (count ? `Add (${count})` : 'Add'),
    }
    : {
      button: 'Ручное добавление', title: 'Ручное добавление', close: 'Закрыть',
      lead: (mode: string) => `Отметьте квесты, которые у вас сейчас взяты в игре (${mode}), и нажмите «Добавить». Дальше их обновляют логи игры.`,
      search: 'Поиск квеста…', list: 'Квесты', level: (level: number) => `ур. ${level}`, current: 'уже в текущих', completed: 'выполнен',
      nothing: 'Ничего не найдено', cancel: 'Отмена', add: (count: number) => (count ? `Добавить (${count})` : 'Добавить'),
    }
}

interface ManualAddProps {
  /** The catalog of the mode shown. */
  quests: readonly Quest[]
  availability: ReadonlyMap<string, TaskAvailability>
  mode: RaidMode
  locale: 'ru' | 'en'
}

/**
 * «Ручное добавление» (owner, 03.11.2026: «нажимаешь ее и открывается окно с поиском и выбором квестов галочкой, после
 * поиска и отметки нужных квестов, нажимаешь кнопку добавить. все, теперь у человека есть квесты. далее они будут
 * синхронизироваться автоматически, так как будут выходить новые логи»). The game deletes its old logs, so a quest taken
 * before them never shows from the logs: the player ticks it here once and it becomes a «В текущие» mark
 * (AppState.addManualQuests); the logs decide again from the quest's next event on. Replaces the «Ручная отметка» switch
 * of the Quests page; the marks of one quest stay in its card (ManualMarkActions).
 */
export function ManualAddButton(props: ManualAddProps) {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="button small" data-testid="quest-manual-add" onClick={() => setOpen(true)}><ListPlus size={14} aria-hidden="true" /> {manualAddText(props.locale).button}</button>
    {open && <ManualAddDialog {...props} onClose={() => setOpen(false)} />}
  </>
}

function ManualAddDialog({ quests, availability, mode, locale, onClose }: ManualAddProps & { onClose: () => void }) {
  const { addManualQuests } = useAppState()
  const text = manualAddText(locale)
  const [query, setQuery] = useState('')
  const [chosen, setChosen] = useState<ReadonlySet<string>>(() => new Set())
  const search = useRef<HTMLInputElement>(null)
  useEffect(() => { search.current?.focus() }, [])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // The trader quests of the mode (story chapters come from the story pane), by name.
  const rows = useMemo(() => quests.filter((quest) => isLiveGameQuest(quest) && !isStoryQuest(quest))
    .map((quest) => ({ quest, name: uiText(quest.name), trader: uiText(quest.trader), status: availability.get(quest.id)?.status }))
    .sort((left, right) => left.name.localeCompare(right.name, locale)), [quests, availability, locale])
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter((row) => `${row.quest.name} ${row.name} ${row.quest.trader} ${row.trader}`.toLowerCase().includes(needle)) : rows
  const toggle = (id: string) => setChosen((current) => {
    const next = new Set(current)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const add = () => {
    addManualQuests(mode, [...chosen])
    onClose()
  }
  return createPortal(<div className="registration-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="panel registration-dialog manual-add-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-add-title" aria-describedby="manual-add-text">
      <button type="button" className="registration-close" onClick={onClose} aria-label={text.close}><X size={18} /></button>
      <h2 id="manual-add-title">{text.title}</h2>
      <p id="manual-add-text" className="manual-add-lead">{text.lead(MODE_NAMES[mode][locale])}</p>
      <label className="manual-add-search"><Search size={14} aria-hidden="true" /><input ref={search} className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={text.search} aria-label={text.search} /></label>
      <ul className="manual-add-list" aria-label={text.list}>
        {shown.map(({ quest, name, trader, status }) => {
          // Already in «Текущие» or handed in: shown ticked, nothing to add.
          const held = status === 'active' || status === 'completed'
          return <li key={quest.id}>
            <label className={`manual-add-row${held ? ' is-held' : ''}`}>
              <input type="checkbox" checked={held || chosen.has(quest.id)} disabled={held} onChange={() => toggle(quest.id)} />
              <span className="manual-add-name">{name}</span>
              <small>{trader}{quest.level ? ` · ${text.level(quest.level)}` : ''}{held ? ` · ${status === 'active' ? text.current : text.completed}` : ''}</small>
            </label>
          </li>
        })}
        {!shown.length && <li className="manual-add-empty">{text.nothing}</li>}
      </ul>
      <div className="manual-add-actions">
        <button type="button" className="button ghost" onClick={onClose}>{text.cancel}</button>
        <button type="button" className="button primary" disabled={!chosen.size} onClick={add}>{text.add(chosen.size)}</button>
      </div>
    </section>
  </div>, document.body)
}
