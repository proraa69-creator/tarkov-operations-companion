// @vitest-environment node
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ErrorEvent } from './errorReport'

/**
 * electron/selfUpdate.ts on the server laptop: the install-mode default and, after a restart, a helper that is gone
 * without a final result ('helper-lost', with the sanitized tail of update-helper.log in the history and the report).
 */
const state = vi.hoisted(() => ({ dir: '', running: { version: '0.5.4', build: 1000, commit: 'old' } }))
vi.mock('electron', () => ({
  app: { getPath: () => state.dir, getVersion: () => '0.5.4', quit: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() },
}))
vi.mock('./buildEdition.js', () => ({ isOwnerBuild: () => true }))
vi.mock('./localServer.js', () => ({
  apiHealth: async () => null,
  clientPublishDir: () => join(state.dir, 'client'),
  isServerMode: () => true,
  LOCAL_PORTS: { api: 1, site: 1 },
  runningBuild: async () => ({ ...state.running, trialLaunches: 0, edition: 'owner' }),
  serverDataDir: () => join(state.dir, 'server'),
}))
const { selfUpdateSettings, setSelfUpdateSettings, startServerSelfUpdate, stopServerSelfUpdate } = await import('./selfUpdate')

const stateDir = () => join(state.dir, 'server', 'self-update')
const until = async (condition: () => boolean, timeoutMs = 15_000) => {
  const stop = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > stop) throw new Error('timed out')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}
const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8')) as unknown

function hooks() {
  const journal: Array<[string, string]> = []
  const notes: string[] = []
  const reports: ErrorEvent[] = []
  return { journal, notes, reports, value: { journal: (level: 'info' | 'warn' | 'error', text: string) => { journal.push([level, text]) }, notify: (title: string) => { notes.push(title) }, report: (event: ErrorEvent) => { reports.push(event) } } }
}

async function pendingRestart(options: { helper?: number; log?: string; helperPid?: unknown } = {}) {
  await mkdir(stateDir(), { recursive: true })
  const now = Date.now()
  await writeFile(join(stateDir(), 'state.json'), JSON.stringify({
    id: '42', kind: 'update', from: { version: '0.5.4', build: 1000, commit: 'old' }, to: { version: '0.6.0', build: 2000, commit: 'new' },
    startedAt: new Date(now - 600_000).toISOString(), deadlineAt: new Date(now - 400_000).toISOString(), ...(options.helper ? { helper: options.helper } : {}),
  }))
  if (options.log !== undefined) await writeFile(join(stateDir(), 'update-helper.log'), options.log)
  if (options.helperPid !== undefined) await writeFile(join(stateDir(), 'helper.pid'), JSON.stringify(options.helperPid))
}

beforeEach(async () => {
  state.dir = await mkdtemp(join(tmpdir(), 'raidos-selfupdate-app-'))
  state.running = { version: '0.5.4', build: 1000, commit: 'old' }
})
afterEach(async () => {
  stopServerSelfUpdate()
  await rm(state.dir, { recursive: true, force: true })
})

describe('install mode', () => {
  it('is manual by default and for settings saved before the mode existed; an explicit choice is kept', async () => {
    expect(selfUpdateSettings().window).toBe('manual')
    await writeFile(join(state.dir, 'server-update.json'), JSON.stringify({ enabled: false, repo: 'owner/releases' }))
    expect(selfUpdateSettings()).toMatchObject({ window: 'manual', repo: 'owner/releases' })
    await writeFile(join(state.dir, 'server-update.json'), JSON.stringify({ window: 'night' }))
    expect(selfUpdateSettings().window).toBe('night')
    expect((await setSelfUpdateSettings({ window: 'manual' })).window).toBe('manual')
    expect(readJson(join(state.dir, 'server-update.json'))).toMatchObject({ window: 'manual' })
    expect((await setSelfUpdateSettings({ window: 'any' })).window).toBe('any')
    expect((await setSelfUpdateSettings({ window: 'bogus' })).window).toBe('any')
  })
})

describe('after a restart: the helper is gone without a result', () => {
  it('records helper-lost with the sanitized log tail, journals, notifies and reports it; the build is not skipped', async () => {
    const log = [
      '2026-10-02 03:00:00.000 [app] update 0.5.4 (1000) -> 0.6.0 (2000), restart 42: starting the helper; app pid 1 (C:\\Users\\Owner Name\\AppData\\Local\\Temp\\x\\Raid OS.exe)',
      '2026-10-02 03:00:01.000 [helper] started: pid 77, token github_pat_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
      '2026-10-02 03:00:02.000 [helper] waiting for the app to quit: inner pid 1 and the wrapper',
    ].join('\r\n')
    // helper.pid from another restart: this restart's helper never ran (or its pid file is gone).
    await pendingRestart({ helper: 2, log, helperPid: { id: '41', pid: process.pid } })
    const seen = hooks()
    startServerSelfUpdate(seen.value)
    await until(() => !existsSync(join(stateDir(), 'state.json')))
    const history = readJson(join(stateDir(), 'history.json')) as Array<{ result: string; code?: string; reason?: string; log?: string }>
    expect(history[0]).toMatchObject({ result: 'failed', code: 'helper-lost' })
    expect(history[0]!.reason).toMatch(/помощник обновления пропал/)
    expect(history[0]!.log).toContain('waiting for the app to quit')
    expect(history[0]!.log).not.toContain('github_pat_')
    expect(history[0]!.log).not.toContain('Owner Name')
    expect(seen.journal.some(([level, text]) => level === 'error' && /помощник обновления пропал/.test(text))).toBe(true)
    expect(seen.notes).toContain('Обновление сервера не удалось')
    expect(seen.reports).toHaveLength(1)
    expect(seen.reports[0]).toMatchObject({ source: 'update', kind: 'helper-lost', name: 'SelfUpdate:helper-lost' })
    expect(seen.reports[0]!.stack).toContain('update-helper.log (tail)')
    expect(seen.reports[0]!.stack).toContain('waiting for the app to quit')
    // Not the build's fault: «Установить сейчас» may try it again.
    const meta = existsSync(join(stateDir(), 'meta.json')) ? readJson(join(stateDir(), 'meta.json')) as { skipped: number[] } : { skipped: [] }
    expect(meta.skipped).not.toContain(2000)
    // This copy wrote app.pid for the helper; it is cleaned up with the pending state.
    expect(existsSync(join(stateDir(), 'app.pid'))).toBe(false)
  })

  it('waits while the helper is alive (pid runs, log fresh) and records its final result', async () => {
    await pendingRestart({ helper: 2, log: '2026-10-02 03:00:01.000 [helper] probe 1: api-not-responding\r\n', helperPid: { id: '42', pid: process.pid } })
    const seen = hooks()
    startServerSelfUpdate(seen.value)
    await until(() => existsSync(join(stateDir(), 'app.pid')))
    expect(readJson(join(stateDir(), 'app.pid'))).toMatchObject({ pid: process.pid, build: 1000 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(existsSync(join(stateDir(), 'state.json'))).toBe(true)
    expect(existsSync(join(stateDir(), 'history.json'))).toBe(false)
    await writeFile(join(stateDir(), 'result.json'), JSON.stringify({ phase: 'rolled-back', reason: 'site-not-responding', build: 2000, at: new Date().toISOString() }))
    await until(() => !existsSync(join(stateDir(), 'state.json')))
    const history = readJson(join(stateDir(), 'history.json')) as Array<{ result: string; code?: string }>
    expect(history[0]).toMatchObject({ result: 'rolled-back', code: 'site-not-responding' })
    expect((readJson(join(stateDir(), 'meta.json')) as { skipped: number[] }).skipped).toContain(2000)
    expect(seen.reports[0]).toMatchObject({ kind: 'rollback' })
  })

  it('a final result written right before the helper exited wins over helper-lost', async () => {
    await pendingRestart({ helper: 2, log: '' })
    await writeFile(join(stateDir(), 'result.json'), JSON.stringify({ phase: 'ok', build: 2000, at: new Date().toISOString() }))
    state.running = { version: '0.6.0', build: 2000, commit: 'new' }
    const seen = hooks()
    startServerSelfUpdate(seen.value)
    await until(() => !existsSync(join(stateDir(), 'state.json')))
    expect((readJson(join(stateDir(), 'history.json')) as Array<{ result: string }>)[0]!.result).toBe('ok')
    expect(seen.reports).toHaveLength(0)
  })
})
