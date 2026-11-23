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
  /** A first focal plane reticle drawn at the highest magnification (thinner lines) and the angle it covers, mrad. */
  reticleMax?: string
  reticleMaxMrad?: number
  /**
   * The step of the marks below the reticle's centre, as the game draws them (its reticles are not always true to the real
   * ones), mrad: on `reticle` at `zoom`, on `reticleMax` (E:\SPT-photo\range-assets\tools\mark_steps.py). Absent: no regular marks.
   */
  markMrad?: number
  markMaxMrad?: number
  /** How wide those marks are across, mrad, on `reticle` and `reticleMax` (the hold bar is drawn a little wider, mark_steps.py). */
  tickMrad?: number
  tickMaxMrad?: number
  /** The middle of the reticle is red: the hold mark is drawn black on it, red on any other (owner, 23.11.2026). */
  reticleRed?: boolean
  /** A night vision or thermal scope. */
  night?: boolean
  thermal?: boolean
}

/** The reticle picture for a magnification and the angle it covers: a first focal plane one's high-zoom picture past the middle. */
export function reticleAt(mode: ScopeMode, zoom: number): { file?: string; mrad?: number } {
  if (mode.ffp && mode.reticleMax && mode.reticleMaxMrad && mode.zoomMax && zoom >= Math.sqrt(mode.zoom * mode.zoomMax)) return { file: mode.reticleMax, mrad: mode.reticleMaxMrad }
  return { file: mode.reticle, mrad: mode.reticleMrad }
}

/**
 * The angle between two marks of the reticle seen at this magnification, mrad: a first focal plane reticle keeps its angles, a
 * second focal plane one keeps its size on the screen, so its marks cover less as the magnification grows.
 */
export function markStepAt(mode: ScopeMode, zoom: number): number | undefined {
  const picture = reticleAt(mode, zoom)
  const step = picture.file && picture.file === mode.reticleMax ? mode.markMaxMrad : mode.markMrad
  if (!step) return undefined
  return mode.ffp ? step : step * (mode.zoom / zoom)
}

/** How wide the reticle's marks are across at this magnification, mrad, as `markStepAt` counts their step. */
export function tickAt(mode: ScopeMode, zoom: number): number | undefined {
  const picture = reticleAt(mode, zoom)
  const width = picture.file && picture.file === mode.reticleMax ? mode.tickMaxMrad : mode.tickMrad
  if (!width) return undefined
  return mode.ffp ? width : width * (mode.zoom / zoom)
}

/**
 * The hold bar's half width at the target, cm (owner, 23.11.2026: «полоску… сделать меньше намного… практически размером с сетку,
 * чуть-чуть больше, чтобы она была немного шире самой сетки рисок и чуть-чуть толще»): a quarter wider than the reticle's marks, or
 * 2.4 % of the view where their width is not known; never under 1.4 % of the view nor over 4 %.
 */
export function holdBarHalfCm(fovCm: number, distance: number, tickMrad?: number): number {
  const wanted = tickMrad ? mradToCm(tickMrad, distance) * 1.25 : fovCm * 0.024
  return Math.min(fovCm * 0.04, Math.max(fovCm * 0.014, wanted)) / 2
}

export interface ScopeData {
  id: string
  ru: string
  en: string
  modes: ScopeMode[]
  /** The zeroing distances the scope can be set to (the game's CalibrationDistances), metres. */
  zeros?: number[]
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

/** The hold for a distance from the bullet's drop against the sight line (zeroed at the scope's zero); `markStepMrad` counts marks. */
export function holdover(dropCm: number, distance: number, markStepMrad?: number): Holdover {
  const mrad = cmToMrad(-dropCm, distance)
  const moa = mradToMoa(mrad)
  const marks = markStepMrad ? mrad / markStepMrad : undefined
  return { dropCm, mrad, moa, ...(marks !== undefined ? { marks } : {}) }
}

/** The distances of the drop table (owner, 23.11.2026: «Напиши, на сколько … падает пуля на каждой дистанции»). */
export const DROP_TABLE_DISTANCES = [50, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000]
