import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react()],
  // Hand Control is compiled only into the separate test edition (`--mode handtest`).
  define: { __RAIDOS_HAND_CONTROL__: JSON.stringify(mode === 'handtest') },
  // Its model and WASM runtime (scripts/prepare-hand-assets.mjs) are only shipped with that edition.
  ...(mode === 'handtest' ? { publicDir: 'public-hand' } : {}),
  // The hand tracker runs MediaPipe in a module worker (ES output so it can lazy-load the WASM loader).
  worker: { format: 'es' },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    globals: true,
    exclude: [...configDefaults.exclude, 'tests/**', 'work/**', 'dist-electron/**', 'server/**'],
  },
}))
