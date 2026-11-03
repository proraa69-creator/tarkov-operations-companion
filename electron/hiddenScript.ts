import { spawn } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * A small cmd script that outlives the app (the update's swap and restart), with no window at all (owner, 31.10.2026:
 * «после нажатия установить обновление появляется консоль пустая с бесконечным ожиданием с надписью find 19156 пока ее не
 * закроешь, приложение не запустится»).
 *
 * It must be detached: Node ends its other children with the app (a job object). But a detached cmd has no console, so
 * every program it starts (tasklist, find, timeout) opened a console window of its own — visible, and `find` waited
 * there for ever. So the detached process is Windows Script Host (a program without a console), which starts cmd with
 * its window hidden (`Run …, 0`): one invisible console for the script and everything it starts. Without wscript (turned
 * off on some PCs) cmd is started detached as before. The script uses only cmd itself and System32's programs by their
 * full path (another `find` on PATH — Git's — is not the one meant); `ping` waits a second where `timeout` refuses to work
 * without a keyboard.
 */
export const SYSTEM32 = '%SystemRoot%\\System32'
/** One second's pause that works in a hidden console. */
export const PAUSE_1S = `${SYSTEM32}\\PING.EXE -n 2 127.0.0.1 >nul`

/** Windows Script Host: start cmd hidden with the script (its path is the first argument), do not wait. */
const RUN_HIDDEN_VBS = [
  'Set shell = CreateObject("WScript.Shell")',
  'shell.Run """" & shell.ExpandEnvironmentStrings("%ComSpec%") & """ /d /c """ & WScript.Arguments(0) & """", 0, False',
].join('\r\n')

export function runHiddenScript(name: string, lines: string[], env: Record<string, string>) {
  const script = join(tmpdir(), name)
  const vbs = script.replace(/\.cmd$/i, '') + '.vbs'
  writeFileSync(script, ['@echo off', ...lines, 'del "%RO_HIDDEN_VBS%" >nul 2>&1', '(goto) 2>nul & del "%~f0"'].join('\r\n'), 'utf8')
  const wscript = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'wscript.exe')
  const viaWsh = existsSync(wscript)
  if (viaWsh) writeFileSync(vbs, RUN_HIDDEN_VBS, 'utf8')
  const [command, args] = viaWsh
    ? [wscript, ['//B', '//Nologo', vbs, script]]
    : [process.env.ComSpec || 'cmd.exe', ['/d', '/c', script]]
  const child = spawn(command, args, {
    detached: true,
    windowsHide: true,
    stdio: 'ignore',
    env: { ...process.env, ...env, RO_HIDDEN_VBS: viaWsh ? vbs : '' },
  })
  child.unref()
  return script
}
