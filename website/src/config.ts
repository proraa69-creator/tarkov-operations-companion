export const APP_VERSION = '0.5.4'
export const PRODUCT_NAME = 'Tarkov Operator'

/** Account API base URL. The API server (server/) listens on port 8787 by default (see server/src/index.ts). */
export const API_URL = (import.meta.env.VITE_API_URL?.trim() || 'http://localhost:8787').replace(/\/+$/, '')

/** Public URL of the Windows portable build. '#' means "not published yet". */
export const DOWNLOAD_URL = import.meta.env.VITE_DOWNLOAD_URL?.trim() || '#'
export const DOWNLOAD_AVAILABLE = DOWNLOAD_URL !== '#'
