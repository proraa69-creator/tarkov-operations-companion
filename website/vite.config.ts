import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Run from the repository root so the root node_modules are used:
//   npx vite --config website/vite.config.ts --port 5202
//   npx vite build --config website/vite.config.ts
const root = fileURLToPath(new URL('.', import.meta.url))

const read = (file: string) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8')

/**
 * The start intro of the app (src/startup/startupIntro.ts), the same picture and the same motion, standing in the page
 * itself so it is on screen at once. Written in after Vite's own HTML steps: nothing of it is bundled or fetched.
 */
function startupIntro(): Plugin {
  return {
    name: 'raidos-startup-intro',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html
        .replace('<!-- startup-intro:head -->', () => `<style>${read('../src/startup/intro.css')}</style>\n    <script>${read('./src/startupIntroHead.js')}</script>`)
        .replace('<!-- startup-intro:body -->', () => read('../src/startup/intro.html')),
    },
  }
}

export default defineConfig({
  root,
  envDir: root,
  base: '/',
  plugins: [react(), startupIntro()],
  // The click sound is the desktop app's own module and recording (src/components/UiSounds.tsx), imported from the
  // repository root, so the dev server may serve files from there.
  server: { port: 5202, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5202 },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
})
