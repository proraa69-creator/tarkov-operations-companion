import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AccountStore } from './accountStore.js'
import { openDatabase } from './database.js'

// Owner, 12.11.2026: the Apple reviewer's test account — «там не должно быть не единого упоминания о платной подписке».
test('an account listed in TARKOV_STORE_REVIEW_EMAILS is marked storeReview, any other is not', async () => {
  const accounts = new AccountStore({ db: openDatabase(':memory:'), ownerEmails: [], storeReviewEmails: ['AppleTest@Example.com'] })
  const review = accounts.authenticate((await accounts.register('appletest@example.com', 'correct horse battery')).token)!
  const player = accounts.authenticate((await accounts.register('player@example.com', 'correct horse battery')).token)!
  assert.equal(accounts.view(review).storeReview, true)
  assert.equal(accounts.view(player).storeReview, undefined)
  // «будто у него почта подтверждена»: confirmed without a code; the player's is not.
  assert.ok(accounts.view(review).emailVerifiedAt)
  assert.equal(accounts.isEmailVerified(review), true)
  assert.equal(accounts.view(player).emailVerifiedAt, undefined)
})

// Owner, 13.11.2026: «сними блокировку по аккаунту таркова для админа и apple test аккаунта» — the reviewer's account is
// signed in on the owner's PC, whose game account the owner's account holds.
test('the reviewer\'s account is never refused for a game account, and takes none', async () => {
  const accounts = new AccountStore({ db: openDatabase(':memory:'), ownerEmails: [], storeReviewEmails: ['appletest@example.com'] })
  const holder = accounts.authenticate((await accounts.register('holder@example.com', 'correct horse battery')).token)!
  const review = accounts.authenticate((await accounts.register('appletest@example.com', 'correct horse battery')).token)!
  const player = accounts.authenticate((await accounts.register('player@example.com', 'correct horse battery')).token)!
  accounts.bindEftAccount(holder, '1234289')
  assert.doesNotThrow(() => accounts.bindEftAccount(review, '1234289'))
  assert.equal(accounts.view(review).eftAccount, undefined)
  assert.doesNotThrow(() => accounts.bindEftAccount(review, '7777001'))
  assert.equal(accounts.view(review).eftAccount, undefined, 'a free game account stays free too')
  assert.throws(() => accounts.bindEftAccount(player, '1234289'), /уже используется/)
})
