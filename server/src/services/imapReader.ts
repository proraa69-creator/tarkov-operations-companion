/**
 * A read-only IMAP client for one job: the new messages of one sender in INBOX (BZB's «Новая продажа»,
 * services/bezebeeMail.ts). LOGIN with an app password over TLS, SELECT INBOX, UID SEARCH, UID FETCH BODY.PEEK[] (the
 * messages stay unread), LOGOUT. Nothing is ever written to the mailbox.
 */
import { connect as tlsConnect } from 'node:tls'
import type { Duplex } from 'node:stream'

export interface ImapOptions {
  host: string
  port: number
  user: string
  password: string
  /** Substring of the sender's address the search asks for (IMAP SEARCH FROM). */
  from: string
  /** Messages after this UID; 0 (or another UIDVALIDITY) searches by `since` instead. */
  afterUid: number
  uidValidity?: number
  since: Date
  /** At most this many messages per check (the rest come next time). */
  limit?: number
  timeoutMs?: number
  /** Tests: a plain socket to a fake server. */
  connect?: (host: string, port: number) => Duplex
}

export interface ImapResult { uidValidity: number; messages: Array<{ uid: number; raw: Buffer }> }

export class ImapError extends Error {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const imapDate = (date: Date) => `${date.getUTCDate()}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()}`
/** A quoted IMAP string; app passwords and addresses never need a literal. */
const quote = (value: string) => `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`

interface Response { lines: string[]; literals: Buffer[] }

/** Reads server lines and literals (`{n}\r\n` + n bytes) and hands out one tagged response at a time. */
class Connection {
  private buffer = Buffer.alloc(0)
  private waiting: (() => void) | null = null
  private failed: Error | null = null
  private ended = false

  constructor(private readonly socket: Duplex) {
    socket.on('data', (chunk: Buffer) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.wake() })
    socket.on('error', (error) => { this.failed = error; this.wake() })
    socket.on('close', () => { this.ended = true; this.wake() })
  }

  private wake() { const resolve = this.waiting; this.waiting = null; resolve?.() }

  private async more() {
    if (this.failed) throw new ImapError(`Почтовый сервер: ${this.failed.message}`)
    if (this.ended) throw new ImapError('Почтовый сервер закрыл соединение')
    await new Promise<void>((resolve) => { this.waiting = resolve })
  }

  /** One line without CRLF (with any literal of the line read into `literals`). */
  private async line(literals: Buffer[]): Promise<string> {
    for (;;) {
      const end = this.buffer.indexOf('\r\n')
      if (end >= 0) {
        const line = this.buffer.subarray(0, end).toString('utf8')
        const literal = /\{(\d+)\}$/.exec(line)
        if (!literal) { this.buffer = this.buffer.subarray(end + 2); return line }
        const size = Number(literal[1])
        if (this.buffer.length >= end + 2 + size) {
          literals.push(Buffer.from(this.buffer.subarray(end + 2, end + 2 + size)))
          this.buffer = this.buffer.subarray(end + 2 + size)
          // The rest of the response line follows the literal.
          return `${line}${await this.line(literals)}`
        }
      }
      await this.more()
    }
  }

  async greeting() {
    const line = await this.line([])
    if (!/^\* (OK|PREAUTH)/i.test(line)) throw new ImapError('Почтовый сервер не ответил приветствием IMAP')
  }

  private tag = 0
  async command(text: string, describe = text.split(' ')[0]): Promise<Response> {
    const tag = `R${++this.tag}`
    this.socket.write(`${tag} ${text}\r\n`)
    const response: Response = { lines: [], literals: [] }
    for (;;) {
      const line = await this.line(response.literals)
      if (line.startsWith(`${tag} `)) {
        if (/^\S+ OK/i.test(line)) return response
        throw new ImapError(describe === 'LOGIN' ? 'Почта не пустила: проверьте адрес и пароль приложения' : `Почтовый сервер отказал (${describe}): ${line.slice(tag.length + 1, 200)}`)
      }
      response.lines.push(line)
    }
  }

  close() { this.socket.destroy() }
}

/** New messages from `from` in INBOX, oldest first. */
export async function fetchNewMessages(options: ImapOptions): Promise<ImapResult> {
  const socket = options.connect ? options.connect(options.host, options.port) : tlsConnect({ host: options.host, port: options.port, servername: options.host })
  const connection = new Connection(socket)
  const timer = setTimeout(() => socket.destroy(new Error('нет ответа')), options.timeoutMs ?? 30_000)
  try {
    await connection.greeting()
    await connection.command(`LOGIN ${quote(options.user)} ${quote(options.password)}`, 'LOGIN')
    const selected = await connection.command('SELECT INBOX')
    const uidValidity = Number(/UIDVALIDITY (\d+)/i.exec(selected.lines.join('\n'))?.[1] ?? 0)
    const fresh = !options.afterUid || (options.uidValidity !== undefined && options.uidValidity !== uidValidity)
    const criteria = fresh ? `SINCE ${imapDate(options.since)}` : `UID ${options.afterUid + 1}:*`
    const search = await connection.command(`UID SEARCH ${criteria} FROM ${quote(options.from)}`, 'SEARCH')
    const uids = search.lines.filter((line) => /^\* SEARCH/i.test(line)).flatMap((line) => line.replace(/^\* SEARCH/i, '').trim().split(/\s+/)).map(Number)
      .filter((uid) => Number.isInteger(uid) && uid > 0 && (fresh || uid > options.afterUid)).sort((a, b) => a - b).slice(0, options.limit ?? 50)
    const messages: ImapResult['messages'] = []
    for (const uid of uids) {
      const fetched = await connection.command(`UID FETCH ${uid} (UID BODY.PEEK[])`, 'FETCH')
      if (fetched.literals[0]) messages.push({ uid, raw: fetched.literals[0] })
    }
    await connection.command('LOGOUT').catch(() => undefined)
    return { uidValidity, messages }
  } finally {
    clearTimeout(timer)
    connection.close()
  }
}
