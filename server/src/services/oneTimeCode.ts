/**
 * The one-time-code core shared by SMS codes (services/phoneAuth.ts) and e-mail codes (services/emailAuth.ts).
 *
 * - A code is CODE_LENGTH digits from crypto.randomInt (uniform, no modulo bias).
 * - Only SHA-256(per-code salt ‖ purpose ‖ target ‖ code) is stored, so a database copy reveals no usable code and a
 *   code made for one purpose / phone / e-mail never matches another.
 * - The challenge id handed to the client is random; only its SHA-256 is stored.
 * - Codes are compared with timingSafeEqual on the fixed-length digests.
 */
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const CODE_LENGTH = 6
export const DAY_MS = 24 * 60 * 60 * 1000

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** `0`-padded CODE_LENGTH-digit code. */
export const newCode = () => String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')

/** 32 base64url characters (24 random bytes): what the client sends back with the code. */
export const newChallengeId = () => randomBytes(24).toString('base64url')

export const newSalt = () => randomBytes(16)

export function codeHash(salt: Buffer, purpose: string, target: string, code: string) {
  return createHash('sha256').update(salt).update(`\u0000${purpose}\u0000${target}\u0000${code}`).digest()
}

/** «12 34 56» / «123-456» → «123456»; anything that is not CODE_LENGTH digits becomes '' (never matches). */
export function cleanCode(raw: string) {
  const code = raw.replace(/[\s-]/g, '')
  return new RegExp(`^\\d{${CODE_LENGTH}}$`).test(code) ? code : ''
}

/** Constant-time check of a supplied code against the stored digest. */
export function codeMatches(stored: Uint8Array, salt: Uint8Array, purpose: string, target: string, rawCode: string) {
  const expected = Buffer.from(stored)
  const supplied = codeHash(Buffer.from(salt), purpose, target, cleanCode(rawCode))
  return expected.length === supplied.length && timingSafeEqual(expected, supplied)
}
