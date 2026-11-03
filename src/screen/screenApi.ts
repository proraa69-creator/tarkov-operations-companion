import type { ScreenProfile } from './screenCurve'

/** What the main process tells the «Настройка экрана» page (electron/screenTuning/index.ts). */
export interface ScreenTuningView {
  settings: { presets: ScreenProfile[]; activeId: string; enabled: boolean; display: string; hotkey: string; cycleKey: string; builtIns: Record<string, { name?: string; hidden?: boolean; profile?: ScreenProfile }> }
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
  /** A raid now (the game's logs or its signs). */
  inRaid: boolean
  /** The chosen preset is on now: switched on and in a raid. */
  on: boolean
  /** Windows gave the app each chosen key (false: another program holds it). */
  keysOk: { hotkey: boolean; cycleKey: boolean }
  /** NVIDIA «Цифровая интенсивность» now, %; null without NVIDIA. */
  vibrance: number | null
}

/** 'own': a picture the player pasted or dropped onto «Настройка экрана» (src/screen/ownScreenshot.ts). */
export interface ScreenFrame { dataUrl: string; at: number; source: 'game' | 'screenshot' | 'own' }

/** «Ваш компьютер» (electron/screenTuning/pcInfo.ts). */
export interface PcInfo {
  cpu: { name: string; vendor: 'intel' | 'amd' | 'other'; cores: number; threads: number } | null
  gpus: Array<{ name: string; vendor: 'nvidia' | 'amd' | 'intel' | 'other'; driver: string; driverDate?: string; noDriver?: true }>
  ramGb: number | null
  ramMhz: { rated: number; running: number; locked?: true } | null
  board: string | null
  windows: { name: string; build: number } | null
  laptop: boolean
  pageFile: { automatic: boolean; files: Array<{ path: string; initialMb: number; maxMb: number }>; allocatedMb: number } | null
  game: { folder: string; drive: string; media: 'SSD' | 'HDD' | 'unknown' } | null
}

export type OptimizeItemId = 'power' | 'gameMode' | 'recording' | 'windowedGames' | 'gameGpu' | 'visualEffects' | 'pageFile' | 'gpuScheduling'

/** One line of «Обычная» / «Продвинутая» (electron/screenTuning/optimizer.ts OptimizeItem). */
export interface OptimizeItem {
  id: OptimizeItemId
  level: 'normal' | 'advanced'
  title: string
  why: string
  now: string
  done: boolean
  available: boolean
  reason?: string
  recommended: boolean
  admin?: true
  after?: 'restart' | 'signIn'
}

export type OptimizeOpenTarget = 'nvidia-app' | 'amd-software' | 'nvidia-driver' | 'amd-driver' | 'intel-driver'

/** What the player does himself: the video card's driver and app, XMP, an SSD. */
export interface OptimizeTip { id: string; title: string; text: string; steps?: string[]; open?: OptimizeOpenTarget; openLabel?: string }

export interface OptimizeStatus {
  windows: boolean
  onBattery: boolean
  power: { guid: string; name: string; isHigh: boolean; highAvailable: boolean } | null
  gameMode: boolean | null
  backgroundRecording: boolean | null
  gpuScheduling: boolean | null
  heavy: Array<{ label: string; why: string; memoryMb: number }>
  canRevert: boolean
  /** Absent in an older app's main process. */
  pc?: PcInfo | null
  items?: OptimizeItem[]
  tips?: OptimizeTip[]
}

export interface ScreenTuningApi {
  state: () => Promise<ScreenTuningView>
  update: (patch: Partial<Pick<ScreenTuningView['settings'], 'activeId' | 'enabled' | 'display' | 'hotkey' | 'cycleKey'>>) => Promise<ScreenTuningView>
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
  /** The ticked steps; without them, the first three steps. `restart`: a step works after a restart. */
  optimize: (selection?: OptimizeItemId[]) => Promise<{ done: string[]; skipped: string[]; restart?: boolean; status: OptimizeStatus }>
  revertOptimize: () => Promise<{ done: string[]; restart?: boolean; status: OptimizeStatus }>
  /** A tip's button: the video card's app, or the maker's page. */
  openOptimizeTool?: (target: OptimizeOpenTarget) => Promise<boolean>
}

export const screenApi = (): ScreenTuningApi | undefined => window.tarkovDesktop?.screen

