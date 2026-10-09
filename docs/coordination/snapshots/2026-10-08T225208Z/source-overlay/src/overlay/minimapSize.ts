export const DEFAULT_MINIMAP_WIDTH = 420
export function minimapWidth(value: unknown) {
  if (value == null || value === '') return DEFAULT_MINIMAP_WIDTH
  const width = Number(value)
  return Number.isFinite(width) ? Math.round(Math.min(720, Math.max(280, width))) : DEFAULT_MINIMAP_WIDTH
}
