import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item, RaidMode } from '../domain/types'
import { screenEntries } from '../kappa/collector'
import { countScreenItems } from '../stashScan/screenSync'
import { addSeenKeys } from './ownedKeys'

/**
 * «Найти ключи» (owner, 07.11.2026: «По нажатию кнопки «Найти ключи» человек заходит в игру и открывает контейнер со всеми ключами. И
 * он находит все ключи, которые у него есть»): the stash scan's reader (electron/collectorScan.ts: screenshots of the game window
 * only, nothing injected, nothing pressed) looking for keys, pass after pass while the player scrolls the key container; every key
 * seen joins «Ключи в схроне» (quests/ownedKeys.ts). The keys of the quests are looked at twice (the IPC's second look takes so many
 * names), the others once.
 */
export const KEY_CATEGORY = 'Ключ'
/** The IPC takes this many label names for a second look (electron/main.ts collector:scan-screen). */
const NAMES_LIMIT = 120
/** Owner, 10.11.2026: «Двадцать секунд». */
const SCAN_WINDOW_MS = 20_000
const PASS_PAUSE_MS = 600
const WAIT_PAUSE_MS = 1000

export function isKeyItem(item: Pick<Item, 'category'>) {
  return item.category === KEY_CATEGORY
}

export interface KeyScanPass { ok: true; gameWindow: boolean; waiting: boolean; read: number; found: number; added: number }

/** One scan session: `wanted` (the quests' keys) first in the second look; the pieces seen so far go to the list after each pass. */
export function createKeyScan(input: { items: Item[]; wanted: readonly string[]; profileId: string; mode: RaidMode }) {
  const keys = input.items.filter(isKeyItem)
  const entries = screenEntries(new Map(keys.map((item) => [item.id, 1])), input.items)
  const wanted = new Set(input.wanted)
  const names = [...keys.filter((item) => wanted.has(item.id)), ...keys.filter((item) => !wanted.has(item.id))]
    .map((item) => item.shortName ?? '').filter(Boolean).slice(0, NAMES_LIMIT)
  const seen = new Map<string, number>()
  let added = 0

  async function pass(restart: boolean): Promise<KeyScanPass | { ok: false }> {
    const api = window.tarkovDesktop
    if (!api?.scanScreenText) return { ok: false }
    if (restart) seen.clear()
    const frame = await api.scanScreenText(restart ? { restart: true, names } : {})
    for (const [id, pieces] of countScreenItems(entries, frame.text)) seen.set(id, (seen.get(id) ?? 0) + pieces)
    added += seen.size ? addSeenKeys(input.profileId, input.mode, seen) : 0
    return {
      ok: true,
      gameWindow: frame.gameWindow,
      waiting: 'waiting' in frame && frame.waiting === true,
      read: 'read' in frame ? frame.read ?? 0 : 0,
      found: seen.size,
      added,
    }
  }
  return { pass }
}

/** The «Найти ключи» button: a second press stops; Windows app only (`available`). */
export function useKeyScan(input: { items: Item[]; wanted: readonly string[]; profileId: string; mode: RaidMode }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const running = useRef(false)
  const latest = useRef(input)
  useEffect(() => { latest.current = input })
  useEffect(() => () => { running.current = false }, [])

  const run = useCallback(async () => {
    if (running.current) { running.current = false; return }
    running.current = true
    setBusy(true)
    setMessage('')
    const scan = createKeyScan(latest.current)
    const started = Date.now()
    let sawGame = false
    let last: KeyScanPass | null = null
    try {
      for (let pass = 0; running.current && Date.now() - started < SCAN_WINDOW_MS; pass += 1) {
        const result = await scan.pass(pass === 0)
        if (!result.ok) { setMessage('Поиск ключей работает только в приложении для Windows.'); return }
        last = result
        if (result.gameWindow) sawGame = true
        setMessage(result.waiting
          ? 'Откройте игру с контейнером ключей: поиск идёт, пока окно игры видно на экране.'
          : `Прочитано подписей: ${result.read} · Найдено ключей: ${result.found}. Листайте контейнер — поиск идёт.`)
        await new Promise((resolve) => setTimeout(resolve, result.waiting ? WAIT_PAUSE_MS : PASS_PAUSE_MS))
      }
      if (running.current) {
        setMessage(!sawGame
          ? 'Окно игры не найдено. Откройте в игре контейнер с ключами и нажмите «Найти ключи» ещё раз.'
          : `Готово. Найдено ключей: ${last?.found ?? 0}, новых: ${last?.added ?? 0}.`)
      }
    } catch {
      setMessage('Не удалось распознать экран. Попробуйте ещё раз.')
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])

  return { available: Boolean(window.tarkovDesktop?.scanScreenText), busy, message, run }
}
