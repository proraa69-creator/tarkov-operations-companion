/**
 * A small reader of e-mail messages (RFC 5322 + MIME) for the mail the server takes in — BZB's «Новая продажа»
 * (services/bezebeeMail.ts). Headers in order (unfolded, encoded words decoded), the text of the message: the first
 * text/plain part, else text/html with the tags dropped; quoted-printable / base64 and the part's charset decoded.
 */

export interface MailMessage {
  /** Every header in the order of the message, names in lower case. */
  headers: Array<[string, string]>
  header(name: string): string | undefined
  subject: string
  /** The address of the From header, lower case. */
  fromAddress?: string
  messageId?: string
  text: string
}

const decoder = (charset: string | undefined) => {
  try { return new TextDecoder(charset?.trim().toLowerCase() || 'utf-8') } catch { return new TextDecoder('utf-8') }
}

/** `=?charset?B|Q?…?=` words of a header value. */
export function decodeEncodedWords(value: string) {
  return value
    .replace(/\?=\s+=\?/g, '?==?')
    .replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (_whole, charset: string, encoding: string, data: string) => {
      const bytes = encoding.toLowerCase() === 'b'
        ? Buffer.from(data, 'base64')
        : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-fA-F]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1')
      return decoder(charset.split('*')[0]).decode(bytes)
    })
}

function decodeQuotedPrintable(body: string) {
  const soft = body.replace(/=\r?\n/g, '')
  const bytes: number[] = []
  for (let index = 0; index < soft.length; index++) {
    const char = soft[index]
    if (char === '=' && /^[0-9a-fA-F]{2}$/.test(soft.slice(index + 1, index + 3))) {
      bytes.push(parseInt(soft.slice(index + 1, index + 3), 16))
      index += 2
    } else {
      bytes.push(...Buffer.from(char, 'latin1'))
    }
  }
  return Buffer.from(bytes)
}

function splitHead(raw: Buffer) {
  const text = raw.toString('latin1')
  const match = /\r?\n\r?\n/.exec(text)
  if (!match) return { head: text, body: Buffer.alloc(0) }
  return { head: text.slice(0, match.index), body: raw.subarray(Buffer.byteLength(text.slice(0, match.index + match[0].length), 'latin1')) }
}

function parseHeaders(head: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const line of head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const at = line.indexOf(':')
    if (at <= 0) continue
    // Header bytes are read as UTF-8 (raw 8-bit headers), then encoded words are decoded.
    out.push([line.slice(0, at).trim().toLowerCase(), decodeEncodedWords(Buffer.from(line.slice(at + 1).trim(), 'latin1').toString('utf8'))])
  }
  return out
}

/** `text/html; charset="utf-8"` → type and parameters. */
function contentType(value: string | undefined) {
  const [type, ...rest] = (value ?? 'text/plain').split(';')
  const params = new Map<string, string>()
  for (const piece of rest) {
    const at = piece.indexOf('=')
    if (at > 0) params.set(piece.slice(0, at).trim().toLowerCase(), piece.slice(at + 1).trim().replace(/^"(.*)"$/, '$1'))
  }
  return { type: type.trim().toLowerCase(), params }
}

function decodeBody(body: Buffer, encoding: string | undefined, charset: string | undefined) {
  const kind = encoding?.trim().toLowerCase()
  const bytes = kind === 'base64' ? Buffer.from(body.toString('latin1').replace(/\s+/g, ''), 'base64') : kind === 'quoted-printable' ? decodeQuotedPrintable(body.toString('latin1')) : body
  return decoder(charset).decode(bytes)
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", laquo: '«', raquo: '»', mdash: '—', ndash: '–' }

/** The readable text of an HTML part: no styles, scripts or tags; entities decoded; whitespace collapsed. */
export function htmlToText(html: string) {
  return html
    .replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
      if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)))
      return ENTITIES[entity.toLowerCase()] ?? whole
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/** The text parts of a message or of one MIME part, depth-first. */
function textParts(headers: Array<[string, string]>, body: Buffer, depth = 0): Array<{ type: string; text: string }> {
  const get = (name: string) => headers.find(([key]) => key === name)?.[1]
  const { type, params } = contentType(get('content-type'))
  if (type.startsWith('multipart/') && params.get('boundary') && depth < 8) {
    const boundary = `--${params.get('boundary')}`
    const source = body.toString('latin1')
    const parts: Array<{ type: string; text: string }> = []
    for (const chunk of source.split(boundary).slice(1)) {
      if (chunk.startsWith('--')) break
      const part = Buffer.from(chunk.replace(/^\r?\n/, '').replace(/\r?\n$/, ''), 'latin1')
      const { head, body: partBody } = splitHead(part)
      parts.push(...textParts(parseHeaders(head), partBody, depth + 1))
    }
    return parts
  }
  if (type === 'text/plain' || type === 'text/html') return [{ type, text: decodeBody(body, get('content-transfer-encoding'), params.get('charset')) }]
  return []
}

export function parseMail(raw: Buffer): MailMessage {
  const { head, body } = splitHead(raw)
  const headers = parseHeaders(head)
  const header = (name: string) => headers.find(([key]) => key === name.toLowerCase())?.[1]
  const parts = textParts(headers, body)
  const plain = parts.find((part) => part.type === 'text/plain')
  const html = parts.find((part) => part.type === 'text/html')
  const text = plain ? plain.text.replace(/\r\n/g, '\n').trim() : html ? htmlToText(html.text) : ''
  const from = header('from') ?? ''
  const fromAddress = (/<([^>]+)>/.exec(from)?.[1] ?? /[^\s<>"]+@[^\s<>"]+/.exec(from)?.[0])?.toLowerCase()
  const messageId = header('message-id')?.replace(/^<|>$/g, '').trim() || undefined
  return { headers, header, subject: header('subject') ?? '', ...(fromAddress ? { fromAddress } : {}), ...(messageId ? { messageId } : {}), text }
}
