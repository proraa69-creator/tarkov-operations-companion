/** Fitting the «Кочевники» statistics into the card (src/components/GoonCard.tsx, goonCard.css). */

/**
 * Fits the statistics into the card. The first row keeps clear of «Видел» wherever it stands (`--goon-button`: its room at
 * the right, `--goon-head`: down to its bottom; the narrowest blocks put it under the title). Then `data-fit` drops what the
 * height has no room for, least needed first, until at least one whole sightings row fits: 1 the maps nobody saw them on
 * and all but two chips, 2 all but the chip of the map seen most often (where the heading has room, «Чаще всего» instead),
 * 3 the counts, 4 the sightings too (the first row only). The list is as tall as the whole rows that fit, so none is cut.
 */
export function fitGoonStats(stats: HTMLElement, button: HTMLElement | null, list: HTMLElement | null) {
  const height = stats.clientHeight
  if (!height) return
  const style = getComputedStyle(stats)
  const padTop = parseFloat(style.paddingTop) || 0
  const padRight = parseFloat(style.paddingRight) || 0
  const limit = height - (parseFloat(style.paddingBottom) || 0)
  if (button) {
    const box = stats.getBoundingClientRect()
    const own = button.getBoundingClientRect()
    const scale = box.height / stats.offsetHeight || 1
    stats.style.setProperty('--goon-button', `${Math.max(0, Math.ceil((box.right - own.left) / scale - padRight + 8))}px`)
    stats.style.setProperty('--goon-head', `${Math.max(24, Math.ceil((own.bottom - box.top) / scale - padTop + 4))}px`)
    // the first line of chips level with «Видел»
    const chip = stats.querySelector<HTMLElement>('.goon-stats-chip')?.offsetHeight || 20
    stats.style.setProperty('--goon-lead', `${Math.max(0, Math.round((own.top - box.top) / scale - padTop + (own.height / scale - chip) / 2))}px`)
  }
  for (let level = 0; level <= 4; level += 1) {
    stats.dataset.fit = String(level)
    if (list) list.style.height = `${rowStep(list)}px`
    if (contentBottom(stats) <= limit + 0.5) break
  }
  if (list && stats.dataset.fit !== '4') {
    const step = rowStep(list)
    list.style.height = `${Math.max(step, Math.floor((limit - list.offsetTop) / step) * step)}px`
  }
}

/** The lowest edge of what is shown in the statistics, from its top (layout boxes: the slide's transforms do not count). */
function contentBottom(stats: HTMLElement) {
  let bottom = 0
  for (const child of Array.from(stats.children) as HTMLElement[]) {
    if (child.offsetHeight) bottom = Math.max(bottom, child.offsetTop + child.offsetHeight)
  }
  return bottom
}

/** Distance from one sightings row to the next (row height and gap); 14 px while the rows are not laid out. */
export function rowStep(list: HTMLElement) {
  const first = list.firstElementChild as HTMLElement | null
  const second = first?.nextElementSibling as HTMLElement | null
  const step = first && second ? second.offsetTop - first.offsetTop : first?.offsetHeight ?? 0
  return step > 0 ? step : 14
}
