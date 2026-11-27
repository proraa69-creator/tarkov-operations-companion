import { useCallback, useEffect, useRef, useState } from 'react'
import type { Item, RaidMode } from '../domain/types'
import { labelNames } from '../kappa/collector'
import { forgetKeysAddedByTaken } from '../progression/takenItems'
import { createKeyMatcher } from './keyMatch'
import { addSeenKeys, readOwnedKeys, setOwnedKey } from './ownedKeys'
import { writeUnsureKeys } from './unsureKeys'

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

/** `unsure`: labels several keys carry seen in this scan whose key no tooltip has told yet («Времянка»). */
export interface KeyScanPass { ok: true; gameWindow: boolean; waiting: boolean; read: number; found: number; added: number; unsure: string[] }

/**
 * What a key scan looks for: every key of the catalog, told apart by the keys' own matching (quests/keyMatch.ts: report 236),
 * and the labels its second look takes (`wanted`, the quests' keys, first).
 */
export function keyScanLists(items: Item[], wantedIds: readonly string[]) {
  const keys = items.filter(isKeyItem)
  const wanted = new Set(wantedIds)
  const names = [...keys.filter((item) => wanted.has(item.id)), ...keys.filter((item) => !wanted.has(item.id))]
    .flatMap((item) => labelNames(item)).slice(0, NAMES_LIMIT)
  return { matcher: createKeyMatcher(keys, items), names }
}

/** One scan session: `wanted` (the quests' keys) first in the second look; the pieces seen so far go to the list after each pass. */
export function createKeyScan(input: { items: Item[]; wanted: readonly string[]; profileId: string; mode: RaidMode }) {
  const { matcher, names } = keyScanLists(input.items, input.wanted)
  const seen = new Map<string, number>()
  /**
   * Labels several keys carry, seen and not told by a tooltip yet (label → its keys); how many cells of each such label were
   * read (each label once per scan: electron/collectorScan.ts); and every key of such a label seen.
   */
  const unsure = new Map<string, string[]>()
  const labelCells = new Map<string, number>()
  const sharedKeys = new Set<string>()
  let added = 0

  async function pass(restart: boolean): Promise<KeyScanPass | { ok: false }> {
    const api = window.tarkovDesktop
    if (!api?.scanScreenText) return { ok: false }
    if (restart) { seen.clear(); unsure.clear(); labelCells.clear(); sharedKeys.clear() }
    const frame = await api.scanScreenText(restart ? { restart: true, names } : {})
    for (const [id, pieces] of matcher.count(frame.text)) seen.set(id, (seen.get(id) ?? 0) + pieces)
    // «Времянка» and the like (owner, 25.11.2026: «определять в точности ключи»): the player may hover the key, its tooltip's
    // full name, read on a later pass, tells which key it is; or picks it in «Ключи под вопросом» after the scan (27.11.2026).
    for (const row of frame.text.split(/\r?\n/)) {
      for (const { label, ids } of matcher.shared(row)) {
        labelCells.set(label, (labelCells.get(label) ?? 0) + 1)
        for (const id of ids) sharedKeys.add(id)
        if (!ids.some((id) => seen.has(id))) unsure.set(label, ids)
      }
    }
    for (const [label, ids] of unsure) if (ids.some((id) => seen.has(id))) unsure.delete(label)
    added += seen.size ? addSeenKeys(input.profileId, input.mode, seen) : 0
    // a key «Взял» put in the list and seen now: «Есть в схроне»
    if (seen.size) forgetKeysAddedByTaken(input.profileId, input.mode, seen.keys())
    // «Ключи под вопросом»: a scan that sees the key container puts its labels in place of the last scan's (one that sees
    // nothing of it — the game closed, another screen — leaves them).
    if (seen.size || unsure.size) {
      writeUnsureKeys(input.profileId, input.mode, new Map([...unsure].map(([label, ids]) => [label, { ids, seen: labelCells.get(label) ?? 1 }])))
    }
    return {
      ok: true,
      gameWindow: frame.gameWindow,
      waiting: 'waiting' in frame && frame.waiting === true,
      read: 'read' in frame ? frame.read ?? 0 : 0,
      found: seen.size,
      added,
      unsure: [...unsure.keys()],
    }
  }

  /**
   * The keys of «Ключи в схроне» this scan did not see (owner, 25.11.2026: «слева те что у меня в схроне, справа то что
   * нашел»): an earlier scan's or one the player has no more. Never one whose label was seen but several keys carry it.
   * The scan itself only adds (owner, 16.11.2026); taking these off is the player's click (removeUnseenKeys).
   */
  function unseen() {
    return [...readOwnedKeys(input.profileId, input.mode).keys()].filter((id) => !seen.has(id) && !sharedKeys.has(id))
  }
  return { pass, unseen }
}

/** «Убрать ненайденные»: the keys a scan did not see go from «Ключи в схроне». */
export function removeUnseenKeys(profileId: string, mode: RaidMode, ids: readonly string[]) {
  for (const id of ids) setOwnedKey(profileId, mode, id, 0)
}

/** «Наведите курсор на «Времянка»»: what the scan line asks while labels several keys carry are not told yet. */
export function unsureHint(labels: readonly string[]) {
  if (!labels.length) return ''
  const named = labels.slice(0, 3).map((label) => `«${label}»`).join(', ')
  return `Наведите курсор на ${named}: такая подпись у нескольких ключей.`
}

/**
 * One «Найти ключи»: pass after pass for SCAN_WINDOW_MS while `running()`, each line said through `onMessage`; the last one is
 * returned. The button of «Ключи для квестов» and the phone's «Найти ключи» (src/screen/screenRemote.ts) run the same.
 * `onUnsure`: the scan is over, run out or stopped, and left labels several keys carry (unsureKeys.ts) for the player to tell.
 */
export async function runKeyScan(input: { items: Item[]; wanted: readonly string[]; profileId: string; mode: RaidMode }, options: { running: () => boolean; onMessage: (text: string) => void; onUnseen?: (ids: string[]) => void; onUnsure?: (labels: string[]) => void }) {
  const scan = createKeyScan(input)
  const started = Date.now()
  let sawGame = false
  let last: KeyScanPass | null = null
  let said = ''
  const say = (text: string) => { said = text; options.onMessage(text) }
  try {
    for (let pass = 0; options.running() && Date.now() - started < SCAN_WINDOW_MS; pass += 1) {
      const result = await scan.pass(pass === 0)
      if (!result.ok) { say('Поиск ключей работает только в приложении для Windows.'); return said }
      last = result
      if (result.gameWindow) sawGame = true
      say(result.waiting
        ? 'Откройте игру с контейнером ключей: поиск идёт, пока окно игры видно на экране.'
        : `Прочитано подписей: ${result.read} · Найдено ключей: ${result.found}. ${unsureHint(result.unsure) || 'Листайте контейнер — поиск идёт.'}`)
      await new Promise((resolve) => setTimeout(resolve, result.waiting ? WAIT_PAUSE_MS : PASS_PAUSE_MS))
    }
    if (options.running()) {
      say(!sawGame
        ? 'Окно игры не найдено. Откройте в игре контейнер с ключами и нажмите «Найти ключи» ещё раз.'
        : `Готово. Найдено ключей: ${last?.found ?? 0}, новых: ${last?.added ?? 0}.${last?.unsure.length ? ` ${unsureHint(last.unsure)} Затем нажмите «Найти ключи» ещё раз.` : ''}`)
      // The keys of the list this scan did not see, offered to take off — only after a scan that saw the key container.
      if (sawGame && (last?.found ?? 0) > 0) options.onUnseen?.(scan.unseen())
    }
    // Owner, 27.11.2026: «после конца сканирования открывается это окно автоматически».
    if (sawGame && last?.unsure.length) options.onUnsure?.(last.unsure)
  } catch {
    say('Не удалось распознать экран. Попробуйте ещё раз.')
  }
  return said
}

/**
 * The «Найти ключи» button: a second press stops; Windows app only (`available`). `unsureOpen`: the window «Ключи под вопросом»,
 * opened by itself when a scan ends with labels several keys carry, and by its button.
 */
export function useKeyScan(input: { items: Item[]; wanted: readonly string[]; profileId: string; mode: RaidMode }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [unseen, setUnseen] = useState<string[]>([])
  const [unsureOpen, setUnsureOpen] = useState(false)
  const running = useRef(false)
  const latest = useRef(input)
  useEffect(() => { latest.current = input })
  useEffect(() => () => { running.current = false }, [])

  const run = useCallback(async () => {
    if (running.current) { running.current = false; return }
    running.current = true
    setBusy(true)
    setMessage('')
    setUnseen([])
    setUnsureOpen(false)
    try {
      await runKeyScan(latest.current, { running: () => running.current, onMessage: setMessage, onUnseen: setUnseen, onUnsure: () => setUnsureOpen(true) })
    } finally {
      running.current = false
      setBusy(false)
    }
  }, [])

  const removeUnseen = useCallback(() => {
    const { profileId, mode } = latest.current
    removeUnseenKeys(profileId, mode, unseen)
    setUnseen([])
  }, [unseen])

  const openUnsure = useCallback(() => setUnsureOpen(true), [])
  const closeUnsure = useCallback(() => setUnsureOpen(false), [])

  return { available: Boolean(window.tarkovDesktop?.scanScreenText), busy, message, run, unseen, removeUnseen, unsureOpen, openUnsure, closeUnsure }
}
