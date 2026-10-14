// Slowed page time for frame-exact recording: JS clocks, rAF timestamps and timers run at `rate` of real time
// (CSS/WAAPI animations are slowed by CDP Animation.setPlaybackRate from the recorder). The page's own code sees a
// continuous clock; the recorder maps real capture times to this clock.
(() => {
  if (window.__vt) return
  const realNow = performance.now.bind(performance)
  const RealDate = Date
  const offset = RealDate.now() - realNow()
  let rate = 1
  let realBase = realNow()
  let virtualBase = realBase
  const vnow = () => virtualBase + (realNow() - realBase) * rate
  window.__vt = {
    now: vnow,
    real: realNow,
    rate: () => rate,
    setRate(next) { virtualBase = vnow(); realBase = realNow(); rate = next; return [realNow(), vnow()] },
    sync: () => [realNow(), vnow()],
  }
  try { performance.now = vnow } catch { Object.defineProperty(performance, 'now', { value: vnow, configurable: true }) }
  function VDate(...args) {
    if (!new.target) return new RealDate(offset + vnow()).toString()
    return args.length ? new RealDate(...args) : new RealDate(offset + vnow())
  }
  VDate.prototype = RealDate.prototype
  VDate.now = () => Math.floor(offset + vnow())
  VDate.parse = RealDate.parse
  VDate.UTC = RealDate.UTC
  Object.setPrototypeOf(VDate, RealDate)
  window.Date = VDate
  const raf = window.requestAnimationFrame.bind(window)
  window.requestAnimationFrame = (callback) => raf(() => callback(vnow()))
  const setT = window.setTimeout.bind(window)
  const setI = window.setInterval.bind(window)
  // Browsers fire a timer at once when its delay overflows 2^31-1 ms (a 7-day cache timer slowed 4× would): clamp.
  const MAX = 2147483647
  window.setTimeout = (fn, ms = 0, ...args) => setT(fn, Math.min(MAX, Math.max(0, Number(ms) || 0) / rate), ...args)
  window.setInterval = (fn, ms = 0, ...args) => setI(fn, Math.min(MAX, Math.max(4, Number(ms) || 0) / rate), ...args)
})()
