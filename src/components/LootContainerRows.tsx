import { useMemo } from 'react'
import { LOOT_CONTAINER_PICTURES } from '../assets/containerMarkers'
import { LOOT_CONTAINER_KINDS, lootContainerKindOf, type LootContainerKind } from '../data/lootContainerKinds'
import type { MapMarker } from '../domain/types'
import { useLocale } from '../i18n/LocaleProvider'

/**
 * Under «Контейнеры/тайники»: each kind on this map with its picture and how many there are. With the layer off a click shows
 * that kind alone, with it on a click turns the kind on or off; turning the last one off turns the layer off.
 */
export function LootContainerRows({ markers, layerVisible, hidden, onChange }: {
  markers: readonly MapMarker[]
  layerVisible: boolean
  hidden: readonly string[]
  /** The kinds now hidden, and whether the layer is on. */
  onChange: (hidden: LootContainerKind[], layerVisible: boolean) => void
}) {
  const { locale } = useLocale()
  const rows = useMemo(() => {
    const counts = new Map<LootContainerKind, number>()
    for (const marker of markers) {
      const kind = lootContainerKindOf(marker)
      if (kind) counts.set(kind, (counts.get(kind) ?? 0) + 1)
    }
    return LOOT_CONTAINER_KINDS.flatMap((entry) => counts.has(entry.kind) ? [{ ...entry, count: counts.get(entry.kind)! }] : [])
  }, [markers])
  const click = (kind: LootContainerKind) => {
    const all = rows.map((row) => row.kind)
    if (!layerVisible) return onChange(LOOT_CONTAINER_KINDS.map((entry) => entry.kind).filter((other) => other !== kind), true)
    const next = hidden.includes(kind) ? (hidden as LootContainerKind[]).filter((other) => other !== kind) : [...hidden as LootContainerKind[], kind]
    if (all.every((other) => next.includes(other))) return onChange([], false)
    onChange(next, true)
  }
  return <div className="layer-kinds">
    {rows.map((row) => <button key={row.kind} type="button" className={`layer-button is-kind ${layerVisible && !hidden.includes(row.kind) ? 'active' : ''}`} onClick={() => click(row.kind)}>
      <img className="layer-icon" src={LOOT_CONTAINER_PICTURES[row.kind]} alt="" />
      <span>{locale === 'en' ? row.en : row.ru}</span>
      <small>{row.count}</small>
    </button>)}
  </div>
}
