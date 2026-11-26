import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, shell } from 'electron'

/**
 * One «Raid OS» in the Start menu (report 252, 27.11.2026: «После обновления в пуске появился еще один ярлык, оба запускают одну
 * и ту же копию приложения»). Electron's notifications (Electron 44, shell/browser/notifications/win/windows_toast_activator.cc
 * EnsureShortcut, run once the notification presenter is first used) write %APPDATA%\Microsoft\Windows\Start Menu\Programs\
 * <app name>.lnk with the app's AppUserModelID and toast activator, and write it again whenever its exe, folder, ID or activator
 * differ. The app named no ID, so Electron's default «electron.app.Raid OS» went there, while the installer's shortcut
 * (ProgramData, electron-builder's WinShell::SetLnkAUMI) carries package.json build.appId; Windows lists apps by that ID
 * (shell:AppsFolder), so the Start menu showed «Raid OS» twice. With the installer's ID both shortcuts are the same app: one
 * entry, and notifications keep their shortcut. Test and trial builds keep Electron's own ID (they run beside the real app as
 * apps of their own), and so does a run from the sources.
 */
export const APP_USER_MODEL_ID = 'local.tarkov.operations.companion'

/** The installer's ID for the real app on Windows; called before anything shows a notification. Whether it was set. */
export function applyInstallerIdentity(realApp: boolean) {
  if (process.platform !== 'win32' || !app.isPackaged || !realApp) return false
  app.setAppUserModelId(APP_USER_MODEL_ID)
  return true
}

/**
 * At the start (the player was told «лишний ярлык уберётся сам»): the shortcut Electron wrote under its old ID goes, and so does
 * one of ours whose exe is gone (a portable copy's %TEMP%\nsXXXX.tmp\app, removed when it closed). Only that one file: the
 * installer's shortcut lies in another folder, and a shortcut without one of these IDs is the player's own. Electron writes a
 * fresh one, with the installer's ID, when a notification is next shown. Whether a shortcut went.
 */
export function removeStaleStartMenuShortcut() {
  if (process.platform !== 'win32') return false
  const file = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${app.getName()}.lnk`)
  if (!existsSync(file)) return false
  let link: Electron.ShortcutDetails
  try {
    link = shell.readShortcutLink(file)
  } catch {
    return false // not a shortcut Windows can read: not ours to judge
  }
  const electronDefault = link.appUserModelId === `electron.app.${app.getName()}`
  const lostExe = link.appUserModelId === APP_USER_MODEL_ID && Boolean(link.target) && !existsSync(link.target)
  if (!electronDefault && !lostExe) return false
  try {
    rmSync(file, { force: true })
    return true
  } catch {
    return false // held or not ours to remove: the next start tries again
  }
}
