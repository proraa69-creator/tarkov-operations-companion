import { createContext, createElement, useContext, type ReactNode } from 'react'
import { useLocale } from '../i18n/LocaleProvider'
import { uiText } from '../i18n/renderText'
import type { BlockTitle } from './overviewDefaults'

/**
 * The owner's own heading of an Overview block («Админ панель» → «Блоки», overviewDefaults.ts), handed to the block's
 * component by the Overview. Elsewhere (the same component on another page) there is none and the built-in heading shows.
 */
const BlockTitleContext = createContext<BlockTitle | undefined>(undefined)

export function BlockTitleProvider({ title, children }: { title?: BlockTitle; children: ReactNode }) {
  return createElement(BlockTitleContext.Provider, { value: title }, children)
}

/** The heading of the block in the interface language: the owner's own, else `fallback` (Russian, translated). */
export function useBlockTitle(fallback: string) {
  const title = useContext(BlockTitleContext)
  const { locale } = useLocale()
  return title?.[locale]?.trim() || uiText(fallback)
}
