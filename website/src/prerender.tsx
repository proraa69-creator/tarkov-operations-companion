/* eslint-disable react-refresh/only-export-components -- a build-time entry (scripts/prerender-website.mjs), never hot-reloaded */
/**
 * The public pages as ready HTML for search engines (owner, 17.10.2026: «готовый HTML для поисковика»): the build renders
 * «Главная», «Скачать» and «О нас» once with the same components (scripts/prerender-website.mjs) and writes them into
 * dist, so Yandex and Google read the text without running scripts. In the browser the app then renders the page as
 * always (main.tsx). Nothing is added to the pages: the words are the ones the visitor sees.
 */
import { renderToString } from 'react-dom/server'
import { StaticRouter } from 'react-router-dom'
import { App } from './App'
import { AuthProvider } from './auth'

export function render(url: string) {
  return renderToString(
    <StaticRouter location={url}>
      <AuthProvider>
        <App />
      </AuthProvider>
    </StaticRouter>,
  )
}

export { TITLES } from './pageTitles'
export { DESCRIPTIONS } from './searchTags'
