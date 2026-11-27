// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '' } }))

const { runHiddenScript } = await import('./hiddenScript')
const { relaunchWhenClosed } = await import('./deltaUpdate')
const { systemProgram, windowsDirectory } = await import('./windowsSystem')

type Call = [string, string[], { detached?: boolean; windowsHide?: boolean; env: Record<string, string> }]
const cleanup = (script: string) => { rmSync(script, { force: true }); rmSync(script.replace(/\.cmd$/, '.vbs'), { force: true }) }
const saved = { SystemRoot: process.env.SystemRoot, ComSpec: process.env.ComSpec }
afterEach(() => { for (const [name, value] of Object.entries(saved)) { if (value === undefined) delete process.env[name]; else process.env[name] = value } })

// Owner, 31.10.2026: «после нажатия установить обновление появляется консоль пустая с бесконечным ожиданием с надписью
// find 19156 пока ее не закроешь, приложение не запустится».
describe('the update\'s helper script', () => {
  it('outlives the app (detached) through Windows Script Host, which starts cmd with its window hidden', () => {
    const script = runHiddenScript(`raidos-test-${process.pid}.cmd`, ['echo ok'], { RO_X: '1' })
    try {
      const [command, args, options] = spawn.mock.calls.at(-1) as unknown as Call
      expect(options).toMatchObject({ detached: true, windowsHide: true })
      expect(options.env.RO_X).toBe('1')
      if (command.toLowerCase().endsWith('wscript.exe')) {
        // On Windows: wscript runs the .vbs, which runs cmd (its full path, the last argument) hidden (0) and does not wait.
        const vbs = script.replace(/\.cmd$/, '.vbs')
        expect(command).toBe(systemProgram('wscript.exe'))
        expect(args).toEqual(['//B', '//Nologo', vbs, script, systemProgram('cmd.exe')])
        expect(readFileSync(vbs, 'utf8')).toContain('shell.Run """" & WScript.Arguments(1) & """ /d /c """ & WScript.Arguments(0) & """", 0, False')
        expect(options.env.RO_HIDDEN_VBS).toBe(vbs)
      } else {
        expect(command).toBe(systemProgram('cmd.exe'))
        expect(args).toEqual(['/d', '/c', script])
      }
      expect(readFileSync(script, 'utf8').split('\r\n')).toEqual(['@echo off', 'echo ok', 'del "%RO_HIDDEN_VBS%" >nul 2>&1', '(goto) 2>nul & del "%~f0"'])
    } finally { cleanup(script) }
  })

  // Security review, 03.11.2026: the app runs as administrator, so a script the player's other programs could rewrite
  // during its pauses would run their commands as administrator.
  it('goes to Windows\' own Temp under a name never used before, not to the user\'s %TEMP%', () => {
    const first = runHiddenScript('raidos-test.cmd', ['echo 1'], {})
    const second = runHiddenScript('raidos-test.cmd', ['echo 2'], {})
    try {
      expect(first).not.toBe(second)
      expect(first).toMatch(/raidos-test-[0-9a-f-]{36}\.cmd$/)
      if (process.platform === 'win32') expect(dirname(first).toLowerCase()).toBe(join(windowsDirectory(), 'Temp').toLowerCase())
      expect(readFileSync(second, 'utf8')).toContain('echo 2')
    } finally { cleanup(first); cleanup(second) }
  })

  it('the restart after an update waits with System32\'s programs and ping, never `timeout` or another `find`', () => {
    const script = relaunchWhenClosed('C:\\Игры\\Raid OS.exe')
    try {
      const text = readFileSync(script, 'utf8')
      expect(text).toContain(`"${systemProgram('tasklist.exe')}" /FI "PID eq %RO_PID%" /NH 2>nul`)
      expect(text).toContain(`| "${systemProgram('find.exe')}" " %RO_PID% " >nul || goto run`)
      expect(text).toContain(`"${systemProgram('PING.EXE')}" -n 2 127.0.0.1 >nul`)
      expect(text).not.toMatch(/\btimeout\b/)
      const [, , options] = spawn.mock.calls.at(-1) as unknown as Call
      expect(options.env.RO_EXE).toBe('C:\\Игры\\Raid OS.exe')
    } finally { cleanup(script) }
    expect(existsSync(script)).toBe(false)
  })

  // Security review, 27.11.2026: the app runs with administrator rights, so %SystemRoot% and %ComSpec% must not decide
  // which programs its scripts run.
  it('names Windows\' own programs whatever %SystemRoot% and %ComSpec% say, and hands the script Windows\' own values', () => {
    process.env.SystemRoot = 'C:\\Users\\p\\fake'
    process.env.ComSpec = 'C:\\Users\\p\\fake\\cmd.exe'
    const script = relaunchWhenClosed('C:\\Games\\Raid OS.exe')
    try {
      const text = readFileSync(script, 'utf8')
      expect(text).not.toMatch(/fake|%SystemRoot%|%ComSpec%/i)
      const [command, args, options] = spawn.mock.calls.at(-1) as unknown as Call
      expect(`${command} ${args.join(' ')}`).not.toMatch(/fake/)
      expect(options.env.SystemRoot).toBe(windowsDirectory())
      expect(options.env.ComSpec).toBe(systemProgram('cmd.exe'))
      expect(Object.keys(options.env).filter((name) => name.toLowerCase() === 'systemroot')).toEqual(['SystemRoot'])
    } finally { cleanup(script) }
  })
})
