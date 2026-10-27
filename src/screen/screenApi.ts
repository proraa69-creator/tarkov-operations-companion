import type { ScreenProfile } from './screenCurve'

/** What the main process tells the «Настройка экрана» page (electron/screenTuning/index.ts). */
export interface ScreenTuningView {
  settings: { presets: ScreenProfile[]; activeId: string; enabled: boolean; display: string; builtIns: Record<string, { name?: string; hidden?: boolean; profile?: ScreenProfile }> }
  /** Ours first (renamed, without the ones taken off the list), then the player's. */
  presets: ScreenProfile[]
  status: ScreenTuningStatus
  /** The last picture of the game the app has (taken while the game was shown). */
  frame: { at: number; source: 'game' | 'screenshot' } | null
}

export interface ScreenTuningStatus {
  /** The monitors' gamma can be changed (Windows). */
  available: boolean
  /** The game's window is on a monitor and not covered: the preset is on only then. */
  gameShown: boolean
  /** The monitor the game is on («\\.\DISPLAY2»), '' when it is not shown. */
  gameDisplay: string
  /** Every monitor of the desktop. */
  displays: string[]
  /** The game is in exclusive full screen: it may put its own gamma back. */
  exclusive: boolean
  /** On the screen now: how many monitors, and the share of the preset Windows let through (1 = all of it). */
  applied: { displays: number; strength: number } | null
  /** The curve being edited is what the game shows now. */
  editing: boolean
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
  update: (patch: Partial<Pick<ScreenTuningView['settings'], 'activeId' | 'enabled' | 'display'>>) => Promise<ScreenTuningView>
  savePreset: (preset: ScreenProfile) => Promise<ScreenTuningView & { savedId: string }>
  renamePreset: (id: string, name: string) => Promise<ScreenTuningView>
  /** The player's own is deleted, one of ours taken off the list. */
  deletePreset: (id: string) => Promise<ScreenTuningView>
  /** Our presets back on the list under their own names. */
  restorePresets: () => Promise<ScreenTuningView>
  /** One of ours as it came with the app (after the player tuned or renamed it). */
  revertPreset: (id: string) => Promise<ScreenTuningView>
  /** The curve being edited, live in the game in place of the chosen preset for a few minutes (null: stop). */
  edit: (profile: ScreenProfile | null) => Promise<ScreenTuningStatus>
  frame: (kind: 'game' | 'last' | 'screenshot') => Promise<ScreenFrame | null>
  optimizeStatus: () => Promise<OptimizeStatus>
  optimize: () => Promise<{ done: string[]; skipped: string[]; status: OptimizeStatus }>
  revertOptimize: () => Promise<{ done: string[]; status: OptimizeStatus }>
}

export const screenApi = (): ScreenTuningApi | undefined => window.tarkovDesktop?.screen

