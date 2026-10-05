/**
 * Which sign-in options the apps show. The owner's decision (2026-10-01): the website and the apps sign in by e-mail
 * only — e-mail + password, a code from the e-mail, or a QR code. The phone number / SMS screens
 * (src/account/PhoneAccount.tsx: sign-in by SMS code, password reset by phone, «Телефон» in the cabinet) stay in the
 * code and the server keeps its routes (server/src/routes/phone.ts); set this to true to show them again.
 * The owner's «SMS: одноразовые коды» settings panel (src/components/OwnerSmsPanel.tsx) is not affected.
 */
export const PHONE_AUTH_UI = false

/** The website the legal documents live on (raidos.app/legal/…): linked from the registration consent. */
export const LEGAL_SITE_URL = 'https://raidos.app'

/**
 * The version of the legal documents a registration in the app accepts (POST /v1/accounts/me/consents). Must equal
 * LEGAL_VERSION of website/src/legal/documents.ts (checked by src/account/AccountGate.test.tsx).
 */
export const LEGAL_VERSION = '2026-10-05'

export const legalUrl = (slug: 'offer' | 'consent' | 'privacy') => `${LEGAL_SITE_URL}/legal/${slug}`
