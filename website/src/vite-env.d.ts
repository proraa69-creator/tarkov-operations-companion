/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the account API (server/). Default: http://localhost:8787 */
  readonly VITE_API_URL?: string
  /** Public URL of the Windows build. Default: '#' (link not published yet). */
  readonly VITE_DOWNLOAD_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
