import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LevelAnchor } from '../domain/types'
import { setRenderLanguage } from '../i18n/renderText'
import { PlayerLoadoutSummary } from './PlayerLoadoutSummary'

const screenLevel: LevelAnchor = { level: 24, observedAt: '2026-11-27T10:00:00.000Z', source: 'screen', checked: true }
const typedLevel: LevelAnchor = { level: 24, observedAt: '2026-11-27T10:00:00.000Z', source: 'manual' }
const field = () => screen.queryByRole('spinbutton', { name: 'Указать уровень' })

afterEach(() => setRenderLanguage('ru'))

/** Owner, 27.11.2026: «нижняя граница уровня по квестам и ручной ввод уровня» — the mode's card on «Профиль». */
describe('the level on the mode\'s card without a reading', () => {
  it('nothing known: the wait for the game, with «Указать уровень»', () => {
    render(<PlayerLoadoutSummary level={1} onLevelEntered={vi.fn()} />)
    expect(screen.getByText(/^Уровень появится, когда вы запустите игру/)).toBeInTheDocument()
    expect(field()).toHaveAttribute('placeholder', '1–79')
  })

  it('the quests\' estimate: «Уровень не ниже N», with the field', () => {
    render(<PlayerLoadoutSummary level={24} onLevelEntered={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Уровень не ниже 24' })).toBeInTheDocument()
    expect(screen.queryByText(/Уровень появится/)).toBeNull()
    expect(field()).toBeInTheDocument()
  })

  it('a reading of the game: the level alone, no field; the player\'s own entry keeps it, to correct it', () => {
    const { rerender } = render(<PlayerLoadoutSummary level={25} anchor={screenLevel} onLevelEntered={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Уровень 25' })).toBeInTheDocument()
    expect(field()).toBeNull()
    rerender(<PlayerLoadoutSummary level={25} anchor={typedLevel} onLevelEntered={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Уровень 25' })).toBeInTheDocument()
    expect(field()).toBeInTheDocument()
  })

  it('takes a whole level from 1 to 79 and empties the field', () => {
    const entered = vi.fn()
    render(<PlayerLoadoutSummary level={24} onLevelEntered={entered} />)
    const save = screen.getByRole('button', { name: 'Сохранить' })
    expect(save).toBeDisabled()
    for (const wrong of ['0', '80', '120']) {
      fireEvent.change(field()!, { target: { value: wrong } })
      expect(save).toBeDisabled()
    }
    fireEvent.change(field()!, { target: { value: '31' } })
    fireEvent.click(save)
    expect(entered).toHaveBeenCalledExactlyOnceWith(31)
    expect(field()).toHaveValue(null)
  })

  it('in English', () => {
    setRenderLanguage('en')
    render(<PlayerLoadoutSummary level={24} onLevelEntered={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'At least level 24' })).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Set level' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })
})
