import { LegacyGraphqlBuilder } from '../services/legacyGraphqlBuilder.js'
import { MirrorStorage } from '../services/mirrorStorage.js'
import { PriceHistoryMirror } from '../services/priceHistoryMirror.js'
import { PriceMirror } from '../services/priceMirror.js'
import { TarkovDataMirror } from '../services/tarkovDataMirror.js'

interface WorkerStatus { state: string }
interface BootstrapWorker { run(): Promise<void>; status(): WorkerStatus }

export interface BootstrapWorkers {
  datasets: BootstrapWorker
  prices: BootstrapWorker
  legacyGraphql: BootstrapWorker
  priceHistory?: BootstrapWorker
}

/** Run prerequisites in order so legacy responses are never built from half-created data. */
export async function bootstrapWorkers(workers: BootstrapWorkers) {
  const result: Record<string, WorkerStatus> = {}
  for (const [name, worker] of Object.entries(workers) as Array<[keyof BootstrapWorkers, BootstrapWorker | undefined]>) {
    if (!worker) continue
    await worker.run()
    const status = worker.status()
    result[name] = status
    if (status.state !== 'done') throw new Error(`${name}: ${status.state}`)
  }
  return result
}

export async function main(_argv = process.argv.slice(2), env = process.env) {
  const root = env.RAIDOS_MIRROR_DIR || '/var/lib/raidos/map-mirror'
  const storage = new MirrorStorage({ root, requireMount: env.RAIDOS_MIRROR_REQUIRE_MOUNT === '1' })
  const log = (message: string) => console.error(message)
  const result = await bootstrapWorkers({
    datasets: new TarkovDataMirror({ storage, log }),
    prices: new PriceMirror({ storage, log }),
    legacyGraphql: new LegacyGraphqlBuilder({ storage, log }),
    priceHistory: new PriceHistoryMirror({ storage, log }),
  })
  console.log(JSON.stringify(result, null, 2))
}
