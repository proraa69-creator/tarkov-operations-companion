/**
 * The hideout modules' pictures on «Что собрать для убежища» (owner, 28.10.2026: «картинки модулей… сделай их цветными…
 * по теме: биткоин жёлтым, самогонный аппарат синеватый мутный, аварийная стена кирпичная, тренажёрный зал цвет
 * пошарканной гантели, обогрев цвет огня»): the game's station icons (assets.tarkov.dev station-<name>.png), painted in
 * each module's colour and texture, 128 px, by tarkov.dev's normalizedName. A module without one keeps the catalog's.
 */
const files = import.meta.glob<string>('../assets/hideout-stations/*.webp', { eager: true, import: 'default' })

const byName = new Map(Object.entries(files).map(([path, url]) => [path.split('/').pop()!.replace(/\.webp$/, ''), url]))

export function stationIcon(station: { normalizedName?: string; imageUrl?: string }) {
  return (station.normalizedName && byName.get(station.normalizedName)) || station.imageUrl
}
