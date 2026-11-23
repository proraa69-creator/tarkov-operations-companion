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
  /**
   * A red dot's ×1 in a magnified sight: HHS-1's EXPS3 with the G33 magnifier flipped aside, seen as a red dot through its housing;
   * the magnifier's ×3 is the sight's other mode (owner, 24.11.2026: «если на дальнем, ну, на увеличении, то как оптический прицел,
   * а если откидывается магнифер, то просто как обычный коллиматор должен выглядеть»).
   */
  collimator?: boolean
  /** A first focal plane reticle drawn at the highest magnification (thinner lines) and the angle it covers, mrad. */
  reticleMax?: string
  reticleMaxMrad?: number
  /**
   * A first focal plane reticle drawn on steps of magnification (×1.5 apart), each picture covering that step's whole view with the
   * lines as the game draws them there (owner, 24.11.2026: «где сетка в первой фокальной плоскости, а где во второй. Это должно
   * работать правильно»; E:\SPT-photo\range-assets\tools\export_reticles.py).
   */
  reticleSteps?: Array<{ zoom: number; file: string; mrad: number }>
  /**
   * The step of the marks below the reticle's centre, as the game draws them (its reticles are not always true to the real
   * ones), mrad: on `reticle` at `zoom`, on `reticleMax` (E:\SPT-photo\range-assets\tools\mark_steps.py). Absent: no regular marks.
   */
  markMrad?: number
  markMaxMrad?: number
  /** How wide the ordinary marks are across, mrad, on `reticle` and `reticleMax` (the hold bar is drawn a little wider, mark_steps.py). */
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
  // a first focal plane reticle: the step at or below the magnification — its picture covers the whole view, enlarged at most ×1.5
  if (mode.ffp && mode.reticleSteps?.length) {
    const step = mode.reticleSteps.reduce((best, entry) => entry.zoom <= zoom + 1e-6 ? entry : best, mode.reticleSteps[0]!)
    return { file: step.file, mrad: step.mrad }
  }
  if (maxPicture(mode, zoom)) return { file: mode.reticleMax, mrad: mode.reticleMaxMrad }
  return { file: mode.reticle, mrad: mode.reticleMrad }
}

/** Past the middle of a first focal plane scope's range its marks are read on the high-zoom picture (mark_steps.py). */
function maxPicture(mode: ScopeMode, zoom: number) {
  return Boolean(mode.ffp && mode.reticleMax && mode.reticleMaxMrad && mode.zoomMax && zoom >= Math.sqrt(mode.zoom * mode.zoomMax))
}

/**
 * The angle between two marks of the reticle seen at this magnification, mrad: a first focal plane reticle keeps its angles, a
 * second focal plane one keeps its size on the screen, so its marks cover less as the magnification grows.
 */
export function markStepAt(mode: ScopeMode, zoom: number): number | undefined {
  const step = maxPicture(mode, zoom) ? mode.markMaxMrad : mode.markMrad
  if (!step) return undefined
  return mode.ffp ? step : step * (mode.zoom / zoom)
}

/** How wide the reticle's marks are across at this magnification, mrad, as `markStepAt` counts their step. */
export function tickAt(mode: ScopeMode, zoom: number): number | undefined {
  const width = maxPicture(mode, zoom) ? mode.tickMaxMrad : mode.tickMrad
  if (!width) return undefined
  return mode.ffp ? width : width * (mode.zoom / zoom)
}

/**
 * The hold bar's half width at the target, cm (owner, 23.11.2026: «полоску… сделать меньше намного… практически размером с сетку,
 * чуть-чуть больше, чтобы она была немного шире самой сетки рисок и чуть-чуть толще»; 24.11.2026: «чуть больше, чем риска…
 * чуть-чуть шире и чуть-чуть длиннее. Но не такую огромную»): 30 % longer than the reticle's ordinary marks, or 1.8 % of the view
 * where they are not known; never under 1 % of the view nor over 3 %.
 */
export function holdBarHalfCm(fovCm: number, distance: number, tickMrad?: number): number {
  const wanted = tickMrad ? mradToCm(tickMrad, distance) * 1.3 : fovCm * 0.018
  return Math.min(fovCm * 0.03, Math.max(fovCm * 0.01, wanted)) / 2
}

export interface ScopeData {
  id: string
  ru: string
  en: string
  modes: ScopeMode[]
  /** The zeroing distances the scope can be set to (the game's CalibrationDistances), metres. */
  zeros?: number[]
  /**
   * A red dot (collimators.json): seen at ×1 through its own housing, the picture of it from the eye drawn at the mode's field of
   * view (E:\SPT-photo\range-assets\tools\collimators.py), its marks as the game's collimator shader draws them.
   */
  collimator?: boolean
  housing?: string
}

/**
 * The sight on the build: a magnified scope first (a red dot on top of an optic is its backup), then a red dot; one sight in both
 * lists (HHS-1: a red dot with a flip-to-side magnifier) is the red dot at ×1 and the scope's modes after it.
 */
export function sightOnBuild(partIds: readonly string[], scopes: readonly ScopeData[] | null, dots: readonly ScopeData[] | null): ScopeData | undefined {
  const find = (list: readonly ScopeData[] | null) => {
    const known = new Map((list ?? []).map((entry) => [entry.id, entry]))
    const id = partIds.find((entry) => known.has(entry))
    return id ? known.get(id) : undefined
  }
  const scope = find(scopes)
  const dot = scope ? dots?.find((entry) => entry.id === scope.id) : undefined
  if (scope && dot) return { ...scope, housing: dot.housing, modes: [...dot.modes.map((mode) => ({ ...mode, collimator: true })), ...scope.modes] }
  return scope ?? find(dots)
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
