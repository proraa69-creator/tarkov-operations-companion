import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Run from the repository root so the root node_modules are used:
//   npx vite --config website/vite.config.ts --port 5202
//   npx vite build --config website/vite.config.ts
const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root,
  envDir: root,
  base: '/',
  plugins: [react()],
  // The click sound is the desktop app's own module and recording (src/components/UiSounds.tsx), imported from the
  // repository root, so the dev server may serve files from there.
  server: { port: 5202, strictPort: true, fs: { allow: ['..'] } },
  preview: { port: 5202 },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
})
