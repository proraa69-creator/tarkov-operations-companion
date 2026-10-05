// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/** TARKOV_PUBLIC_URL for the API process (return links to the public site): always set by the app, never taken from a request. */
const tunnel = vi.hoisted(() => ({ permanent: '', status: { state: 'off', autoStart: false } as { state: string; url?: string; autoStart: boolean } }))
vi.mock('electron', () => ({ app: { getPath: () => '', getVersion: () => '0.0.0' }, utilityProcess: {}, safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('./publicTunnel.js', () => ({ publicSiteUrl: async () => tunnel.permanent, tunnelStatus: async () => tunnel.status }))
const { apiPublicUrl } = await import('./localServer')

describe('apiPublicUrl', () => {
  it('is the permanent address, else the free link while it is on, else this PC\'s site', async () => {
    tunnel.permanent = 'https://raidos.app'
    tunnel.status = { state: 'on', url: 'https://abc-def.trycloudflare.com', autoStart: true }
    expect(await apiPublicUrl()).toBe('https://raidos.app')
    tunnel.permanent = ''
    expect(await apiPublicUrl()).toBe('https://abc-def.trycloudflare.com')
    tunnel.status = { state: 'starting', autoStart: true }
    expect(await apiPublicUrl()).toBe('http://127.0.0.1:5202')
  })
})
