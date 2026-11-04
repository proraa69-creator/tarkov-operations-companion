import { describe, expect, it } from 'vitest'
import type { Quest, TaskProgressRecord } from '../domain/types'
import { exactTableRows, searchFieldLanguage, stampContradicts, sweepResult, wholeTableChanges, withTableFrame, type TableSweep } from './tableSweep'
import type { TasksTableReading } from './tasksTableLayout'

const quest = (id: string, nameRu: string, nameEn: string, extra: Partial<Quest> = {}): Quest => ({ id, name: nameRu, nameRu, nameEn, trader: 'Прапор', level: 1, kappa: false, description: '', objectives: [], rewards: [], ...extra })

/** Twelve rows of a list, as the game writes them. */
const TITLES = ['Простая задача', 'Спецзаказ', 'Уникальный опыт', 'Сотрудник TerraGroup', 'Опасный реквизит', 'Освободить помещение', 'Проверка гипотез', 'Модный приговор', 'Следопыт', 'Топливный кризис', 'Планы снабжения', 'Первый в очереди']
const QUESTS: Quest[] = [
  ...TITLES.map((title, index) => quest(`q${index}`, title, `Quest ${index}`)),
  quest('k1', 'Каратель. Часть 1', 'Punisher - Part 1'),
  quest('k2', 'Каратель. Часть 2', 'Punisher - Part 2'),
  quest('held', 'Лишний квест', 'Extra Quest'),
  quest('text-usec', 'Текстиль. Часть 1', 'Textile - Part 1', { faction: 'USEC' }),
  quest('text-bear', 'Текстиль. Часть 1', 'Textile - Part 1', { faction: 'BEAR' }),
  quest('chapter', 'Тур', 'Tour', { kind: 'story' }),
]

/** The view holds 8.8 rows. A list of `titles` scrolled so that row `from` is first in view. */
function frame(titles: string[], from: number, overrides: Partial<TasksTableReading> = {}): TasksTableReading {
  const page = titles.slice(from, from + 8)
  const pageRows = 8.8
  const scrolls = titles.length > 8
  return {
    rows: page.map((title) => ({ title, status: 'активно!' })),
    stray: false,
    atTop: from === 0,
    atBottom: from + page.length >= titles.length,
    fits: !scrolls,
    share: scrolls ? pageRows / titles.length : null,
    pageRows,
    scroll: from * 10,
    sideTab: true,
    search: 'Поиск aa',
    ...overrides,
  }
}

function read(frames: TasksTableReading[]) {
  let sweep: TableSweep | null = null
  frames.forEach((reading, index) => { sweep = withTableFrame(sweep, reading, 1000 + index * 1000).sweep })
  return sweep as TableSweep | null
}
const none = new Set<string>()

describe('a whole read of the Tasks table (owner, 04.11.2026)', () => {
  it('frames that overlap make the list, top to bottom: proven, one row a title', () => {
    const result = sweepResult(read([frame(TITLES, 0), frame(TITLES, 4)]), QUESTS, none)
    expect(result.proven).toBe(true)
    expect(result.rows.map((row) => row.ids[0])).toEqual(TITLES.map((_, index) => `q${index}`))
  })

  it('the order they came in does not matter: up the list as well as down it', () => {
    expect(sweepResult(read([frame(TITLES, 4), frame(TITLES, 2), frame(TITLES, 0)]), QUESTS, none).proven).toBe(true)
  })

  it('not proven without the list\'s last rows (the end of the list not reached)', () => {
    const result = sweepResult(read([frame(TITLES, 0), frame(TITLES, 2)]), QUESTS, none)
    expect(result.proven).toBe(false)
    expect(result.read).toBe(10)
    expect(result.total).toBe(12)
  })

  it('not proven without its first rows, however much of the rest', () => {
    expect(sweepResult(read([frame(TITLES, 3), frame(TITLES, 4)]), QUESTS, none).proven).toBe(false)
  })

  it('a gap between frames is no list: two pieces, not proven until a frame joins them', () => {
    const long = [...TITLES, 'Каратель. Часть 1', 'Каратель. Часть 2', ...Array.from({ length: 4 }, (_, index) => `Новый квест номер ${index}`)]
    const pieces = [frame(long, 0), frame(long, 10)]
    expect(sweepResult(read(pieces), QUESTS, new Set(['k1', 'k2'])).proven).toBe(false)
  })

  it('one row misread leaves it unsettled: nothing goes until it reads exactly', () => {
    const misread = frame(TITLES, 4)
    misread.rows[0] = { title: 'Опаснй реквизит', status: 'активно!' }
    const once = sweepResult(read([frame(TITLES.slice(0, 12).map((title) => (title === 'Опасный реквизит' ? 'Опаснй реквизит' : title)), 0), misread]), QUESTS, none)
    expect(once.proven).toBe(false)
    expect(once.unsettled).toBe(1)
    // The same row read exactly from another place of the list settles it.
    expect(sweepResult(read([frame(TITLES.slice(0, 12).map((title) => (title === 'Опасный реквизит' ? 'Опаснй реквизит' : title)), 0), misread, frame(TITLES, 2)]), QUESTS, none).proven).toBe(true)
  })

  it('a part title never takes a row: «Каратель» and «Спец» are no titles', () => {
    const list = [...TITLES.slice(0, 7), 'Каратель']
    const reading = frame(list, 0, { atBottom: true, fits: true, share: null })
    const again = { ...reading }
    expect(sweepResult(read([reading, again]), QUESTS, none).proven).toBe(false)
  })

  it('an empty row (nothing read on it) is unsettled, whatever the rest', () => {
    const list = TITLES.slice(0, 5)
    const reading = frame(list, 0)
    reading.rows[2] = { title: '', status: '' }
    expect(sweepResult(read([reading, { ...reading }]), QUESTS, none).proven).toBe(false)
  })

  it('a title the catalog lacks: settled once it reads alike at two places, and near no catalog title. It names nothing', () => {
    const list = ['Честный отзыв про меня', ...TITLES]
    const result = sweepResult(read([frame(list, 0), frame(list, 3), frame(list, 5)]), QUESTS, none)
    expect(result.proven).toBe(false)
    const second = { ...frame(list, 0), scroll: 3 }
    const proven = sweepResult(read([frame(list, 0), second, frame(list, 5)]), QUESTS, none)
    expect(proven.proven).toBe(true)
    expect(proven.rows[0]).toEqual({ ids: [] })
  })

  it('a misreading near a catalog title is never such a title, however often it reads alike', () => {
    const list = ['Простая задаца', ...TITLES.slice(1)]
    expect(sweepResult(read([frame(list, 0), { ...frame(list, 0), scroll: 3 }, frame(list, 4)]), QUESTS, none).proven).toBe(false)
  })

  it('a numbered title not held must read alike twice: one digit is another part', () => {
    const list = ['Каратель. Часть 2', ...TITLES.slice(0, 11)]
    expect(sweepResult(read([frame(list, 0), frame(list, 4)]), QUESTS, none).proven).toBe(false)
    expect(sweepResult(read([frame(list, 0), { ...frame(list, 0), scroll: 5 }, frame(list, 4)]), QUESTS, none).proven).toBe(true)
  })

  it('a numbered title held already needs no second reading: it adds nothing', () => {
    const list = ['Каратель. Часть 2', ...TITLES.slice(0, 11)]
    expect(sweepResult(read([frame(list, 0), frame(list, 4)]), QUESTS, new Set(['k2'])).proven).toBe(true)
  })

  it('two exact titles read on one row: only far fewer of the other', () => {
    const list = ['Каратель. Часть 2', ...TITLES.slice(0, 11)]
    const rival = frame(list, 0, { scroll: 7 })
    rival.rows[0] = { title: 'Каратель. Часть 1', status: 'активно!' }
    expect(sweepResult(read([frame(list, 0), rival, frame(list, 4)]), QUESTS, new Set(['k2'])).proven).toBe(false)
  })

  it('more rows than the thumb says, or fewer: not proven', () => {
    const reading = (from: number) => frame(TITLES, from, { share: 8.8 / 40 })
    expect(sweepResult(read([reading(0), reading(4)]), QUESTS, none).proven).toBe(false)
  })

  it('a list that fits is proven by two fresh readings of its page, not one', () => {
    const list = ['Каратель. Часть 1', ...TITLES.slice(0, 5)]
    expect(sweepResult(read([frame(list, 0)]), QUESTS, none).proven).toBe(false)
    expect(sweepResult(read([frame(list, 0), frame(list, 0)]), QUESTS, none).proven).toBe(true)
    expect(sweepResult(read([frame(TITLES.slice(0, 5), 0)]), QUESTS, none).proven).toBe(false)
  })

  it('a page full of rows with its thumb not found says nothing about the ends of the list', () => {
    const page = frame(TITLES, 0, { atTop: false, atBottom: false, share: null, fits: false })
    expect(sweepResult(read([page, { ...page }]), QUESTS, none).proven).toBe(false)
  })

  it('text under a list that fits: a row the grid missed, not proven', () => {
    const list = TITLES.slice(0, 5)
    expect(sweepResult(read([frame(list, 0, { stray: true }), frame(list, 0)]), QUESTS, none).proven).toBe(false)
  })
})

describe('frames that do not count', () => {
  it('text typed in «Поиск»: a part of the list', () => {
    const step = withTableFrame(null, frame(TITLES, 0, { search: 'Спец' }), 1000)
    expect(step.refusal).toBe('search')
    expect(step.sweep).toBeNull()
  })

  it('the field not read at all counts the same', () => {
    expect(withTableFrame(null, frame(TITLES, 0, { search: '' }), 1000).refusal).toBe('search')
  })

  it('another tab', () => {
    expect(withTableFrame(null, frame(TITLES, 0, { sideTab: false }), 1000).refusal).toBe('tab')
  })

  it('rows «заблокировано» / «доступно»: a trader\'s own tab', () => {
    const reading = frame(TITLES, 0)
    reading.rows[1] = { title: 'Спецзаказ', status: 'заблокировано' }
    expect(withTableFrame(null, reading, 1000).refusal).toBe('view')
  })

  it('a copy of the last reading is no new frame', () => {
    const first = withTableFrame(null, frame(TITLES, 0), 1000).sweep
    expect(withTableFrame(first, frame(TITLES, 4), 1000).sweep).toBe(first)
  })

  it('a list of another length begins anew: a search typed and cleared, another list', () => {
    const first = withTableFrame(null, frame(TITLES, 0), 1000).sweep!
    const other = withTableFrame(first, frame(TITLES, 4, { share: 8.8 / 30 }), 2000).sweep!
    expect(other.startedAt).toBe(2000)
    expect(other.pieces).toHaveLength(1)
  })

  it('the list sorted anew mid-way begins anew: the rows disagree about their order', () => {
    const reversed = [...TITLES].reverse()
    const first = withTableFrame(null, frame(TITLES, 0), 1000).sweep!
    const again = withTableFrame(first, frame(reversed, 0, { scroll: 40 }), 2000).sweep!
    expect(again.startedAt).toBe(2000)
  })

  it('the read keeps the time of its first frame: what the logs say after it is newer', () => {
    const sweep = read([frame(TITLES, 0), frame(TITLES, 4)])!
    expect(sweep.startedAt).toBe(1000)
    expect(sweep.lastAt).toBe(2000)
  })

  it('the language comes from the field', () => {
    expect(searchFieldLanguage('Поиск aa')).toBe('ru')
    expect(searchFieldLanguage('  search')).toBe('en')
    expect(searchFieldLanguage('Поиск квеста')).toBe('ru')
    expect(searchFieldLanguage('Поискать')).toBeNull()
    expect(searchFieldLanguage('Спец')).toBeNull()
  })

  it('in the English game only the English titles count', () => {
    const list = ['Quest 0', 'Quest 1', 'Quest 2']
    const english = frame(list, 0, { search: 'Search' })
    expect(sweepResult(read([english, english]), QUESTS, none).proven).toBe(true)
    const russian = frame(['Простая задача', 'Спецзаказ', 'Следопыт'], 0, { search: 'Search' })
    expect(sweepResult(read([russian, russian]), QUESTS, none).proven).toBe(false)
  })

  it('the corner stamp names another mode', () => {
    expect(stampContradicts('1.1.5.1.47510 | PvE', 'pvp')).toBe(true)
    expect(stampContradicts('1.1.5.1.47510 | PvE', 'pve')).toBe(false)
    expect(stampContradicts('1.3.0.0 GHXXDS | PvP $', 'pve')).toBe(true)
    expect(stampContradicts('1.3.0.0 GHXXDS | PvP $', 'seasonal')).toBe(false)
    expect(stampContradicts('нет штампа', 'pve')).toBe(false)
  })
})

describe('what a whole read changes', () => {
  const active = (taskId: string, source: TaskProgressRecord['source'] = 'eft-log'): TaskProgressRecord => ({ taskId, status: 'active', source, updatedAt: '2026-10-01T00:00:00.000Z' })
  const rows = (...ids: string[]) => ids.map((id) => ({ ids: [id] }))

  it('adds what the list has, removes what it does not: from the logs as well as from the screen', () => {
    const records = { q0: active('q0'), held: active('held'), q1: active('q1', 'screen-scan') }
    expect(wholeTableChanges(records, rows('q0', 'q2'), QUESTS)).toEqual({ added: ['q2'], gone: ['held', 'q1'] })
  })

  it('a quest of the mode\'s story is never gone: its chapter is on another tab', () => {
    expect(wholeTableChanges({ chapter: active('chapter') }, rows('q0'), QUESTS).gone).toEqual([])
  })

  it('an id no catalog quest has stays: nothing says where it would be', () => {
    expect(wholeTableChanges({ unknown: active('unknown') }, rows('q0'), QUESTS).gone).toEqual([])
  })

  it('what is closed stays out of it: a hand-in the list does not show is no change', () => {
    const records: Record<string, TaskProgressRecord> = { q5: { ...active('q5'), status: 'completed' } }
    expect(wholeTableChanges(records, rows('q0'), QUESTS)).toEqual({ added: ['q0'], gone: [] })
  })

  it('a row over an older hand-in: the list is the newer word', () => {
    const records: Record<string, TaskProgressRecord> = { q0: { ...active('q0'), status: 'completed' } }
    expect(wholeTableChanges(records, rows('q0'), QUESTS).added).toEqual(['q0'])
  })

  it('a row «провалено» is not current', () => {
    expect(wholeTableChanges({ q0: active('q0') }, [{ ids: ['q0'], status: 'failed' as const }], QUESTS).gone).toEqual(['q0'])
  })

  it('faction variants share a title: the held one stays and no other comes', () => {
    const row = [{ ids: ['text-usec', 'text-bear'] }]
    expect(wholeTableChanges({ 'text-bear': active('text-bear') }, row, QUESTS)).toEqual({ added: [], gone: [] })
    expect(wholeTableChanges({}, row, QUESTS, 'bear').added).toEqual(['text-bear'])
  })

  it('a title the catalog lacks changes nothing', () => {
    expect(wholeTableChanges({}, [{ ids: [] }], QUESTS)).toEqual({ added: [], gone: [] })
  })
})

describe('rows of one frame, before any whole read', () => {
  it('only exact titles; a numbered one not held waits for a second frame', () => {
    const reading = frame(['Спецзаказ', 'Спецзака', 'Каратель. Часть 2', 'Каратель'], 0)
    expect(exactTableRows(reading, QUESTS, {})).toEqual([
      { questId: 'q1', score: 1, status: 'active' },
      { questId: 'k2', score: 0.99 },
    ])
  })

  it('a numbered one held already passes', () => {
    const records: Record<string, TaskProgressRecord> = { k2: { taskId: 'k2', status: 'active', source: 'eft-log', updatedAt: 'x' } }
    expect(exactTableRows(frame(['Каратель. Часть 2'], 0), QUESTS, records)).toEqual([{ questId: 'k2', score: 1, status: 'active' }])
  })
})
