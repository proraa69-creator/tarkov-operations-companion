import originalUrl from '../../assets/gear/helmet.glb?url'
import steelUrl from '../../assets/gear/helmet-steel.glb?url'
import knightUrl from '../../assets/gear/helmet-knight.glb?url'

/** One helmet the player can pick for the Gear theme badge. `glass`: the model's roughness/metal texture carries a visor mask in its red channel. */
export interface HelmetVariant {
  id: string; label: string; url: string
  glass?: boolean
  /** The mesh has a _SWAY attribute (scripts/gear/rig-knight.mjs): hair and strings swing as the mask turns. */
  sway?: boolean
}

/** Add new helmets here (GLB in src/assets/gear/); the first one is the default. */
export const HELMETS: HelmetVariant[] = [
  // the owner's welding helmet as designed (Tripo export, textures downscaled to 1024² WebP)
  { id: 'original', label: 'Сварочная маска', url: originalUrl },
  // the owner's skull mask with dreadlocks (Tripo export, packed by scripts/gear/pack-helmet.mjs, swing weights by rig-knight.mjs)
  { id: 'knight', label: 'Рыцарь', url: knightUrl, sway: true },
  // scripts/gear/repaint-helmet.mjs: the owner's welding helmet, blackened scratched steel, cracked glass visor
  { id: 'steel', label: 'Сталь, царапины', url: steelUrl, glass: true },
]
