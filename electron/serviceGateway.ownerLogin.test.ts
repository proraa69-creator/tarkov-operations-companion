// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * The owner's second factor from the PC app against a real API server (server/src/app.ts on a random port) that sends
 * e-mail codes (owner, 27.11.2026): the right password answers 202, the app shows the code step, and only the code from
 * the e-mail gives this PC a session — kept in this process, never in the renderer. The code itself has its own IPC;
 * only «Отправить код ещё раз» is on the renderer's whitelist. Players sign in as before.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.6.0-354' },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => true, buildDefaultServerUrl: () => state.remote, buildEntitlementKeys: () => ({}) }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogin, accountLoginConfirm, accountLogout, accountStatus, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore, newPasswordHash } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { EmailAuthService } = await import('../server/src/services/emailAuth')
const { FakeEmailSender } = await import('../server/src/services/email/index')

const OWNER = 'owner@example.com'
const PLAYER = 'player@example.com'
const password = 'correct horse battery'
const sender = new FakeEmailSender()
const accounts = new AccountStore({ ownerEmails: [OWNER] })
const emails = new EmailAuthService(accounts, { sender })
let server: Server

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-owner-login-'))
  const { salt, hash } = await newPasswordHash(password)
  accounts.createVerifiedAccount(OWNER, salt, hash)
  await accounts.register(PLAYER, password, undefined, undefined, 'DE')
  server = createApi(new ProgressStore(':memory:'), undefined, accounts, { emails }).listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.on('listening', resolve))
  state.remote = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  await setServerUrl('')
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe('the owner\'s sign-in from the PC app', () => {
  it('the right password: the code step, still signed out; the code from the e-mail signs this PC in', async () => {
    const first = await accountLogin('Owner@Example.com', password)
    expect(first.signedIn).toBe(false)
    expect(first.secondFactor).toMatchObject({ resendSeconds: 60, message: 'Мы отправили код на почту. Введите его, чтобы войти.' })
    expect(first.secondFactor!.challengeId).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(JSON.stringify(first)).not.toMatch(/token/i)
    expect((await accountStatus()).signedIn).toBe(false)
    // «Отправить код ещё раз» reaches the server through the whitelist (its cooldown answers right after the first code).
    await expect(serviceRequest('POST', '/v1/accounts/login/resend', { challengeId: first.secondFactor!.challengeId })).rejects.toThrow(/через \d+ с/)
    await expect(accountLoginConfirm(first.secondFactor!.challengeId, '12345')).rejects.toThrow('Код из письма — 6 цифр')
    await expect(accountLoginConfirm(first.secondFactor!.challengeId, sender.lastCode(OWNER) === '000000' ? '111111' : '000000')).rejects.toThrow(/Неверный или устаревший код/)
    const status = await accountLoginConfirm(first.secondFactor!.challengeId, sender.lastCode(OWNER))
    expect(status).toMatchObject({ signedIn: true, email: OWNER, online: true })
    expect(await serviceRequest('GET', '/v1/accounts/me')).toMatchObject({ email: OWNER, owner: true })
    // The notice after the sign-in names this app.
    await emails.settled()
    expect(sender.to(OWNER).at(-1)!.text).toMatch(/Устройство: Raid OS для Windows 0\.6\.0-354/)
    await accountLogout()
  })

  it('a player signs in at once, as before', async () => {
    const status = await accountLogin(PLAYER, password)
    expect(status.secondFactor).toBeUndefined()
    expect(status).toMatchObject({ signedIn: true, email: PLAYER })
    await accountLogout()
  })

  it('the code that returns a session is off the renderer\'s whitelist', async () => {
    await expect(serviceRequest('POST', '/v1/accounts/login/confirm', { challengeId: 'A'.repeat(32), code: '123456' })).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('POST', '/v1/accounts/login', { email: OWNER, password })).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('GET', '/v1/accounts/login/resend')).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(accountLoginConfirm('short', '123456')).rejects.toThrow('Запросите код ещё раз')
  })
})
