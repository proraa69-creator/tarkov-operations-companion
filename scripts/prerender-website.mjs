// The public pages of the site as ready HTML for search engines (owner, 17.10.2026: «готовый HTML для поисковика»):
// after `vite build` of the website, «Главная», «Скачать» and «О нас» are rendered once with the site's own components
// (website/src/prerender.tsx) and written into the built pages — Yandex and Google read the text without running
// scripts. Each page gets its own title, description and canonical address. In the browser the app renders as before
// (website/src/main.tsx replaces the content). nginx serves /download and /about from <dist>/<page>/index.html
// (try_files $uri $uri/ /index.html).
//
//   node scripts/prerender-website.mjs [distDir]   (default website/dist)
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const website = join(root, 'website')
const dist = resolve(process.argv[2] ?? join(website, 'dist'))
const ssrOut = join(website, '.prerender')
const SITE = 'https://raidos.app'
export const PAGES = ['/', '/download', '/about']

const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** One page: the rendered body in #root and the page's own head tags. */
export function pageHtml(template, path, body, { title, description }) {
  const url = `${SITE}${path}`
  let html = template.replace('<div id="root"></div>', `<div id="root">${body}</div>`)
  if (html === template) throw new Error('index.html has no empty <div id="root"></div>')
  html = html.replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(title)}</title>`)
  html = html.replace(/<meta name="description" content="[^"]*"\s*\/?>/, `<meta name="description" content="${escapeHtml(description)}" />`)
  html = html.replace(/<meta property="og:url" content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${url}" />`)
  if (!/rel="canonical"/.test(html)) html = html.replace('</head>', `    <link rel="canonical" href="${url}" />\n  </head>`)
  return html
}

async function main() {
  await build({
    configFile: join(website, 'vite.config.ts'),
    logLevel: 'warn',
    build: { ssr: join(website, 'src', 'prerender.tsx'), outDir: ssrOut, emptyOutDir: true, copyPublicDir: false },
  })
  try {
    const { render, TITLES, DESCRIPTIONS } = await import(pathToFileURL(join(ssrOut, 'prerender.js')).href)
    const template = await readFile(join(dist, 'index.html'), 'utf8')
    for (const path of PAGES) {
      const body = render(path)
      if (body.length < 500) throw new Error(`${path}: the rendered page is almost empty`)
      const html = pageHtml(template, path, body, { title: TITLES[path] ?? TITLES['/'], description: DESCRIPTIONS[path] ?? DESCRIPTIONS['/'] })
      const file = path === '/' ? join(dist, 'index.html') : join(dist, path.slice(1), 'index.html')
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, html)
      console.log(`prerendered ${path} → ${file.slice(root.length + 1)} (${Math.round(html.length / 1024)} KB)`)
    }
  } finally {
    await rm(ssrOut, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
