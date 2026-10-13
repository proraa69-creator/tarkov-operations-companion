// Shared start of a take: the app opened and ready, the recorder running on the take's span of the global timeline.
import { openApp, record, close, S } from './rec.mjs'
import { schedule, takes } from './schedule.mjs'
import { T } from './texts.mjs'

export async function beginTake(id, { lang = 'ru', prepare, mouse = { x: 1240, y: 640 }, rate = 0.25, ...open } = {}) {
  const { scenes } = schedule(lang)
  const take = takes(lang).list.find((entry) => entry.id === id)
  const { page, context } = await openApp({ locale: lang, ...open })
  if (prepare) await prepare(page)
  await page.mouse.move(mouse.x, mouse.y)
  const rec = await record(page, `${S}/promo/out/${lang}/${id}.mp4`, { rate })
  rec.setMouse(mouse)
  // A step that ends after the next mark is late: say by how much (the schedule drifts otherwise unnoticed).
  const at = async (g) => { const late = rec.vnow() / 1000 - (g - take.from); if (late > 0.12) console.log(`  late by ${late.toFixed(2)} s for mark ${g.toFixed(2)}`); await rec.until((g - take.from) * 1000) }
  const v = (n, offset = 0) => scenes[n].voice + offset
  const finish = async () => { await rec.until((take.to - take.from) * 1000); const length = await rec.stop(); await close(); return length }
  return { page, context, rec, at, v, scenes, take, tx: T[lang], lang, finish }
}
