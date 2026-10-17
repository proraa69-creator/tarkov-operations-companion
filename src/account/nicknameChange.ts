/**
 * «При смене ника в приложении, должен сбрасываться прогресс по выбраному режиму игры» (owner, 15.10.2026). A false
 * change would wipe a player's progress, so only a confirmed nickname that differs from the previous confirmed one
 * counts — missing a change is preferred over a false one:
 *   - the game's «Выбор профиля и режима» screen: a nickname the existing rules confirmed (src/import/modeSelectScreen.ts
 *     confirmCards, screenNickname), and a new one must come again on a second, later reading of that screen;
 *   - the player typing another nickname in the app («Сменить ник»).
 * Never: the first nickname ever confirmed on this device (nothing to compare with), a difference of letter case,
 * spacing or a look-alike the game's font mixes up (foldNickname), Tarkov.dev's name (it lags behind a rename), the
 * traders' screen, or the game screen correcting a nickname the player typed that the game never showed.
 * The logs carry no nickname; a new character in them (another profile id) is already a new epoch of its mode
 * (src/import/logApply.ts logEpochChange): a mode whose character changed since the previous nickname is not reset again.
 */
import type { LocalProfile, RaidMode } from '../domain/types'
import { foldNickname } from '../import/modeSelectScreen'
import { cleanNickname, NICKNAME_PATTERN, RAID_MODE_ORDER } from './nicknameBinding'

export type NicknameSource = 'screen' | 'typed'

/** The last confirmed nickname on this device, and the logs' character of each mode when it was confirmed. */
interface ConfirmedNickname {
  nickname: string
  /** The game's screen has shown this nickname (not only typed by the player). */
  screen: boolean
  at: string
  characters: Partial<Record<RaidMode, string>>
}

export const CONFIRMED_NICKNAME_KEY = 'raidos-confirmed-nickname-v1'
/** A new name on the screen counts when a second reading at least this much later shows it again, within the window. */
const SECOND_READING_WINDOW_MS = 10 * 60_000

/** A new name the screen showed once (in memory: a restart starts over). */
let candidate: { folded: string; at: number } | null = null

function read(): ConfirmedNickname | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(CONFIRMED_NICKNAME_KEY) ?? 'null') as Partial<ConfirmedNickname> | null
    if (!parsed || typeof parsed.nickname !== 'string' || !NICKNAME_PATTERN.test(parsed.nickname)) return null
    return { nickname: parsed.nickname, screen: parsed.screen === true, at: typeof parsed.at === 'string' ? parsed.at : '', characters: parsed.characters && typeof parsed.characters === 'object' ? parsed.characters : {} }
  } catch {
    return null
  }
}

function write(value: ConfirmedNickname) {
  try { localStorage.setItem(CONFIRMED_NICKNAME_KEY, JSON.stringify(value)) } catch { /* storage unavailable: no reset can follow from it */ }
}

function charactersOf(profile: LocalProfile): Partial<Record<RaidMode, string>> {
  const characters: Partial<Record<RaidMode, string>> = {}
  for (const mode of RAID_MODE_ORDER) {
    const id = profile.modes[mode]?.logCharacterId
    if (id) characters[mode] = id
  }
  return characters
}

export interface NicknameChange { mode: RaidMode; previous: string; nickname: string; at: string }

/**
 * A confirmed nickname (`source`) seen at `observedAt` while the game is in `mode` (the logs' mode, else the app's): the
 * mode to reset when it is a new nickname by the rules above, else null. Remembers it either way.
 */
export function noteConfirmedNickname(raw: string, source: NicknameSource, observedAt: number, mode: RaidMode, profile: LocalProfile): NicknameChange | null {
  const nickname = cleanNickname(raw)
  if (!NICKNAME_PATTERN.test(nickname) || !Number.isFinite(observedAt)) return null
  const at = new Date(observedAt).toISOString()
  const characters = charactersOf(profile)
  const stored = read()
  const folded = foldNickname(nickname)
  if (!stored) {
    // The first nickname this device confirms: nothing to compare with.
    write({ nickname, screen: source === 'screen', at, characters })
    return null
  }
  if (foldNickname(stored.nickname) === folded) {
    if (source === 'screen') candidate = null
    const next = { nickname: source === 'typed' ? nickname : stored.nickname, screen: stored.screen || source === 'screen', at: at > stored.at ? at : stored.at, characters: { ...stored.characters, ...characters } }
    if (JSON.stringify(next) !== JSON.stringify(stored)) write(next)
    return null
  }
  if (source === 'screen') {
    // The player typed a nickname the game never showed: the game's own is the right one, and nothing was renamed.
    if (!stored.screen) {
      candidate = null
      write({ nickname, screen: true, at, characters })
      return null
    }
    // Another nickname on the screen: once is not enough, a second later reading must show it too.
    if (!candidate || candidate.folded !== folded || observedAt <= candidate.at || observedAt - candidate.at > SECOND_READING_WINDOW_MS) {
      candidate = { folded, at: observedAt }
      return null
    }
    candidate = null
  }
  write({ nickname, screen: source === 'screen', at, characters })
  // The logs started another character in this mode since the previous nickname: its epoch already reset the mode.
  const before = stored.characters[mode]
  const now = characters[mode]
  if (before && now && before !== now) return null
  return { mode, previous: stored.nickname, nickname, at }
}

/** The nickname this device confirmed last, if any (a new one typed now would reset the mode shown). */
export function confirmedNickname() {
  return read()?.nickname
}

/** Tests: the device has confirmed no nickname yet. */
export function forgetConfirmedNickname() {
  candidate = null
  try { localStorage.removeItem(CONFIRMED_NICKNAME_KEY) } catch { /* storage unavailable */ }
}
