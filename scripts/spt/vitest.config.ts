// Only for scripts/spt/dump-app-tasks.spt.ts (README.md): `npm test` does not collect *.spt.ts files.
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['scripts/spt/*.spt.ts'], environment: 'node', testTimeout: 180_000 },
})
