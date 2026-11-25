/**
 * The edition baked into this exe at build time.
 *
 * scripts/write-build-info.mjs rewrites the compiled dist-electron/electron/buildEditionConstant.js for each edition
 * (`client` or `owner`), after tsc and before electron-builder packs it into app.asar — which the Electron
 * asar-integrity fuse (package.json build.electronFuses.enableEmbeddedAsarIntegrityValidation) then seals. So the owner
 * build is decided here, inside the integrity-protected archive, not by a field anyone can edit: changing
 * dist-electron/build-info.json in a packaged copy no longer turns on the owner's server, sign-in without a
 * subscription or the local server (electron/buildEdition.ts buildEdition → isOwnerBuild).
 *
 * `null` in a development run (this TypeScript source is used as it is, never overwritten), so buildEdition() falls back
 * to build-info.json / OWNER_BUILD, exactly as before.
 */
export const BAKED_EDITION: 'owner' | 'client' | null = null
