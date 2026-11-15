import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import type { RaidMode } from '../domain/types'
import { uiText } from '../i18n/renderText'
import { setItemTaken, useTakenItems } from '../progression/takenItems'
import './takenItems.css'

/**
 * «Взял» on the Overview's items (report 157; progression/takenItems.ts): the right-click menus offer it, a taken item shows a
 * green check in its top right corner. Only inside the Overview (TakenItemsProvider); elsewhere nothing is offered or drawn.
 */
interface TakenItems { has: (itemId: string) => boolean; set: (itemId: string, taken: boolean) => void }

const TakenItemsContext = createContext<TakenItems | undefined>(undefined)

export function TakenItemsProvider({ profileId, mode, children }: { profileId: string; mode: RaidMode; children: ReactNode }) {
  const taken = useTakenItems(profileId, mode)
  const value = useMemo<TakenItems>(() => ({
    has: (itemId) => taken.has(itemId),
    set: (itemId, on) => setItemTaken(profileId, mode, itemId, on),
  }), [taken, profileId, mode])
  return <TakenItemsContext.Provider value={value}>{children}</TakenItemsContext.Provider>
}

export function useTakenItemsMarks() {
  return useContext(TakenItemsContext)
}

/** Whether this item is ticked «Взял» (false outside the Overview). */
export function useItemTaken(itemId: string | undefined) {
  const marks = useContext(TakenItemsContext)
  return Boolean(itemId && marks?.has(itemId))
}

/** The green check in the top right corner of a taken item's tile. */
export function TakenCheck() {
  const label = uiText('Взял')
  return <span className="item-taken-check" role="img" aria-label={label} title={label}><Check size={12} strokeWidth={3.5} aria-hidden="true" /></span>
}

/** The menu's entry: «Взял», or «Не взял» to take the mark back. Nothing outside the Overview. */
export function TakenMenuItem({ itemId, onDone }: { itemId?: string; onDone: () => void }) {
  const marks = useContext(TakenItemsContext)
  if (!marks || !itemId) return null
  const taken = marks.has(itemId)
  return <button type="button" role="menuitem" onClick={() => { onDone(); marks.set(itemId, !taken) }}>
    <Check size={13} aria-hidden="true" />{uiText(taken ? 'Не взял' : 'Взял')}
  </button>
}
