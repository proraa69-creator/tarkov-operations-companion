import { isOwnerApp } from '../app/buildEdition'
import { isDesktopShell } from '../platform'
import { usesWebAccount } from '../sync/serverSync'

/**
 * Which apps open the account window by themselves while nobody is signed in: the players' desktop app, the owner's
 * desktop app (except the server laptop started with --server-mode, which nobody plays on) and the phone app.
 * A desktop browser tab without the shell has no account and never shows it.
 */
export function accountGateEnabled() {
  if (isDesktopShell()) return !isOwnerApp() || window.tarkovDesktop?.serverMode !== true
  return usesWebAccount()
}
