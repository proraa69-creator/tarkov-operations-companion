/** Two fresh readings within 10 seconds when each OCR pass takes at most 3 seconds. */
export const STORY_SCAN_TIMING = { menuMs: 1200, storyMs: 600, idleMs: 1500, rereadDetailMs: 1000, rereadMenuMs: 1800, screenshotMaxAgeMs: 10_000 } as const

export function reuseQuestReading(previous: { at: number; detail: boolean } | null, now: number, detail: boolean, same: boolean) {
  return Boolean(previous && same && previous.detail === detail && now >= previous.at
    && now - previous.at < (detail ? STORY_SCAN_TIMING.rereadDetailMs : STORY_SCAN_TIMING.rereadMenuMs))
}
