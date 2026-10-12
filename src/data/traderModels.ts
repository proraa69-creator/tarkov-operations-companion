/**
 * The owner's trader 3D models (src/assets/trader-models, Tripo exports packed like the bosses: 1024 px WebP textures),
 * by tarkov.dev's normalized trader name. The Traders page shows the selected trader's figure above his quests
 * (owner, 11.10.2026: «добавь 3д модели всех торговцев… при включении каждого торговца меняется фигурка»). Vite only
 * emits the files; a model is downloaded when the page shows it. Every model is a whole scene (desks, crates, a dog),
 * so the viewer fits it in view (BossModelFix.fit).
 */
import type { BossModelFix } from './bossModels'

const urls = import.meta.glob<string>('../assets/trader-models/*.glb', { eager: true, query: '?url', import: 'default' })
const byKey = new Map(Object.entries(urls).map(([path, url]) => [path.replace(/^.*\/|\.glb$/g, ''), url]))

/** Russian names of the traders that have a model (the catalog's normalized names can be missing offline). */
const BY_NAME: Record<string, string> = {
  'Прапор': 'prapor', 'Терапевт': 'therapist', 'Скупщик': 'fence', 'Миротворец': 'peacekeeper', 'Механик': 'mechanic',
  'Егерь': 'jaeger', 'Реф': 'ref', 'Водитель БТР': 'btr-driver', 'Лыжник': 'skier', 'Барахольщик': 'ragman', 'Смотритель': 'lightkeeper',
}

const TRADER_MODEL_FIX: BossModelFix = { fit: true }
/** Fence stands in black haze (owner, 12.10.2026: «сделать 3д модель скупщика черной… как будто дымка черная»). */
const TRADER_MODEL_FIXES: Record<string, BossModelFix> = { fence: { ...TRADER_MODEL_FIX, haze: 0.85 } }

/** How the viewer shows a trader's model: every scene fits in view; some get their own look. */
export function traderModelFix(key: string): BossModelFix {
  return TRADER_MODEL_FIXES[key] ?? TRADER_MODEL_FIX
}

/** The model key of a trader (normalized name, else by his Russian name), when there is a model for him. */
export function traderModelKey(trader: { normalizedName?: string; name: string }): string | undefined {
  const key = trader.normalizedName && byKey.has(trader.normalizedName) ? trader.normalizedName : BY_NAME[trader.name.trim()]
  return key && byKey.has(key) ? key : undefined
}

export function traderModelUrl(key: string): string | undefined {
  return byKey.get(key)
}
