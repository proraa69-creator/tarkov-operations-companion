import steelUrl from '../../assets/gear/helmet-steel.glb?url'

/** One helmet the player can pick for the Gear theme badge. `glass`: the model's roughness/metal texture carries a visor mask in its red channel. */
export interface HelmetVariant { id: string; label: string; url: string; glass?: boolean }

/** Add new helmets here (GLB in src/assets/gear/); the first one is the default. */
export const HELMETS: HelmetVariant[] = [
  // scripts/gear/repaint-helmet.mjs: the owner's welding helmet, blackened scratched steel, cracked glass visor
  { id: 'steel', label: 'Сталь, царапины', url: steelUrl, glass: true },
]
