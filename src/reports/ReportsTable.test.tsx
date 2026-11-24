import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReportsTable, type ReportPage, type ReportRow } from './ReportsTable'

const row = (extra: Partial<ReportRow> = {}): ReportRow => ({
  id: 100, kind: 'bug', topic: 'Нет квеста Новое начало', description: 'Не нашёл в списке', createdAt: '2026-11-08T04:00:00Z', files: 0,
  email: 'player@example.com', work: { status: 'taken' }, ...extra,
})
const page = (rows: ReportRow[]): ReportPage => ({ rows, total: rows.length, counts: { active: 0, working: rows.length, closed: 0, awaiting: 0 } })

afterEach(cleanup)

describe('«Готово» asks «Выдать 2 дня?» (owner, 08.11.2026; 2 days since 24.11.2026)', () => {
  const setup = (rows = [row()]) => {
    const onAct = vi.fn(async () => undefined)
    const onReward = vi.fn(async () => undefined)
    render(<ReportsTable page={page(rows)} view="working" onView={() => {}} onAct={onAct} onReward={onReward} />)
    return { onAct, onReward }
  }

  it('«Да»: the report closes and its author gets one day', async () => {
    const { onAct, onReward } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    expect(onAct).not.toHaveBeenCalled()
    const dialog = screen.getByRole('alertdialog', { name: 'Выдать 2 дня?' })
    expect(dialog).toHaveTextContent('№100 · Нет квеста Новое начало')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Да' })) })
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
    expect(onReward).toHaveBeenCalledWith(100, 2)
    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('«Нет»: only closes it; Escape changes nothing', async () => {
    const { onAct, onReward } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onAct).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }))
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Нет' })) })
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
    expect(onReward).not.toHaveBeenCalled()
  })

  it('no author to reward (the account is gone): «Готово» closes at once', async () => {
    const { onAct } = setup([row({ email: undefined })])
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Готово' })) })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(onAct).toHaveBeenCalledWith(100, 'implemented')
  })
})

describe('«Выдать дни» in the row itself (owner, 18.11.2026)', () => {
  it('the number typed and «Выдать» give those days without «Подробнее»; the row says it at once, with the date', async () => {
    const onReward = vi.fn(async () => undefined)
    render(<ReportsTable page={page([row()])} view="working" onView={() => {}} onAct={vi.fn(async () => undefined)} onReward={onReward} />)
    expect(screen.getByText('Дни не выдавались')).toBeInTheDocument()
    // «Готово» and «Вернуть в активные» stand in the row too
    expect(screen.getByRole('button', { name: 'Готово' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Вернуть в активные' })).toBeInTheDocument()
    const give = screen.getByRole('button', { name: 'Выдать' })
    expect(give).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Сколько дней выдать' }), { target: { value: '3д' } })
    expect(screen.getByRole('textbox', { name: 'Сколько дней выдать' })).toHaveValue('3')
    await act(async () => { fireEvent.click(give) })
    expect(onReward).toHaveBeenCalledWith(100, 3)
    expect(screen.getByText(/Выдано дней: 3 · \d\d\.\d\d\.\d\d/)).toBeInTheDocument()
    expect(screen.queryByText('Дни не выдавались')).toBeNull()
  })

  it('days given before: how many and when; no author: no grant at all', () => {
    render(<ReportsTable page={page([row({ rewardDays: 2, rewardedAt: '2026-11-17T10:00:00Z' }), row({ id: 101, email: undefined })])} view="working" onView={() => {}} onAct={vi.fn(async () => undefined)} onReward={vi.fn(async () => undefined)} />)
    expect(screen.getByText('Выдано дней: 2 · 17.11.26')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Выдать' })).toHaveLength(1)
  })

  it('a refusal of the server shows on the row and gives nothing', async () => {
    const onReward = vi.fn(async () => { throw new Error('Аккаунт не найден') })
    render(<ReportsTable page={page([row()])} view="working" onView={() => {}} onAct={vi.fn(async () => undefined)} onReward={onReward} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Сколько дней выдать' }), { target: { value: '5' } })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Выдать' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Аккаунт не найден')
    expect(screen.getByText('Дни не выдавались')).toBeInTheDocument()
  })
})

describe('«Принять точку» (owner, 10.11.2026: «Добавить точку»)', () => {
  const pointRow = (extra: Partial<ReportRow> = {}) => row({
    kind: 'idea', topic: 'Точка: Рубильник — У ворот', description: '', work: { status: 'review' },
    suggest: { icon: 'switch', name: 'У ворот', mapId: 'customs', x: -181.4, y: 3.3, z: -77.1 }, ...extra,
  })

  it('shows the proposed point and accepts it with one press', async () => {
    const onAccept = vi.fn(async () => undefined)
    render(<ReportsTable page={page([pointRow()])} view="active" onView={() => {}} onAct={vi.fn(async () => undefined)} onAcceptPoint={onAccept} />)
    expect(screen.getByText('Рубильник — У ворот')).toBeInTheDocument()
    expect(screen.getByText('customs · x -181, z -77')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Принять точку' })) })
    expect(onAccept).toHaveBeenCalledWith(100)
  })

  it('an accepted point says so and has no button; the server refusal is shown on the row', async () => {
    render(<ReportsTable page={page([pointRow({ id: 101, work: { status: 'implemented' }, suggest: { icon: 'switch', name: 'У ворот', mapId: 'customs', x: 1, z: 2, pointId: 'p1' } })])} view="closed" onView={() => {}} onAct={vi.fn(async () => undefined)} onAcceptPoint={vi.fn(async () => undefined)} />)
    expect(screen.getByText('Точка принята')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Принять точку' })).toBeNull()
    cleanup()
    const refused = vi.fn(async () => { throw new Error('Такая точка уже есть на карте') })
    render(<ReportsTable page={page([pointRow()])} view="active" onView={() => {}} onAct={vi.fn(async () => undefined)} onAcceptPoint={refused} />)
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Принять точку' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('Такая точка уже есть на карте')
  })
})

// owner, 25.11.2026: «ошибки и предложения должны быть разные кнопки. „Взял в работу“ должно быть у всех. По ошибкам кнопка „Разъяснить“»
describe('a bug and an idea have their own buttons', () => {
  const names = (title: string) => Array.from(screen.getByText(title).closest('tr')!.querySelectorAll('.rt-actions button')).map((button) => button.textContent)

  it('active: «Взял в работу» for both, a bug «Разъяснить», an idea «Уже реализовано», both «Отклонить»; in the work a bug can still be explained', () => {
    render(<ReportsTable page={page([
      row({ id: 1, topic: 'Ошибка', work: { status: 'review' } }), row({ id: 2, kind: 'idea', topic: 'Идея', work: { status: 'review' } }),
      row({ id: 3, topic: 'Ошибка в работе' }), row({ id: 4, kind: 'idea', topic: 'Идея в работе' }),
      row({ id: 5, topic: 'Разъяснена', work: { status: 'explained' } }),
    ])} view="active" onView={() => {}} onAct={vi.fn()} />)
    expect(names('Ошибка')).toEqual(['Взял в работу', 'Разъяснить', 'Отклонить'])
    expect(names('Идея')).toEqual(['Взял в работу', 'Уже реализовано', 'Отклонить'])
    expect(names('Ошибка в работе')).toEqual(['Готово', 'Разъяснить', 'Вернуть в активные'])
    expect(names('Идея в работе')).toEqual(['Готово', 'Вернуть в активные'])
    expect(names('Разъяснена')).toEqual(['Вернуть в активные'])
    expect(screen.getByText('Разъяснено')).toBeInTheDocument()
  })

  it('«Разъяснить» opens the answer once the server has closed the bug; a refusal or a deleted account opens nothing', async () => {
    const onExplain = vi.fn()
    const onAct = vi.fn(async () => undefined).mockRejectedValueOnce(new Error('Отчёт №1 уже в другом статусе: обновите таблицу'))
    const bug = row({ id: 1, accountId: 'a'.repeat(24), work: { status: 'review' } })
    render(<ReportsTable page={page([bug, row({ id: 2, topic: 'Без аккаунта', email: undefined, work: { status: 'review' } })])} view="active" onView={() => {}} onAct={onAct} onExplain={onExplain} />)
    const press = (title: string) => fireEvent.click(Array.from(screen.getByText(title).closest('tr')!.querySelectorAll('button')).find((button) => button.textContent === 'Разъяснить')!)
    await act(async () => { press('Нет квеста Новое начало') })
    expect(onExplain).not.toHaveBeenCalled()
    await act(async () => { press('Нет квеста Новое начало') })
    expect(onAct).toHaveBeenLastCalledWith(1, 'explain')
    expect(onExplain).toHaveBeenCalledWith(bug)
    await act(async () => { press('Без аккаунта') })
    expect(onAct).toHaveBeenLastCalledWith(2, 'explain')
    expect(onExplain).toHaveBeenCalledTimes(1)
  })
})
