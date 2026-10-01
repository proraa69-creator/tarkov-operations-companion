import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',
  plugins: [react()],
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
