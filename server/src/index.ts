import { createApi } from './app.js'
import { ProgressStore } from './services/progressStore.js'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const dbPath = resolve(process.env.TARKOV_DB_PATH ?? 'data/companion.sqlite')
mkdirSync(dirname(dbPath), { recursive: true })
const store = new ProgressStore(dbPath)
const app = createApi(store, process.env.TARKOV_API_TOKEN)
const host = process.env.HOST ?? '127.0.0.1'
if (host !== '127.0.0.1' && !process.env.TARKOV_API_TOKEN) throw new Error('TARKOV_API_TOKEN required for a network listener')
const listener = app.listen(Number(process.env.PORT ?? 8787), host, () => console.log('Tarkov Operations API ready'))
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => listener.close(() => { store.close(); process.exit(0) }))
