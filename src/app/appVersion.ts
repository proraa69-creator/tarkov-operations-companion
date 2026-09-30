import { useEffect, useState } from 'react'
import { version as packageVersion } from '../../package.json'

/**
 * The running app version: the desktop build asks Electron (app:version, from the build's package.json); the
 * browser and phone builds use the version they were built from.
 */
let cached: string | null = null

export function useAppVersion() {
  const [version, setVersion] = useState(cached ?? packageVersion)
  useEffect(() => {
    if (cached || !window.tarkovDesktop?.getVersion) return
    let active = true
    void window.tarkovDesktop.getVersion().then((value) => {
      if (!value) return
      cached = value
      if (active) setVersion(value)
    }).catch(() => {})
    return () => { active = false }
  }, [])
  return version
}
