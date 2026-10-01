import { useEffect, useState } from 'react'
import { api, type AuthConfig } from '../api'

/**
 * GET /v1/accounts/auth-config: whether the server sends e-mail codes (`emailEnabled`). Loaded once per page load.
 * The site signs in by e-mail only (password, a code from the e-mail, or a QR code); the server's SMS settings in the
 * same answer are not used here.
 */
let configPromise: Promise<AuthConfig> | null = null
const OFF: AuthConfig = { emailEnabled: false }

/** null while loading; an older server or a failed request counts as «e-mail codes off». */
export function useAuthConfig() {
  const [config, setConfig] = useState<AuthConfig | null>(null)
  useEffect(() => {
    let active = true
    configPromise ??= api.authConfig().catch(() => { configPromise = null; return OFF })
    void configPromise.then((value) => { if (active) setConfig(value) })
    return () => { active = false }
  }, [])
  return config
}
