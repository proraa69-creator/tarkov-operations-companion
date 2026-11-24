import { createReadStream, existsSync, readdirSync, statSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { scopeSiteCss } from './src/shared/scopeSiteCss.ts'
import { fontScaleCss } from './src/theme/fontScaleCss.ts'
import { PART_PACK_FILE, PART_PACK_NAME, writePartPack } from './src/arsenal/partPack.ts'
import { RANGE_PACK_FILE, RANGE_PACK_NAME } from './src/range/rangePack.ts'

/**
 * The OCR engine of «Синхронизация по фото» (src/stashPhoto/browser.ts) served from the app itself under ocr/, never
 * from a CDN: the worker, the plain WebAssembly core (runs on every phone) and the models already kept for the Windows
 * app (electron/tessdata: Russian and English; the game's other languages for a game in one of them).
 * Copied at build time, so the binaries are not committed twice; loaded only when the button is pressed.
 */
const OCR_FILES: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  'ocr/rus.traineddata': 'electron/tessdata/rus.traineddata',
  'ocr/eng.traineddata': 'electron/tessdata/eng.traineddata',
  // The other game languages' labels (src/import/gameLanguage.ts): loaded only for a game in that language.
  'ocr/deu.traineddata': 'electron/tessdata/deu.traineddata',
  'ocr/jpn.traineddata': 'electron/tessdata/jpn.traineddata',
  'ocr/chi_sim.traineddata': 'electron/tessdata/chi_sim.traineddata',
  // Polish, Spanish, Brazilian Portuguese, French, Korean and Turkish games (src/import/gameLanguage.ts OCR_MODEL_FILES).
  'ocr/pol.traineddata': 'electron/tessdata/pol.traineddata',
  'ocr/spa.traineddata': 'electron/tessdata/spa.traineddata',
  'ocr/por.traineddata': 'electron/tessdata/por.traineddata',
  'ocr/fra.traineddata': 'electron/tessdata/fra.traineddata',
  'ocr/kor.traineddata': 'electron/tessdata/kor.traineddata',
  'ocr/tur.traineddata': 'electron/tessdata/tur.traineddata',
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

/**
 * The App Store build of the iPhone app (VITE_APP_STORE=1, .github/workflows/ios-app-store.yml; owner 17.10.2026: no
 * admin tools in the iOS app): the admin pages are replaced by empty modules, so their code is not in the bundle at all
 * (src/app/App.tsx also never routes to them there).
 */
const APP_STORE_STUBS: Record<string, string> = {
  '../admin/AdminMobilePage': 'AdminMobilePage',
  '../pages/AdminPanelPage': 'AdminPanelPage',
}

function appStoreStubs(): Plugin {
  return {
    name: 'raidos-app-store-stubs',
    apply: () => process.env.VITE_APP_STORE === '1',
    enforce: 'pre',
    resolveId(source) {
      return APP_STORE_STUBS[source] ? `\0raidos-app-store-stub:${APP_STORE_STUBS[source]}` : null
    },
    load(id) {
      const name = id.startsWith('\0raidos-app-store-stub:') ? id.slice('\0raidos-app-store-stub:'.length) : ''
      return name ? `export function ${name}() { return null }` : null
    },
  }
}

/**
 * The site's admin tabs inside the PC owner app («Админ панель» → «Сводка», src/admin/SiteAdminSummary.tsx; owner,
 * 15.11.2026: «точная копия сайта»): the website's stylesheets they bring apply only inside `.site-admin` (and the day
 * window it opens on the page, `.site-admin-layer`), never to the app around them. Their @keyframes stay outside the
 * scope (CSS allows none inside) under a `site-` name, so they never replace the app's own. The website's build is not
 * touched: this is the app's config only.
 */
const SITE_CSS = /[\\/]website[\\/]src[\\/][^?]*\.css(?:\?.*)?$/

function scopedSiteCss(): Plugin {
  // Every @keyframes name of the website's sheets: one sheet may run another's (the spinner of styles.css).
  const names = new Set<string>()
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, dir))
      else if (entry.name.endsWith('.css')) for (const match of readFileSync(new URL(entry.name, dir), 'utf8').matchAll(/@keyframes\s+([\w-]+)/g)) names.add(match[1]!)
    }
  }
  walk(new URL('website/src/', import.meta.url))
  return {
    name: 'raidos-scoped-site-css',
    enforce: 'pre',
    transform(code, id) {
      return SITE_CSS.test(id) ? { code: scopeSiteCss(code, [...names]), map: null } : null
    },
  }
}

/**
 * The start intro stands in index.html itself, so it is on screen before the app's code is read (src/startup/startupIntro.ts).
 * Written in after Vite's own HTML steps: nothing of it is bundled, rewritten or fetched.
 */
/**
 * «Сборка оружия»'s part pictures (public/gun-parts, 5000 renders of our offline game) leave the build as one encrypted pack,
 * dist/gun-parts.pack (src/arsenal/partPack.ts; owner, 22.11.2026: «…не смогли вытащить и скачать снимки сборки оружия»): the
 * folder Vite copied is packed and removed once the build is written, so neither the PC app's archive nor the phone's APK/IPA
 * holds a plain picture. In development the pack is made from public/gun-parts when first asked for.
 */
/**
 * A folder of pictures under public/ shipped as one encrypted pack (src/arsenal/partPack.ts): packed at the end of a build (the plain
 * folder removed), served packed by the dev server. `keep` false: the folder is only removed (the range's pictures in a build that is
 * not a test build).
 */
function picturePack(folderName: string, packName: string, pattern: RegExp, keep: () => boolean = () => true): Plugin {
  let outDir = 'dist'
  let publicDir = 'public'
  let devPack: Promise<Uint8Array> | null = null
  let devStamp = ''
  const pack = (folder: string) => {
    const names = readdirSync(folder).filter((name) => pattern.test(name)).sort()
    return writePartPack(names.map((name) => [name, new Uint8Array(readFileSync(join(folder, name)))] as const))
  }
  return {
    name: `raidos-pack-${folderName}`,
    configResolved(config) { outDir = resolve(config.root, config.build.outDir); publicDir = config.publicDir || resolve(config.root, 'public') },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!.replace(/^\/+/, '')
        if (path !== packName || !existsSync(join(publicDir, folderName))) return next()
        // packed again when the folder's files change (the range's pictures arrive while the studio renders)
        const folder = join(publicDir, folderName)
        const stamp = readdirSync(folder).map((name) => `${name}:${statSync(join(folder, name)).mtimeMs}`).join('|')
        if (stamp !== devStamp) { devStamp = stamp; devPack = null }
        devPack ??= pack(folder)
        devPack.then((bytes) => { response.setHeader('Content-Type', 'application/octet-stream'); response.end(Buffer.from(bytes)) }, next)
      })
    },
    async closeBundle() {
      const folder = join(outDir, folderName)
      if (!existsSync(folder)) return
      if (keep()) writeFileSync(join(outDir, packName), await pack(folder))
      rmSync(folder, { recursive: true, force: true })
    },
  }
}

function startupIntro(): Plugin {
  return {
    name: 'raidos-startup-intro',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html
        .replace('<!-- startup-intro:head -->', () => `<style>${readFileSync(new URL('src/startup/intro.css', import.meta.url), 'utf8')}</style>
    <script src="./startup-intro.js"></script>`)
        .replace('<!-- startup-intro:body -->', () => readFileSync(new URL('src/startup/intro.html', import.meta.url), 'utf8')),
    },
  }
}

export default defineConfig({
  base: './',
  // A test build (TEST_BUILD=1, scripts/write-build-info.mjs) shows the pages still being tested (src/app/rangeFeature.ts).
  define: { __RAIDOS_TEST_BUILD__: JSON.stringify(process.env.TEST_BUILD === '1') },
  plugins: [appStoreStubs(), scopedSiteCss(), react(), ocrAssets(), startupIntro(),
    picturePack('gun-parts', PART_PACK_NAME, PART_PACK_FILE),
    // «Полигон» (src/range/rangeFigures.ts): its pictures ship in every build since 0.6.0.338 (src/app/rangeFeature.ts)
    picturePack('range-figures', RANGE_PACK_NAME, RANGE_PACK_FILE)],
  // «Размер шрифта» (src/theme/fontSize.ts): every font size in px times var(--font-scale, 1)
  css: { postcss: { plugins: [fontScaleCss()] } },
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
