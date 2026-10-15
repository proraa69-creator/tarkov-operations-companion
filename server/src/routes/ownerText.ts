/**
 * Player-facing free text the owner writes in the quest constructor (point descriptions, requirement comments):
 * line breaks stay, other control characters never reach a player's screen, blanks around are trimmed, an empty text
 * counts as absent. The same cleaning as the quest texts (routes/questTexts.ts).
 */
import { z } from 'zod'

export const printable = (value: string) => [...value.replace(/\r\n?/g, '\n')].filter((char) => {
  const code = char.charCodeAt(0)
  return code === 10 || (code >= 32 && code !== 127)
}).join('')

/** An optional text of at most `max` characters (after cleaning); '' / blanks become undefined. */
export const optionalText = (max: number) => z.string().max(max * 2).optional()
  .transform((value) => (value === undefined ? undefined : printable(value).trim() || undefined))
  .pipe(z.string().max(max).optional())

/** One line (titles): line breaks become spaces. */
export const optionalLine = (max: number) => z.string().max(max * 2).optional()
  .transform((value) => (value === undefined ? undefined : printable(value).replace(/\s*\n\s*/g, ' ').trim() || undefined))
  .pipe(z.string().max(max).optional())
