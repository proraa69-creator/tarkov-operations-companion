/**
 * Which desktop app this is (electron/buildEdition.ts, fixed when the exe is built):
 * - 'owner': «Аккаунт сервера», the «Сервер» button, server / tunnel / payments / streamers controls;
 * - 'client' (default, also the phone app and a browser): the players' app with «Личный кабинет».
 */
export type AppEdition = 'owner' | 'client'

export function appEdition(): AppEdition {
  return typeof window !== 'undefined' && window.tarkovDesktop?.edition === 'owner' ? 'owner' : 'client'
}

export const isOwnerApp = () => appEdition() === 'owner'
