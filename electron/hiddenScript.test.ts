// @vitest-environment node
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

const spawn = vi.hoisted(() => vi.fn(() => ({ unref: vi.fn() })))
vi.mock('node:child_process', () => ({ spawn }))
vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '' } }))

const { runHiddenScript } = await import('./hiddenScript')
const { relaunchWhenClosed } = await import('./deltaUpdate')

type Call = [string, string[], { detached?: boolean; windowsHide?: boolean; env: Record<string, string> }]
const cleanup = (script: string) => { rmSync(script, { force: true }); rmSync(script.replace(/\.cmd$/, '.vbs'), { force: true }) }

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
        // On Windows: wscript runs the .vbs, which runs cmd hidden (0) and does not wait.
        const vbs = script.replace(/\.cmd$/, '.vbs')
        expect(args).toEqual(['//B', '//Nologo', vbs, script])
        expect(readFileSync(vbs, 'utf8')).toContain('& """", 0, False')
        expect(options.env.RO_HIDDEN_VBS).toBe(vbs)
      } else {
        expect(args).toEqual(['/d', '/c', script])
      }
      expect(readFileSync(script, 'utf8').split('\r\n')).toEqual(['@echo off', 'echo ok', 'del "%RO_HIDDEN_VBS%" >nul 2>&1', '(goto) 2>nul & del "%~f0"'])
    } finally { cleanup(script) }
  })

  it('the restart after an update waits with System32\'s programs and ping, never `timeout` or another `find`', () => {
    const script = relaunchWhenClosed('C:\\Игры\\Raid OS.exe')
    try {
      const text = readFileSync(script, 'utf8')
      expect(text).toContain('%SystemRoot%\\System32\\tasklist.exe')
      expect(text).toContain('| %SystemRoot%\\System32\\find.exe " %RO_PID% "')
      expect(text).toContain('%SystemRoot%\\System32\\PING.EXE -n 2 127.0.0.1 >nul')
      expect(text).not.toMatch(/\btimeout\b/)
      const [, , options] = spawn.mock.calls.at(-1) as unknown as Call
      expect(options.env.RO_EXE).toBe('C:\\Игры\\Raid OS.exe')
    } finally { cleanup(script) }
    expect(existsSync(script)).toBe(false)
  })
})
