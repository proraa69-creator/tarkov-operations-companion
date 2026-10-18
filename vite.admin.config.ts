import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  root: 'admin-app',
  base: './',
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: '../dist-admin',
    emptyOutDir: true,
    sourcemap: false,
    rolldownOptions: {
      output: {
        minify: { compress: { dropConsole: true, dropDebugger: true }, mangle: true },
      },
    },
  },
})
