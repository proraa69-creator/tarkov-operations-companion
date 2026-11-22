/**
 * Scopes at the range (owner, 22.11.2026: «баллистику прицела… все прицелы, которые есть в игре, можно выбрать прицел. У нас
 * появится прицельная сетка… понятно, на сколько моа или сколько рисок нужно поднять или опустить прицел в зависимости от
 * дистанции… выставить до цели 600 метров… персонаж стоит на дистанции 600 метров»): the target seen through the scope at its
 * real angular size, the reticle at the scope's own scale, and the hold or the turret clicks the bullet's drop asks for.
 *
 * Angles: 1 mrad is 0.1 cm per metre of distance; 1 MOA is 2.9089 cm at 100 m.
 */
export interface ScopeMode {
  /** Magnification of this mode (the lowest of a variable scope's range). */
  zoom: number
  /** The largest magnification of a variable mode. */
  zoomMax?: number
  /** The field of view through the scope at `zoom`, degrees (the game's optic camera). */
  fovDeg: number
  /** The reticle picture (in the range's pack) and the angle its full width covers at `zoom`, mrad. */
  reticle?: string
  reticleMrad?: number
  /** First focal plane: the reticle keeps its angular size at every magnification. */
  ffp?: boolean
}

export interface ScopeData {
  id: string
  ru: string
  en: string
  modes: ScopeMode[]
  /** The zeroing distances the scope can be set to (the game's CalibrationDistances), metres. */
  zeros?: number[]
  /** What one reticle mark or one click stands for, when known. */
  unit?: 'mrad' | 'moa'
  /** The angle between the reticle's marks, in `unit`. */
  markStep?: number
}

export const CM_PER_MOA_100M = 2.9089

/** Centimetres at a distance → mrad. */
export const cmToMrad = (cm: number, distance: number) => cm / (0.1 * distance)
/** mrad at a distance → centimetres. */
export const mradToCm = (mrad: number, distance: number) => mrad * 0.1 * distance
export const mradToMoa = (mrad: number) => mrad * 3.43775
/** The scope's field of view in mrad. */
export const fovMrad = (fovDeg: number) => 2 * Math.tan((fovDeg * Math.PI) / 360) * 1000

export interface Holdover {
  /** The bullet against the line of sight at the target, cm (negative: below). */
  dropCm: number
  /** How far to hold or dial up (positive) or down, mrad and MOA. */
  mrad: number
  moa: number
  /** In the reticle's marks, when its step is known. */
  marks?: number
}

/** The hold for a distance from the bullet's drop against the sight line (zeroed at the scope's zero). */
export function holdover(dropCm: number, distance: number, scope?: Pick<ScopeData, 'unit' | 'markStep'>): Holdover {
  const mrad = cmToMrad(-dropCm, distance)
  const moa = mradToMoa(mrad)
  const marks = scope?.markStep ? (scope.unit === 'moa' ? moa : mrad) / scope.markStep : undefined
  return { dropCm, mrad, moa, ...(marks !== undefined ? { marks } : {}) }
}
