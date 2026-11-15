/**
 * A website stylesheet for the PC owner app's «Сводка» (vite.config.ts scopedSiteCss, src/admin/SiteAdminSummary.tsx):
 * every rule applies only inside `.site-admin` and `.site-admin-layer` (the day window it opens on the page). @keyframes
 * cannot stand inside @scope: they go before it as `site-<name>`, and every animation of the sheet that runs one of
 * `names` (the keyframes of all the website's sheets) runs the renamed one, so the app's own keyframes stay as they are.
 */
export const SITE_SCOPE = '.site-admin, .site-admin-layer'

export function scopeSiteCss(code: string, names: readonly string[]) {
  const keyframes: string[] = []
  let rest = ''
  let index = 0
  for (;;) {
    const at = code.indexOf('@keyframes', index)
    if (at < 0) { rest += code.slice(index); break }
    rest += code.slice(index, at)
    let depth = 0
    let end = code.indexOf('{', at)
    if (end < 0) { rest += code.slice(at); break }
    for (; end < code.length; end++) {
      if (code[end] === '{') depth++
      else if (code[end] === '}' && --depth === 0) break
    }
    keyframes.push(code.slice(at, end + 1).replace(/@keyframes\s+([\w-]+)/, '@keyframes site-$1'))
    index = end + 1
  }
  const known = names.filter((name) => /^[\w-]+$/.test(name))
  const renamed = known.length
    ? rest.replace(/(animation(?:-name)?\s*:)([^;}]*)/g, (_, property: string, value: string) => property + value.replace(new RegExp(`(?<![\\w-])(${known.join('|')})(?![\\w-])`, 'g'), 'site-$1'))
    : rest
  return `${keyframes.join('\n')}\n@scope (${SITE_SCOPE}) {\n${renamed}\n}\n`
}
