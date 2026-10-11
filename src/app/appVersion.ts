import { useEffect, useState } from 'react'
import { version as packageVersion } from '../../package.json'

/**
 * The running app version: the desktop build asks Electron (app:version, from the build's package.json); the
 * browser and phone builds use the version they were built from.
 */
let cached: string | null = null

/**
 * The version as the owner numbers it: package.json holds a semver «0.6.0-2» because electron-builder refuses
 * «0.6.0.2» (scripts/set-version.mjs); people see «0.6.0.2».
 */
export const displayVersion = (version: string) => version.replace(/^(\d+\.\d+\.\d+)-(\d+)$/, '$1.$2')

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
  return displayVersion(version)
}
