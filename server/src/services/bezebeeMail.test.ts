import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, connect as netConnect, type AddressInfo, type Server } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from './accountStore.js'
import { BezebeeCredentialStore } from './bezebeeWebhook.js'
import { readBezebeeSaleMail, vouchedByGmail } from './bezebeeMail.js'
import { openDatabase } from './database.js'
import { parseMail } from './mailMessage.js'
import { PaymentStore } from './paymentStore.js'
import { ProgressStore } from './progressStore.js'

/** BZB sales by e-mail (owner, 20.10.2026): «Новая продажа» letters read from the project mailbox. */
const password = 'correct horse battery'
const DAY = 86_400_000

const qp = (text: string) => [...Buffer.from(text, 'utf8')].map((byte) => (byte >= 33 && byte <= 126 && byte !== 61 ? String.fromCharCode(byte) : `=${byte.toString(16).toUpperCase().padStart(2, '0')}`)).join('').replace(/(.{70})/g, '$1=\r\n')
const b64 = (text: string) => `=?UTF-8?B?${Buffer.from(text, 'utf8').toString('base64')}?=`

const GMAIL_VOUCHES = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@bezebee.com header.s=mail header.b=AbCd;\r\n       spf=pass (google.com: domain of no-reply@bezebee.com designates 1.2.3.4 as permitted sender) smtp.mailfrom=no-reply@bezebee.com;\r\n       dmarc=pass (p=NONE sp=NONE dis=NONE) header.from=bezebee.com'
const FORGED = 'Authentication-Results: mx.google.com;\r\n       spf=fail (google.com: domain of no-reply@bezebee.com does not designate 6.6.6.6 as permitted sender) smtp.mailfrom=no-reply@bezebee.com;\r\n       dmarc=fail (p=NONE) header.from=bezebee.com\r\nAuthentication-Results: mx.google.com; dkim=pass header.i=@bezebee.com'

/** A «Новая продажа» letter as BZB sends it (owner's screenshot, 20.10.2026): HTML, quoted-printable, UTF-8. */
function saleLetter(options: { id: string; product?: string; amount?: string; contact?: string; auth?: string; from?: string }) {
  const product = options.product ?? 'Raid OS — Global — 1 Month'
  const html = `<html><head><style>p{color:#333}</style></head><body><div class="card"><h1>Друг, у вас новая продажа!</h1>
<p>Покупатель оплатил товар «${product}» на сумму ${options.amount ?? '7.00 USD'}. Доставку выполняет автор — свяжитесь с покупателем. Контакт покупателя:</p>
<div class="contact"><a href="mailto:${options.contact ?? 'buyer@example.com'}">${options.contact ?? 'buyer@example.com'}</a></div>
<a class="button" href="https://app.bezebee.com">Перейти в кабинет</a><p>С уважением,<br>команда BZB</p></div></body></html>`
  return Buffer.from([
    options.auth ?? GMAIL_VOUCHES,
    `From: BZB <${options.from ?? 'no-reply@bezebee.com'}>`,
    'To: raidosapp@gmail.com',
    `Subject: ${b64(`Новая продажа: «${product}»`)}`,
    `Message-ID: <${options.id}@bezebee.com>`,
    'Date: Mon, 20 Oct 2026 19:33:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: multipart/alternative; boundary="b1"',
    '',
    '--b1',
    'Content-Type: text/html; charset="utf-8"',
    'Content-Transfer-Encoding: quoted-printable',
    '',
    qp(html),
    '--b1--',
    '',
  ].join('\r\n'), 'utf8')
}

test('a sale letter: product, sum, currency, the buyer\'s e-mail and the tariff; Gmail\'s word on where it comes from', () => {
  const sale = readBezebeeSaleMail(parseMail(saleLetter({ id: 's1' })))!
  assert.ok(sale)
  assert.equal(sale.key, 'mail:s1@bezebee.com')
  assert.equal(sale.verified, true)
  assert.equal(sale.notice.status, 'paid')
  assert.equal(sale.notice.email, 'buyer@example.com')
  assert.equal(sale.notice.amount, 7)
  assert.equal(sale.notice.currency, 'USD')
  assert.deepEqual([sale.notice.tariff?.region, sale.notice.tariff?.plan, sale.notice.tariff?.friend], ['WORLD', '1m', false])
  assert.equal(sale.summary.product, 'Raid OS — Global — 1 Month')

  const cis = readBezebeeSaleMail(parseMail(saleLetter({ id: 's2', product: 'Raid OS — СНГ — 6 месяцев', amount: '1 500,00 RUB' })))!
  assert.deepEqual([cis.notice.tariff?.region, cis.notice.tariff?.plan, cis.notice.amount], ['CIS', '6m', 1500])
  const friend = readBezebeeSaleMail(parseMail(saleLetter({ id: 's3', amount: '5.50 USD' })))!
  assert.equal(friend.notice.tariff?.friend, true)
  const telegram = readBezebeeSaleMail(parseMail(saleLetter({ id: 's4', contact: '@buyer_tg' })))!
  assert.equal(telegram.notice.email, undefined)
  assert.equal(telegram.notice.telegram, '@buyer_tg')
  // Not BZB: nothing.
  assert.equal(readBezebeeSaleMail(parseMail(saleLetter({ id: 's5', from: 'no-reply@bezebee.com.evil.example' }))), undefined)
})

test('only Gmail\'s own topmost verdict counts: a forged sender or a pasted «pass» is not vouched for; a forwarded letter is', () => {
  assert.equal(vouchedByGmail(parseMail(saleLetter({ id: 'f1', auth: FORGED }))), false)
  assert.equal(vouchedByGmail(parseMail(saleLetter({ id: 'f2', auth: 'X-Note: none' }))), false)
  assert.equal(vouchedByGmail(parseMail(saleLetter({ id: 'f3', auth: 'Authentication-Results: mail.evil.example; dkim=pass header.i=@bezebee.com' }))), false)
  const forwarded = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@bezebee.com header.s=mail;\r\n       arc=pass (i=1 spf=pass spfdomain=bezebee.com dkim=pass dkdomain=bezebee.com dmarc=pass fromdomain=bezebee.com);\r\n       spf=pass (google.com: domain of owner+caf_=raidosapp=gmail.com@gmail.com designates 2.2.2.2 as permitted sender) smtp.mailfrom="owner+caf_=raidosapp=gmail.com@gmail.com"'
  assert.equal(vouchedByGmail(parseMail(saleLetter({ id: 'f4', auth: forwarded }))), true)
  assert.equal(vouchedByGmail(parseMail(saleLetter({ id: 'f5', auth: 'Authentication-Results: mx.google.com; dkim=pass header.i=@evil.example; spf=pass smtp.mailfrom=x@evil.example' }))), false)
})

/** A mailbox on a fake IMAP server: LOGIN with one password, INBOX with the given letters. */
async function fakeImap(user: string, pass: string, letters: () => Buffer[]) {
  const logins: string[] = []
  const server: Server = createServer((socket) => {
    socket.write('* OK fake IMAP ready\r\n')
    let pending = ''
    socket.on('data', (chunk) => {
      pending += chunk.toString('utf8')
      let end: number
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end)
        pending = pending.slice(end + 2)
        const [tag, command, ...rest] = line.split(' ')
        const args = rest.join(' ')
        if (command === 'LOGIN') {
          logins.push(args)
          socket.write(args === `"${user}" "${pass}"` ? `${tag} OK logged in\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`)
        } else if (command === 'SELECT') {
          socket.write(`* ${letters().length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n${tag} OK [READ-ONLY] selected\r\n`)
        } else if (command === 'UID' && rest[0] === 'SEARCH') {
          const after = /UID (\d+):\*/.exec(args)
          const uids = letters().map((_, index) => index + 1).filter((uid) => !after || uid >= Number(after[1]) || uid === letters().length)
          socket.write(`* SEARCH ${uids.join(' ')}\r\n${tag} OK search done\r\n`)
        } else if (command === 'UID' && rest[0] === 'FETCH') {
          const uid = Number(rest[1])
          const raw = letters()[uid - 1]
          socket.write(Buffer.concat([Buffer.from(`* ${uid} FETCH (UID ${uid} BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK fetch done\r\n`)]))
        } else if (command === 'LOGOUT') {
          socket.end(`* BYE\r\n${tag} OK bye\r\n`)
        } else {
          socket.write(`${tag} BAD unknown\r\n`)
        }
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  return { logins, connect: () => netConnect(port, '127.0.0.1'), close: () => new Promise<void>((resolve) => server.close(() => resolve())) }
}

test('the mailbox: the owner pastes the address and the app password, the letter opens the subscription once; a forged one waits', async () => {
  const letters: Buffer[] = []
  const imap = await fakeImap('raidosapp@gmail.com', 'abcdefghijklmnop', () => letters)
  let clock = Date.parse('2026-10-20T20:00:00.000Z')
  const db = openDatabase(':memory:')
  const first = new AccountStore({ db, ownerEmails: [], now: () => clock })
  await first.register('owner@example.com', password, undefined, undefined, 'RU')
  first.markEmailVerified(first.accountByEmail('owner@example.com')!.id)
  const accounts = new AccountStore({ db, ownerEmails: ['owner@example.com'], now: () => clock })
  const payments = new PaymentStore(db, undefined, { now: () => clock })
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, bezebeeCredentials: new BezebeeCredentialStore(undefined), bezebeeUsdRub: 100, bezebeeMailConnect: imap.connect, guard: { quickCheckEveryMs: 0 } }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const call = async <T = Record<string, unknown>>(method: string, path: string, token?: string, body?: unknown) => {
    const response = await fetch(`${base}${path}`, { method, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: response.status, json: await response.json() as T }
  }
  try {
    const owner = (await call<{ token: string }>('POST', '/accounts/login', undefined, { email: 'owner@example.com', password })).json.token
    const buyer = (await call<{ token: string }>('POST', '/accounts/register', undefined, { email: 'buyer@example.com', password, country: 'DE' })).json.token
    assert.ok(buyer)
    const buyerId = accounts.accountByEmail('buyer@example.com')!.id
    letters.push(saleLetter({ id: 'sale-1' }), saleLetter({ id: 'forged-1', auth: FORGED, contact: 'buyer@example.com' }))
    type Mail = { mail: { configured: boolean; user?: string; error?: string; read: number; checkedAt?: string } }

    // A wrong password: the panel says so, nothing is applied.
    const wrong = await call<Mail>('PUT', '/accounts/me/admin/bezebee/credentials', owner, { mailUser: 'raidosapp@gmail.com', mailPassword: 'wrong pass word!' })
    assert.equal(wrong.status, 200, JSON.stringify(wrong.json))
    assert.match(wrong.json.mail.error ?? '', /пароль приложения/)
    assert.equal(payments.paidUntil(buyerId), undefined)
    // Nobody but the owner.
    assert.equal((await call('POST', '/accounts/me/admin/bezebee/mail/check', buyer)).status, 404)

    // The right one, shown in groups of four by Gmail.
    const saved = await call<Mail>('PUT', '/accounts/me/admin/bezebee/credentials', owner, { mailPassword: 'abcd efgh ijkl mnop' })
    assert.equal(saved.json.mail.error, undefined, JSON.stringify(saved.json))
    assert.deepEqual([saved.json.mail.configured, saved.json.mail.user, saved.json.mail.read], [true, 'raidosapp@gmail.com', 2])
    assert.ok((payments.paidUntil(buyerId) ?? 0) > clock + 29 * DAY, 'the vouched letter opened a month')
    type Events = { events: Array<{ status: string; detail?: string; email?: string; plan?: string; region?: string }>; unmatched: number }
    const events = (await call<Events>('GET', '/accounts/me/admin/bezebee/events', owner)).json
    assert.deepEqual(events.events.map((event) => event.status).sort(), ['confirmed', 'unverified'])
    assert.equal(events.unmatched, 1)
    const paidUntil = payments.paidUntil(buyerId)

    // The next checks read only new letters; the same letter is never applied twice.
    clock += 60_000
    const again = await call<Mail>('POST', '/accounts/me/admin/bezebee/mail/check', owner)
    assert.equal(again.json.mail.read, 2)
    letters.push(saleLetter({ id: 'sale-1' }))
    await call('POST', '/accounts/me/admin/bezebee/mail/check', owner)
    assert.equal(payments.paidUntil(buyerId), paidUntil)
    assert.equal((await call<Events>('GET', '/accounts/me/admin/bezebee/events', owner)).json.events.length, 2)
    // The password is never sent back.
    const status = await call('GET', '/accounts/me/admin/bezebee/status', owner)
    assert.equal(JSON.stringify(status.json).includes('abcd'), false)
    assert.ok(imap.logins.every((login) => login.startsWith('"raidosapp@gmail.com"')))
    assert.equal(imap.logins.at(-1), '"raidosapp@gmail.com" "abcdefghijklmnop"')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await imap.close()
  }
})
