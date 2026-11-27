// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

/**
 * Security review, 27.11.2026: the server laptop's update helper (electron/selfUpdate.ts) runs with the app's
 * administrator rights. It is started by System32's PowerShell and cmd by their full path, and its environment carries
 * Windows' own %SystemRoot%, %windir%, %ComSpec% and PSModulePath, whatever the app's environment says.
 */
vi.mock('electron', () => ({
  app: { getPath: () => '', getVersion: () => '0.5.4', quit: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => true }))
vi.mock('./localServer.js', () => ({ apiHealth: async () => null, clientPublishDir: () => '', isServerMode: () => true, LOCAL_PORTS: { api: 1, site: 1 }, runningBuild: async () => ({}), serverDataDir: () => '' }))

const { helperBaseEnvironment, helperPrograms } = await import('./selfUpdate')
const { powershellExe, systemEnvironment, systemProgram } = await import('./windowsSystem')

describe('the update helper\'s programs and environment', () => {
  it('PowerShell and cmd of System32 by their full path', () => {
    expect(helperPrograms()).toEqual({ powershell: powershellExe(), cmd: systemProgram('cmd.exe') })
  })

  it('keeps the basics it always had, with Windows\' own system variables', () => {
    const env = helperBaseEnvironment({
      SystemRoot: 'C:\\Users\\p\\fake', windir: 'C:\\Users\\p\\fake', ComSpec: 'C:\\Users\\p\\fake\\cmd.exe',
      PSModulePath: 'C:\\Users\\p\\Documents\\WindowsPowerShell\\Modules', PATH: 'C:\\Windows\\system32', TEMP: 'C:\\t', SECRET_OF_THE_APP: 'x',
    })
    expect(env).toEqual({ PATH: 'C:\\Windows\\system32', TEMP: 'C:\\t', ...systemEnvironment() })
    expect(JSON.stringify(env)).not.toMatch(/fake|Documents/)
  })
})
