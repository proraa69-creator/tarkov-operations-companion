import { useEffect, useState } from 'react'

/**
 * The players' installer (owner, 03.11.2026: «сделай установочный файл, можно выбрать куда установить»): the release
 * publishes it next to the portable exe with its signed manifest (docs/coordination/ops-reference/auto-release.mjs). The
 * «Скачать для Windows» button hands it out once its manifest is there; until then, and on the owner's own PC site
 * (electron/localServer.ts, which has none), the portable exe as before.
 */
export const SETUP_URL = '/downloads/RaidOSSetup.exe'
const SETUP_MANIFEST_URL = '/downloads/setup.json'

let published: Promise<boolean> | null = null

/** Whether the installer is published: its manifest answers (otherwise the site answers with its page). */
function setupPublished() {
  published ??= fetch(SETUP_MANIFEST_URL, { cache: 'no-store', headers: { accept: 'application/json' } })
    .then(async (response) => {
      if (!response.ok) return false
      const manifest = await response.json() as { size?: unknown; signature?: unknown }
      return typeof manifest.size === 'number' && manifest.size > 0 && typeof manifest.signature === 'string'
    })
    .catch(() => false)
  return published
}

export function useSetupPublished() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let alive = true
    void setupPublished().then((value) => { if (alive) setReady(value) })
    return () => { alive = false }
  }, [])
  return ready
}

/** Tests only. */
export function resetSetupPublishedForTests() {
  published = null
}
