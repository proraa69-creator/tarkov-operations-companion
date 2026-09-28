/**
 * «Документы боевого пропуска» spawn points, in game coordinates (x, z, optional height y) per app map id.
 *
 * The list has to be synchronised with the community map (https://mapgenie.io/tarkov/maps/<map>) — it is
 * copied there by hand or by a build-time import, never scraped at runtime. Until a map is imported here
 * it simply has no documents on the map.
 */
export interface BattlePassDocumentPoint { x: number; z: number; y?: number; note?: string }

export const BATTLE_PASS_DOCUMENTS: Record<string, BattlePassDocumentPoint[]> = {}
