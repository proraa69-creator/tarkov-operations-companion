import { randomBytes } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/**
 * Bosses the owner placed on the maps by hand (owner app → «Карты» → «Расставить боссов»). Shared by every player:
 * the app lays them over the automatic boss markers (an owner-placed boss replaces the automatic markers of the same
 * boss on that map). Positions are game metres (x / z), the same as the map markers of the catalog.
 */
export interface MapBossPlacement {
  id: string
  mapId: string
  bossKey: string
  bossName: string
  x: number
  z: number
  /** Map floor (layer name) when placed on an upper / lower level; absent on the main level. */
  floor?: string
  createdAt: string
}

export type NewMapBossPlacement = Omit<MapBossPlacement, 'id' | 'createdAt'>

/** Enough for every boss on every map several times over; protects the table from a runaway client. */
export const MAX_MAP_BOSS_PLACEMENTS = 1000

interface Row { id: string; map_id: string; boss_key: string; boss_name: string; x: number; z: number; floor: string | null; created_at: string }

export class MapBossStore {
  constructor(private readonly db: DatabaseSync, private readonly now: () => number = Date.now) {
    db.exec(`CREATE TABLE IF NOT EXISTS map_boss_placements (
        id TEXT PRIMARY KEY,
        map_id TEXT NOT NULL,
        boss_key TEXT NOT NULL,
        boss_name TEXT NOT NULL,
        x REAL NOT NULL,
        z REAL NOT NULL,
        floor TEXT,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS map_boss_placements_map ON map_boss_placements(map_id, boss_key);`)
  }

  list(): MapBossPlacement[] {
    const rows = this.db.prepare('SELECT * FROM map_boss_placements ORDER BY created_at, id').all() as unknown as Row[]
    return rows.map(toPlacement)
  }

  /** Undefined when the table is full. */
  add(placement: NewMapBossPlacement, actor: string): MapBossPlacement | undefined {
    const count = Number((this.db.prepare('SELECT COUNT(*) AS n FROM map_boss_placements').get() as { n: number }).n)
    if (count >= MAX_MAP_BOSS_PLACEMENTS) return undefined
    const row: Row = {
      id: randomBytes(12).toString('hex'),
      map_id: placement.mapId,
      boss_key: placement.bossKey,
      boss_name: placement.bossName,
      x: placement.x,
      z: placement.z,
      floor: placement.floor ?? null,
      created_at: new Date(this.now()).toISOString(),
    }
    this.db.prepare('INSERT INTO map_boss_placements (id, map_id, boss_key, boss_name, x, z, floor, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(row.id, row.map_id, row.boss_key, row.boss_name, row.x, row.z, row.floor, row.created_at, actor)
    return toPlacement(row)
  }

  /** The removed placement, or undefined when there was none. */
  remove(id: string): MapBossPlacement | undefined {
    const row = this.db.prepare('SELECT * FROM map_boss_placements WHERE id = ?').get(id) as unknown as Row | undefined
    if (!row) return undefined
    this.db.prepare('DELETE FROM map_boss_placements WHERE id = ?').run(id)
    return toPlacement(row)
  }
}

function toPlacement(row: Row): MapBossPlacement {
  return {
    id: row.id,
    mapId: row.map_id,
    bossKey: row.boss_key,
    bossName: row.boss_name,
    x: Number(row.x),
    z: Number(row.z),
    ...(row.floor ? { floor: row.floor } : {}),
    createdAt: row.created_at,
  }
}
