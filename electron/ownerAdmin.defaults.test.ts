// @vitest-environment node
import { mkdtemp, writeFile } from 'node:fs/promises'
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
