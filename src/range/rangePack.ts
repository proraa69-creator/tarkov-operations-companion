/** The pack of the range's pictures (src/range/rangeFigures.ts) — names only, shared with the build (vite.config.ts) and the PC app. */
export const RANGE_PACK_NAME = 'range-figures.pack'
/**
 * In the pack: the characters and their armour from the front and the back, the covers' textures (`tex-…`), the scopes' reticles
 * (`reticle-…`) with their data (`scopes.json`), the red dots' marks (`reticle-…-m<N>`), housings (`housing-…`) and data
 * (`collimators.json`), the sights' and bores' points for the sight height (`sights.json`), and the index.
 */
export const RANGE_PACK_FILE = /^(?:(?:char|bare|body|worn)-[A-Za-z0-9-]+\.(?:front|back)\.webp|(?:tex|reticle|housing)-[A-Za-z0-9-]+\.(?:webp|png)|index\.json|scopes\.json|sights\.json|collimators\.json)$/
export const RANGE_PICTURES_BASE = 'raidos-img://range/'
