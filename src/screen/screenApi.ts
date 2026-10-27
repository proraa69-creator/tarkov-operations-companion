import type { ScreenProfile } from './screenCurve'

/** What the main process tells the «Настройка экрана» page (electron/screenTuning/index.ts). */
export interface ScreenTuningView {
  settings: { presets: ScreenProfile[]; activeId: string; enabled: boolean; when: 'game' | 'always' }
  /** Ours first, then the player's. */
  presets: ScreenProfile[]
  status: ScreenTuningStatus
  /** The last picture of the game the app has (taken while the game was in front). */
  frame: { at: number; source: 'game' | 'screenshot' } | null
}

export interface ScreenTuningStatus {
  /** The monitors' gamma can be changed (Windows). */
  available: boolean
  gameInFront: boolean
  /** The game is in exclusive full screen: it may put its own gamma back. */
  exclusive: boolean
  /** On the screen now: how many monitors, and the share of the preset Windows let through (1 = all of it). */
  applied: { displays: number; strength: number } | null
  trial: boolean
  /** NVIDIA «Цифровая интенсивность» now, %; null without NVIDIA. */
  vibrance: number | null
}

export interface ScreenFrame { dataUrl: string; at: number; source: 'game' | 'screenshot' }

export interface OptimizeStatus {
  windows: boolean
  onBattery: boolean
  power: { guid: string; name: string; isHigh: boolean; highAvailable: boolean } | null
  gameMode: boolean | null
  backgroundRecording: boolean | null
  gpuScheduling: boolean | null
  heavy: Array<{ label: string; why: string; memoryMb: number }>
  canRevert: boolean
}

export interface ScreenTuningApi {
  state: () => Promise<ScreenTuningView>
  update: (patch: Partial<Pick<ScreenTuningView['settings'], 'activeId' | 'enabled' | 'when'>>) => Promise<ScreenTuningView>
  savePreset: (preset: ScreenProfile) => Promise<ScreenTuningView & { savedId: string }>
  deletePreset: (id: string) => Promise<ScreenTuningView>
  /** Shows a profile on every monitor for a few minutes (null: stop). */
  tryProfile: (profile: ScreenProfile | null) => Promise<ScreenTuningStatus>
  frame: (kind: 'game' | 'last' | 'screenshot') => Promise<ScreenFrame | null>
  optimizeStatus: () => Promise<OptimizeStatus>
  optimize: () => Promise<{ done: string[]; skipped: string[]; status: OptimizeStatus }>
  revertOptimize: () => Promise<{ done: string[]; status: OptimizeStatus }>
}

export const screenApi = (): ScreenTuningApi | undefined => window.tarkovDesktop?.screen

/** In-game settings that cost the most frames in Tarkov; advice only, the app does not change the game's files. */
export const GAME_TIPS = [
  'В настройках игры включите «Автоочистку ОЗУ» и «Использовать только физические ядра», если процессор с гиперпоточностью и игра подтормаживает.',
  'Тени, объёмный свет и дальность прорисовки травы съедают больше всего кадров — уменьшайте их в первую очередь.',
  'Режим экрана «Безрамочный»: так работают и «Настройка экрана», и чтение предметов.',
  'Ограничьте частоту кадров в меню чуть ниже частоты монитора — игра идёт ровнее.',
]
