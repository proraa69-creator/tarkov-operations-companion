import { useMemo, useState } from 'react'

export interface HeldOrder { key: string; order: ReadonlyMap<string, number> }

export const orderOf = <T,>(rows: readonly T[], idOf: (row: T) => string): ReadonlyMap<string, number> => new Map(rows.map((row, at) => [idOf(row), at]))

/** The rows in a remembered order; one that was not there yet goes to the end. */
export function inOrder<T>(rows: readonly T[], idOf: (row: T) => string, order: ReadonlyMap<string, number>): T[] {
  const place = (row: T) => order.get(idOf(row)) ?? Number.POSITIVE_INFINITY
  return [...rows].sort((a, b) => {
    const left = place(a)
    const right = place(b)
    return left === right ? 0 : left < right ? -1 : 1
  })
}

/**
 * New prices reorder the lists, but not under the player's hand: while an item is open (its chart, its sums) the list keeps the
 * order it had, and takes the new one when it closes. `hold` names what the order is held for, null holds nothing; another name
 * (another sorting clicked with an item open) takes the new order at once.
 */
export function useSteadyOrder<T>(rows: readonly T[], idOf: (row: T) => string, hold: string | null): readonly T[] {
  const [held, setHeld] = useState<HeldOrder | null>(null)
  // Set while rendering, the way React has it for state that follows props: it renders again at once, nothing reaches the screen.
  const outdated = hold === null ? held !== null : held?.key !== hold || (held.order.size === 0 && rows.length > 0)
  if (outdated) setHeld(hold === null ? null : { key: hold, order: orderOf(rows, idOf) })
  return useMemo(() => hold !== null && held?.key === hold ? inOrder(rows, idOf, held.order) : rows, [held, hold, idOf, rows])
}
