import { createReadStream, readFileSync } from 'node:fs'
import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * The OCR engine of «Синхронизация по фото» (src/stashPhoto/browser.ts) served from the app itself under ocr/, never
 * from a CDN: the worker, the plain WebAssembly core (runs on every phone) and the Russian and English models already
 * kept for the Windows app (electron/tessdata). Copied at build time, so the binaries are not committed twice; loaded
 * only when the button is pressed.
 */
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/rus.traineddata': 'electron/tessdata/rus.traineddata',
  'ocr/eng.traineddata': 'electron/tessdata/eng.traineddata',
}

function ocrAssets(): Plugin {
  return {
    name: 'raidos-ocr-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!.replace(/^\/+/, '')
        const source = OCR_FILES[path]
        if (!source) return next()
        response.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : 'application/octet-stream')
        createReadStream(source).pipe(response)
      })
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(OCR_FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), ocrAssets()],
  build: {
    // Release renderer (docs/subscription-protection.md): no source maps next to the bundle, no console output or
    // `debugger` statements left in it.
    sourcemap: false,
    rolldownOptions: {
      output: {
        minify: { compress: { dropConsole: true, dropDebugger: true }, mangle: true },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    globals: true,
    exclude: [...configDefaults.exclude, 'tests/**', 'work/**', 'dist-electron/**', 'server/**'],
  },
})
