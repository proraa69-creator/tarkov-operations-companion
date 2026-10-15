import { useMemo } from 'react'
import type { Item } from '../domain/types'

/** The catalog's items by id for the pictures of «Сбор на рейд» and the gear sections (src/overview/QuestConditionsCard.tsx). */
export interface Pictures {
  items: Map<string, Item>
  /** A catalog icon address to derive another item's icon from (the server's own image folder or tarkov.dev). */
  iconBase?: string
}

/** The catalog's pictures by item id, made once per catalog. */
export function usePictures(items: Item[]): Pictures {
  return useMemo<Pictures>(() => ({
    items: new Map(items.map((item) => [item.id, item])),
    iconBase: items.map((item) => item.iconUrl).find((url): url is string => Boolean(url && /\/[0-9a-f]{24}-icon\.webp$/.test(url))),
  }), [items])
}
