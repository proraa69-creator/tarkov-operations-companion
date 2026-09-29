/**
 * The owner's boss 3D models (src/assets/boss-models, Tripo exports with 1024 WebP textures) and per-model
 * corrections shared by every viewer (the Gallery, and the Overview figures if they go 3D).
 * Vite only emits the files and hands back their URLs here; a model is downloaded when a viewer opens it.
 */
const urls = import.meta.glob<string>('../assets/boss-models/*.glb', { eager: true, query: '?url', import: 'default' })
const byKey = new Map(Object.entries(urls).map(([path, url]) => [path.replace(/^.*\/|\.glb$/g, ''), url]))

/** Pose corrections applied about the model's feet. rollDeg turns around the view axis (Z), + = counter-clockwise. */
export interface BossModelFix { rollDeg?: number }

export const BOSS_MODEL_FIX: Record<string, BossModelFix> = {
  // The export leans ~9.3° to +x (feet→head dx≈0.146 over dy≈0.9); this stands him upright.
  partisan: { rollDeg: 9.3 },
}

/**
 * Colour grade for live 3D boss views: the Tripo textures come out pale, so the views are made a touch richer
 * and darker in CSS. The same grade is baked into the stills (sharp modulate in scripts/bosses/render-figures.mjs).
 */
export const BOSS_GRADE_CSS = 'saturate(1.22) brightness(0.9)'

export function bossModelUrl(key: string): string | undefined {
  return byKey.get(key)
}
