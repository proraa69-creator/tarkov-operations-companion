export interface KeybindConfig {
  search: string
  minimap: string
  itemInfo: string
}

const DEFAULT_KEYBINDS: KeybindConfig = {
  search: 'ctrl+k',
  minimap: 'm',
  itemInfo: 'z',
}

const STORAGE_KEY = 'tarkov-keybinds-v1'

export function getStoredKeybinds(): KeybindConfig {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      return { ...DEFAULT_KEYBINDS, ...JSON.parse(stored) }
    } catch {
      return DEFAULT_KEYBINDS
    }
  }
  return DEFAULT_KEYBINDS
}

export function setStoredKeybinds(keybinds: Partial<KeybindConfig>) {
  const current = getStoredKeybinds()
  const updated = { ...current, ...keybinds }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
}

export function normalizeKeybind(key: string): string {
  return key.toLowerCase().trim()
}

export function parseKeybind(keybind: string): { ctrlKey: boolean; metaKey: boolean; key: string } {
  const normalized = normalizeKeybind(keybind)
  const parts = normalized.split('+')
  const key = parts[parts.length - 1]
  const ctrlKey = parts.includes('ctrl')
  const metaKey = parts.includes('meta')
  return { ctrlKey, metaKey, key }
}

export function matchesKeybind(event: KeyboardEvent, keybind: string): boolean {
  const { ctrlKey, metaKey, key } = parseKeybind(keybind)
  const eventCtrlKey = event.ctrlKey || event.metaKey
  const eventKey = event.key.toLowerCase()

  if (ctrlKey && !eventCtrlKey) return false
  if (!ctrlKey && eventCtrlKey) return false
  if (key !== eventKey && key !== event.code.toLowerCase()) return false

  return true
}
