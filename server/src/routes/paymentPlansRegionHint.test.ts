import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { createApi } from '../app.js'
import { AccountStore } from '../services/accountStore.js'
import { openDatabase } from '../services/database.js'
import { PaymentStore } from '../services/paymentStore.js'
import { ProgressStore } from '../services/progressStore.js'

/** «Подписка» opens on the visitor's region (owner, 16.10.2026): /payments/plans names it from Cloudflare's CF-IPCountry. */
test('/payments/plans names the region Cloudflare places the visitor in, and nothing without the header', async () => {
  const db = openDatabase(':memory:')
  const server = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ db, ownerEmails: [] }), { payments: new PaymentStore(db, undefined) }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  const hint = async (country?: string) => {
    const response = await fetch(`${base}/payments/plans`, { headers: country ? { 'cf-ipcountry': country } : {} })
    assert.equal(response.status, 200)
    assert.match(response.headers.get('vary') ?? '', /CF-IPCountry/i)
    return ((await response.json()) as { regionHint?: string }).regionHint
  }
  try {
    assert.equal(await hint('RU'), 'RU')
    assert.equal(await hint('KZ'), 'CIS')
    assert.equal(await hint('DE'), 'WORLD')
    assert.equal(await hint(), undefined)
    assert.equal(await hint('XX'), undefined)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
