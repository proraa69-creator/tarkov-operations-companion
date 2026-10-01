// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * Registration from the app's account window against real API servers (server/src/app.ts on random ports): one with
 * e-mail codes on (202 → the code → a session), one without (a session right away). The session token stays in the
 * main process; the renderer only gets the status. The register paths that return a session are not on the
 * renderer's whitelist; «Отправить код ещё раз» and the consent record are.
 */
const state = vi.hoisted(() => ({ dir: '', remote: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir },
  safeStorage: { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text', encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => false, buildDefaultServerUrl: () => state.remote }))
vi.mock('./localServer.js', () => ({ localServerEnabled: async () => false }))

const { accountLogout, accountRegister, accountRegisterConfirm, serviceRequest, setServerUrl } = await import('./serviceGateway')
const { createApi } = await import('../server/src/app')
const { AccountStore } = await import('../server/src/services/accountStore')
const { ProgressStore } = await import('../server/src/services/progressStore')
const { EmailAuthService } = await import('../server/src/services/emailAuth')
const { FakeEmailSender } = await import('../server/src/services/email/index')

const password = 'correct horse battery'
const sender = new FakeEmailSender()
const codedAccounts = new AccountStore({ ownerEmails: [] })
const emails = new EmailAuthService(codedAccounts, { sender })
let withCodes: Server
let withoutCodes: Server
const listen = async (server: Server) => {
  await new Promise<void>((resolve) => server.on('listening', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}
let codesUrl = ''
let plainUrl = ''

beforeAll(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-register-'))
  withCodes = createApi(new ProgressStore(':memory:'), undefined, codedAccounts, { emails }).listen(0, '127.0.0.1')
  codesUrl = await listen(withCodes)
  withoutCodes = createApi(new ProgressStore(':memory:'), undefined, new AccountStore({ ownerEmails: [] })).listen(0, '127.0.0.1')
  plainUrl = await listen(withoutCodes)
})

afterAll(async () => {
  await new Promise<void>((resolve) => withCodes.close(() => resolve()))
  await new Promise<void>((resolve) => withoutCodes.close(() => resolve()))
})

describe('registration from the app', () => {
  it('without e-mail codes: signs in right away and records the consent', async () => {
    state.remote = plainUrl
    await setServerUrl('')
    const result = await accountRegister('New@Example.com', password)
    expect(result.pending).toBeUndefined()
    if (!('status' in result)) throw new Error('expected a session')
    expect(result.status).toMatchObject({ signedIn: true, email: 'new@example.com', online: true })
    const consents = await serviceRequest('POST', '/v1/accounts/me/consents', { kind: 'registration', version: '2026-10-01.2' }) as { consents: Array<{ version: string }> }
    expect(consents.consents.map((entry) => entry.version)).toContain('2026-10-01.2')
    await accountLogout()
  })

  it('with e-mail codes: 202 first, then the code from the e-mail creates the account', async () => {
    state.remote = codesUrl
    await setServerUrl('')
    const result = await accountRegister('coded@example.com', password, 'NO_SUCH_CODE')
    if (!('pending' in result)) throw new Error('expected a pending registration')
    expect(result.pending.challengeId).toMatch(/^[A-Za-z0-9_-]{32}$/)
    await emails.settled()
    // «Отправить код ещё раз» reaches the server through the whitelist (the cooldown answers here, right after the send).
    await expect(serviceRequest('POST', '/v1/accounts/register/resend', { challengeId: result.pending.challengeId })).rejects.toThrow(/через \d+ с/)
    await expect(accountRegisterConfirm(result.pending.challengeId, '12345')).rejects.toThrow('Код из письма — 6 цифр')
    const confirmed = await accountRegisterConfirm(result.pending.challengeId, sender.lastCode('coded@example.com'))
    expect(confirmed.status).toMatchObject({ signedIn: true, email: 'coded@example.com' })
    expect(confirmed.referralApplied).toBe(false)
    await accountLogout()
  })

  it('checks the input before calling the server and keeps the session paths off the whitelist', async () => {
    await expect(accountRegister('not-an-email', password)).rejects.toThrow('Введите корректный e-mail')
    await expect(accountRegister('a@example.com', 'short')).rejects.toThrow('Пароль: от 8 до 128 символов')
    await expect(accountRegister('a@example.com', password, 'bad code!')).rejects.toThrow('Код приглашения')
    await expect(serviceRequest('POST', '/v1/accounts/register', { email: 'x@example.com', password })).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('POST', '/v1/accounts/register/confirm', {})).rejects.toThrow('Неизвестный запрос сервиса')
    await expect(serviceRequest('POST', '/v1/accounts/register/resend/x', {})).rejects.toThrow('Неизвестный запрос сервиса')
  })
})
