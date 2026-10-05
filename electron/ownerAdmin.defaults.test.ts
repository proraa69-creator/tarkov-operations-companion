// @vitest-environment node
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/** «E-mail владельца»: the build's OWNER_EMAILS are the default until the owner saves other e-mails in the panel. */
const state = vi.hoisted(() => ({ dir: '' }))
vi.mock('electron', () => ({ app: { getPath: () => state.dir }, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('./buildEdition.js', () => ({ buildOwnerEmails: () => ['owner@example.com'] }))
const { apiEnvironment, ownerEmails } = await import('./ownerAdmin')

beforeAll(async () => { state.dir = await mkdtemp(join(tmpdir(), 'raidos-owner-')) })

describe('owner e-mails', () => {
  it('uses the build default when nothing is saved, and passes it to the API process', async () => {
    expect(await ownerEmails()).toEqual(['owner@example.com'])
    expect((await apiEnvironment('')).TARKOV_OWNER_EMAILS).toBe('owner@example.com')
  })

  it('prefers e-mails saved in the panel; an empty saved list falls back to the default', async () => {
    await writeFile(join(state.dir, 'owner.json'), JSON.stringify({ emails: ['boss@example.com'] }))
    expect(await ownerEmails()).toEqual(['boss@example.com'])
    await writeFile(join(state.dir, 'owner.json'), JSON.stringify({ emails: [] }))
    expect(await ownerEmails()).toEqual(['owner@example.com'])
  })
})

describe('streamer share (TARKOV_STREAMER_PERCENT)', () => {
  it('is always passed to the API process, 10 % by default', async () => {
    const { streamerShareSettings } = await import('./ownerAdmin')
    expect(await streamerShareSettings()).toEqual({ streamerPercent: 10 })
    expect((await apiEnvironment('')).TARKOV_STREAMER_PERCENT).toBe('10')
  })

  it('reads the value saved by older versions and passes nothing of the former payment settings', async () => {
    const { streamerShareSettings } = await import('./ownerAdmin')
    await writeFile(join(state.dir, 'payments.json'), JSON.stringify({ shopId: '123456', monthPrice: 299, receipts: true, streamerPercent: 15, autopay: true }))
    expect(await streamerShareSettings()).toEqual({ streamerPercent: 15 })
    const environment = await apiEnvironment('https://raidos.app')
    expect(Object.keys(environment).sort()).toEqual(['TARKOV_ADMIN_TOKEN', 'TARKOV_OWNER_EMAILS', 'TARKOV_PUBLIC_URL', 'TARKOV_STREAMER_PERCENT'])
    expect(environment.TARKOV_STREAMER_PERCENT).toBe('15')
    expect(environment.TARKOV_PUBLIC_URL).toBe('https://raidos.app')
  })

  it('saves 0–100 in the same file, keeping its other fields, and refuses anything else', async () => {
    const { setStreamerShare } = await import('./ownerAdmin')
    await writeFile(join(state.dir, 'payments.json'), JSON.stringify({ shopId: '123456', streamerPercent: 15 }))
    expect(await setStreamerShare({ streamerPercent: 12.34 })).toEqual({ streamerPercent: 12.3 })
    expect(JSON.parse(await readFile(join(state.dir, 'payments.json'), 'utf8'))).toEqual({ shopId: '123456', streamerPercent: 12.3 })
    expect((await apiEnvironment('')).TARKOV_STREAMER_PERCENT).toBe('12.3')
    expect(await setStreamerShare({ streamerPercent: 0 })).toEqual({ streamerPercent: 0 })
    for (const bad of [-1, 101, 'abc', '', null, undefined]) await expect(setStreamerShare({ streamerPercent: bad })).rejects.toThrow('от 0 до 100')
    expect((await apiEnvironment('')).TARKOV_STREAMER_PERCENT).toBe('0')
  })
})
