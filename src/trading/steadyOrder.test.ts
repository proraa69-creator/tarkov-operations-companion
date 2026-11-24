import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { inOrder, orderOf, useSteadyOrder } from './steadyOrder'

const id = (value: string) => value
const held = (rows: string[], hold: string | null) => renderHook((props: { rows: string[]; hold: string | null }) => useSteadyOrder(props.rows, id, props.hold), { initialProps: { rows, hold } })

describe('the list does not move under the player\'s hand', () => {
  it('takes every new order while nothing is open', () => {
    const { result, rerender } = held(['a', 'b'], null)
    expect(result.current).toEqual(['a', 'b'])
    rerender({ rows: ['b', 'a'], hold: null })
    expect(result.current).toEqual(['b', 'a'])
  })

  it('keeps the order while an item is open, and takes the new one when it closes', () => {
    const { result, rerender } = held(['a', 'b', 'c'], null)
    rerender({ rows: ['a', 'b', 'c'], hold: 'open' })
    rerender({ rows: ['c', 'a', 'b'], hold: 'open' })
    expect(result.current).toEqual(['a', 'b', 'c'])
    rerender({ rows: ['c', 'a', 'b'], hold: null })
    expect(result.current).toEqual(['c', 'a', 'b'])
  })

  it('another sorting clicked with an item open takes effect at once', () => {
    const { result, rerender } = held(['a', 'b'], 'by-low')
    rerender({ rows: ['b', 'a'], hold: 'by-high' })
    expect(result.current).toEqual(['b', 'a'])
    rerender({ rows: ['a', 'b'], hold: 'by-high' })
    expect(result.current).toEqual(['b', 'a'])
  })

  it('an item opened from a link before the rows came: holds from when they come', () => {
    const { result, rerender } = held([], 'open')
    expect(result.current).toEqual([])
    rerender({ rows: ['a', 'b'], hold: 'open' })
    expect(result.current).toEqual(['a', 'b'])
    rerender({ rows: ['b', 'a'], hold: 'open' })
    expect(result.current).toEqual(['a', 'b'])
  })

  it('a row that was not there goes to the end, one that left is gone', () => {
    const order = orderOf(['a', 'b', 'c'], id)
    expect(inOrder(['new', 'c', 'a'], id, order)).toEqual(['a', 'c', 'new'])
  })
})
