const pending = new WeakMap<object, Promise<unknown>>()

/** A Tesseract worker can process only one job at a time, including across scan requests. */
export function runOcrJob<T>(worker: object, job: () => Promise<T>): Promise<T> {
  const next = (pending.get(worker) ?? Promise.resolve()).catch(() => undefined).then(job)
  pending.set(worker, next)
  const clear = () => { if (pending.get(worker) === next) pending.delete(worker) }
  void next.then(clear, clear)
  return next
}
