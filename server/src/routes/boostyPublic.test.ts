import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { BoostyPayments } from '../services/boosty.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/** raidos.app/boosty (owner, 17.10.2026): every Boosty subscription without an account, for the public page. */
test('/payments/boosty/public lists the four Boosty subscriptions without an account', async () => {
  const db = openDatabase(':memory:')
  const accounts = new AccountStore({ db, ownerEmails: [] })
  const payments = new PaymentStore(db, undefined)
  const server = createApi(new ProgressStore(':memory:'), undefined, accounts, { payments, boosty: new BoostyPayments(accounts, payments) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/payments`
  try {
    const response = await fetch(`${base}/boosty/public`, { headers: { 'cf-ipcountry': 'KZ' } })
    assert.equal(response.status, 200)
    const body = await response.json() as { offers: Array<{ key: string; region: string; kind: string; url: string }>; regionHint?: string }
    assert.deepEqual(body.offers.map((offer) => offer.key).sort(), ['CIS_FRIEND', 'CIS_STANDARD', 'WORLD_FRIEND', 'WORLD_STANDARD'])
    for (const offer of body.offers) assert.match(offer.url, /^https:\/\/boosty\.to\/raidosapp\/purchase\/\d+\?/)
    assert.equal(body.regionHint, 'CIS')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
