/**
 * The environment of the local API process (electron/localServer.ts): only what Node / Windows need to run and the
 * variables the server reads (server/src: process.env / env.X), never everything this app has. The app's own
 * secrets — RAIDOS_UPDATE_SIGNING_KEY*, GitHub tokens and the like — therefore never reach the API process.
 * Unit-tested in apiEnv.test.ts.
 */

/** Run-time basics: paths, temp folders, user folders, locale, proxies and the CA bundle. */
const SYSTEM = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR', 'SystemDrive', 'SYSTEMDRIVE', 'ComSpec', 'COMSPEC',
  'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'ProgramData',
  'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS', 'LANG', 'LC_ALL', 'TZ', 'NODE_ENV',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_ENV_PROXY',
]

/** Every variable server/src reads (keep in sync when the server gets a new one). */
const SERVER = [
  'HOST', 'PORT', 'WEB_ORIGIN',
  'TARKOV_ADMIN_TOKEN', 'TARKOV_API_TOKEN', 'TARKOV_APP_BUILD', 'TARKOV_APP_COMMIT', 'TARKOV_APP_EDITION', 'TARKOV_APP_VERSION',
  'TARKOV_DATA_MAX_BYTES', 'TARKOV_DB_PATH', 'TARKOV_ENTITLEMENT_PRIVATE_KEY', 'TARKOV_GUARD_ALLOWLIST', 'TARKOV_MAX_DEVICES',
  'TARKOV_OWNER_EMAILS', 'TARKOV_PRICE_MONTH_RUB', 'TARKOV_PUBLIC_URL', 'TARKOV_STREAMER_PERCENT',
  'TARKOV_EMAIL_ADDRESS_DAILY_LIMIT', 'TARKOV_EMAIL_API_KEY', 'TARKOV_EMAIL_DAILY_LIMIT', 'TARKOV_EMAIL_FROM', 'TARKOV_EMAIL_PROVIDER',
  'TARKOV_SMS_API_KEY', 'TARKOV_SMS_COUNTRIES', 'TARKOV_SMS_DAILY_LIMIT', 'TARKOV_SMS_LOGIN', 'TARKOV_SMS_PHONE_DAILY_LIMIT',
  'TARKOV_SMS_PROVIDER', 'TARKOV_SMS_SENDER',
  'YOOKASSA_AUTOPAY', 'YOOKASSA_PAYMENT_METHODS', 'YOOKASSA_RECEIPTS', 'YOOKASSA_SECRET_KEY', 'YOOKASSA_SHOP_ID',
  'LAVA_API_KEY', 'LAVA_API_URL', 'LAVA_CURRENCY', 'LAVA_OFFER_ID', 'LAVA_PAYMENT_METHOD', 'LAVA_RUB_RATE', 'LAVA_WEBHOOK_KEY',
  'RAIDOS_SERVER_EXE',
  'RAIDOS_ITEM_IMAGE_DIR', 'RAIDOS_ITEM_IMAGE_URL',
]

const ALLOWED = new Set([...SYSTEM, ...SERVER])
/** Never passed on, even if a name above ever matched it. */
const FORBIDDEN = /^RAIDOS_UPDATE_SIGNING_KEY/i

/** The allowlisted part of `parent` (the app's own process.env); values are copied as they are. */
export function apiProcessEnv(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || FORBIDDEN.test(name) || !ALLOWED.has(name)) continue
    env[name] = value
  }
  return env
}

/** The full environment for the API process: the allowlisted inherited part plus what the app sets itself. */
export function apiChildEnv(parent: NodeJS.ProcessEnv, own: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env = { ...apiProcessEnv(parent), ...own }
  for (const name of Object.keys(env)) if (FORBIDDEN.test(name)) delete env[name]
  return env
}
