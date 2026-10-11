import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ID = /^[a-z0-9-]{8,80}$/

/** Active verified image generation, or the legacy directory during the first migration pass. */
export function activeItemImageDirectory(root: string) {
  try {
    const active = JSON.parse(readFileSync(join(root, 'active.json'), 'utf8')) as { version?: unknown; current?: unknown }
    if (active.version === 1 && typeof active.current === 'string' && ID.test(active.current)) {
      const directory = join(root, 'generations', active.current)
      if (existsSync(join(directory, 'manifest.json'))) return directory
    }
  } catch { /* legacy layout */ }
  return root
}
