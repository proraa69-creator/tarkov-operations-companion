/**
 * Personal account on the project website. The website runs on the owner's PC (scripts/start-local.ps1,
 * docs/local-server.md); set VITE_ACCOUNT_URL / VITE_REGISTER_URL at build time to point elsewhere.
 */
export const ACCOUNT_URL: string = import.meta.env.VITE_ACCOUNT_URL ?? 'http://localhost:5202/cabinet'
export const REGISTER_URL: string = import.meta.env.VITE_REGISTER_URL ?? 'http://localhost:5202/register'
