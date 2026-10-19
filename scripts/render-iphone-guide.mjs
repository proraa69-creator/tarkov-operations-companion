// The iPhone install guide as a PDF (docs/mobile/iphone-guide.html → website/public/guides/raid-os-iphone-install.pdf):
//   node scripts/render-iphone-guide.mjs
// Uses Playwright's Chromium (PLAYWRIGHT_CHROMIUM=<path> for another one). scripts/mobile-release.py puts the PDF into
// the iPhone archive; the site serves it at /guides/raid-os-iphone-install.pdf too.
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'docs/mobile/iphone-guide.html')
const target = join(root, 'website/public/guides/raid-os-iphone-install.pdf')
const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {})
try {
  const page = await browser.newPage()
  await page.goto(pathToFileURL(source).href)
  await mkdir(dirname(target), { recursive: true })
  await page.pdf({ path: target, format: 'A4', printBackground: true, preferCSSPageSize: true })
  console.log(target)
} finally {
  await browser.close()
}
