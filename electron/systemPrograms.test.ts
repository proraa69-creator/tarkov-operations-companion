// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Security review, 27.11.2026: the app runs with administrator rights, so which program it starts must not depend on PATH
 * or %SystemRoot%. Every System32 program the app asks something of is named by its full path from
 * electron/windowsSystem.ts, whatever PATH and %SystemRoot% say.
 */
const execFile = vi.hoisted(() => vi.fn((_file: string, _args: string[], _options: unknown, done: (error: Error | null, stdout: string) => void) => done(null, '')))
vi.mock('node:child_process', () => ({ execFile }))

const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const saved = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH }
Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
afterAll(() => {
  Object.defineProperty(process, 'platform', platform)
  for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value }
})

const { systemProgram } = await import('./windowsSystem')
const { isTarkovRunning } = await import('./gameProcess')
const { listeningPid, processImage } = await import('./staleServer')
const { registeredGameFolders } = await import('./logDiscovery')

const programs = () => execFile.mock.calls.map(([file]) => file)

beforeEach(() => {
  execFile.mockClear()
  process.env.SystemRoot = 'C:\\Users\\p\\fake'
  process.env.PATH = `C:\\Users\\p\\fake;${saved.PATH ?? ''}`
})

describe('System32\'s programs by their full path', () => {
  it('the game check asks tasklist.exe of System32', async () => {
    await isTarkovRunning()
    expect(programs()).toEqual([systemProgram('tasklist.exe')])
  })

  it('the old server on the API port: netstat.exe and tasklist.exe of System32', async () => {
    await listeningPid(8787)
    await processImage(4321)
    expect(programs()).toEqual([systemProgram('NETSTAT.EXE'), systemProgram('tasklist.exe')])
  })

  it('the game folders Windows knows: reg.exe of System32', async () => {
    await registeredGameFolders()
    expect(programs().length).toBeGreaterThan(0)
    expect(new Set(programs())).toEqual(new Set([systemProgram('reg.exe')]))
  })

  it('never a bare name and never the environment\'s folder', async () => {
    await isTarkovRunning()
    await listeningPid(8787)
    await registeredGameFolders()
    for (const file of programs()) {
      expect(file).toMatch(/^[A-Za-z]:\\/)
      expect(file).not.toMatch(/fake/)
    }
  })

  // The same for code written later: Windows' folders come from electron/windowsSystem.ts only. The Linux server's updater
  // (electron/linux, run by systemd with its own PATH) and the API's allowlist of variables (apiEnv.ts) are not about this.
  it('no main-process file takes Windows\' folders from the environment or starts a program by a bare name', () => {
    const root = dirname(fileURLToPath(import.meta.url))
    const sources = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((name) => /\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/^linux[\\/]/.test(name) && !['windowsSystem.ts', 'apiEnv.ts'].includes(name))
    expect(sources.length).toBeGreaterThan(50)
    const found: string[] = []
    for (const name of sources) {
      const text = readFileSync(join(root, name), 'utf8')
      const lines = text.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (/process\.env\.(?:SystemRoot|SYSTEMROOT|windir|WINDIR|ComSpec|COMSPEC|ProgramFiles|PROGRAMFILES|SystemDrive)\b|process\.env\[['"](?:SystemRoot|windir|ComSpec|ProgramFiles)/.test(line)) found.push(`${name}:${index + 1} ${line.trim()}`)
        if (/%(?:SystemRoot|windir|ComSpec)%/i.test(line) && !/^\s*(?:\*|\/\/|\/\*)/.test(line)) found.push(`${name}:${index + 1} ${line.trim()}`)
        if (/\b(?:execFile|execFileSync|spawn|spawnSync|exec|execSync)\(\s*['"`][\w.-]+['"`]/.test(line)) found.push(`${name}:${index + 1} ${line.trim()}`)
        if (/\(\s*['"`](?:reg|netstat|tasklist|taskkill|powershell|pwsh|cmd|wscript|cscript|powercfg|find|ping|schtasks|icacls|whoami|where|wmic|sc)(?:\.exe)?['"`]\s*,/i.test(line)) found.push(`${name}:${index + 1} ${line.trim()}`)
      })
    }
    expect(found).toEqual([])
  })
})
