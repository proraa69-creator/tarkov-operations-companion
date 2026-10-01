import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, dialog, type BrowserWindow } from 'electron'
import { runningBuild } from './localServer.js'

/**
 * Test build for friends (TRIAL_LAUNCHES=2 at build time, see scripts/write-build-info.mjs). It is a separate app:
 * «Raid OS Test» with its own data folder, so it never touches the main version's settings, progress or
 * session. The tester is told on every start that the copy is temporary; after the last allowed launch is closed the
 * exe and the test data folder delete themselves. A tiny counter file stays next to the data folder, so the same exe
 * started again later closes at once. Not a lock against a determined tester: a convenience for short-lived builds.
 */
export const TRIAL_APP_NAME = 'Raid OS Test'
/** The test build's data folder and launch counters keep the name from before the rename to «Raid OS». */
export const TRIAL_DATA_FOLDER = 'Tarkov Operator Test'
let limit = 0
let launch = 0

const counterFile = (build: number) => join(app.getPath('appData'), `${TRIAL_DATA_FOLDER} ${build}.json`)

/** Read before the app picks its data folder (main.ts): the test build must use its own. */
export function trialLaunchesAtStart() {
  try {
    const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'build-info.json')
    return Math.max(0, Math.floor(Number((JSON.parse(readFileSync(file, 'utf8')) as { trialLaunches?: unknown }).trialLaunches) || 0))
  } catch {
    return 0
  }
}

export function isTrialBuild() {
  return limit > 0
}

/** Counts this launch; false when the test period is already over (the app then deletes itself and quits). */
export async function startTrial(window: () => BrowserWindow | null) {
  const info = await runningBuild()
  limit = info.trialLaunches
  if (!limit) return true
  let used = 0
  try { used = Number((JSON.parse(await readFile(counterFile(info.build), 'utf8')) as { used?: unknown }).used) || 0 } catch { /* first launch */ }
  launch = used + 1
  await writeFile(counterFile(info.build), JSON.stringify({ used: launch }), 'utf8').catch(() => {})
  if (launch > limit) {
    await dialog.showMessageBox({ type: 'info', title: 'Raid OS', message: 'Тестовая версия закончилась', detail: 'Эта тестовая копия уже была запущена максимальное число раз и сейчас удалит себя. Попросите новую версию у автора.' })
    deleteExeAfterQuit()
    app.quit()
    return false
  }
  const last = launch === limit
  void dialog.showMessageBox(window() ?? undefined as unknown as BrowserWindow, {
    type: 'info',
    title: 'Raid OS — тестовая версия',
    message: `Тестовая версия: запуск ${launch} из ${limit}`,
    detail: last
      ? 'Это последний запуск. После закрытия тестовая версия удалится сама вместе со своими данными. Основная версия приложения, если она у вас есть, не затрагивается.'
      : `После ${limit}-го закрытия тестовая версия удалится сама вместе со своими данными. Основная версия приложения, если она у вас есть, не затрагивается.`,
  }).catch(() => {})
  return true
}

/** Called on quit: after the last allowed launch the exe is removed once this copy and its launcher have exited. */
export function finishTrial() {
  if (limit && launch >= limit) deleteExeAfterQuit()
}

let scheduled = false

function deleteExeAfterQuit() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE
  if (scheduled || !exe || !existsSync(exe) || process.platform !== 'win32') return
  scheduled = true
  // The exe is locked until the portable launcher exits: a hidden cmd retries for a minute. The path travels in an
  // environment variable so non-Latin folder names survive.
  const script = join(tmpdir(), `tarkov-operator-trial-${process.pid}.cmd`)
  // Only the test app's own data folder, never the main version's (checked by name).
  const data = app.getPath('userData')
  const ownData = basename(data) === TRIAL_DATA_FOLDER ? data : ''
  const body = [
    '@echo off',
    'set n=0',
    ':again',
    'timeout /t 2 /nobreak >nul',
    'del /f /q "%TO_EXE%" >nul 2>&1',
    'if not exist "%TO_EXE%" goto done',
    'set /a n+=1',
    'if %n% lss 30 goto again',
    ':done',
    'if defined TO_DATA rmdir /s /q "%TO_DATA%" >nul 2>&1',
    '(goto) 2>nul & del "%~f0"',
  ].join('\r\n')
  void writeFile(script, body, 'utf8').then(() => {
    spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/c', script], { detached: true, windowsHide: true, stdio: 'ignore', env: { ...process.env, TO_EXE: exe, TO_DATA: ownData } }).unref()
  }).catch(() => {})
}
