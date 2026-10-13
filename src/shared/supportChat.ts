/**
 * «Чат с поддержкой» (owner, 13.10.2026: «сделай обратную связь в приложении, чат с пользователем»): the message limit
 * and the text cleaning shared by the server (server/src/services/supportChatStore.ts) and the apps
 * (src/support/supportChatClient.ts), so an app never sends what the server would refuse.
 */

/** Characters of one message after cleaning. */
export const SUPPORT_MESSAGE_MAX = 2000

/**
 * Plain text as it is stored and shown: line breaks as \n, tabs as spaces, every other control character and the
 * direction overrides removed (they could make a message read differently in the owner's list), no spaces at the ends
 * of lines, at most one empty line in a row, no blank space around the whole message.
 */
export function cleanSupportText(raw: string) {
  return raw
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/\t/g, ' ')
    // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[ \u00A0]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
