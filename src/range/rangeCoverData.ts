/** The covers' textures (src/range/RangeCover.tsx). */
export interface CoverTextures {
  brick?: string
  container?: string
  crate?: string
}

/** The textures' files in the range's pack (the game's own: Custom_Brick_Red1_D, container_red_new, military_AmmoBox122mm_D). */
export const COVER_TEXTURE_FILES = { brick: 'tex-brick.webp', container: 'tex-container.webp', crate: 'tex-crate.webp' } as const
