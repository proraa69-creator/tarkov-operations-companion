// Inlined into <head> by website/vite.config.ts, before anything is drawn: whether this page load opens with the start
// intro (src/startup/startupIntro.ts; owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»).
(function () {
  // Browser automation and the search engines' page renderers read the page at once.
  if (navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|pagespeed|inspectiontool|headless|prerender/i.test(navigator.userAgent)) return
  // Each time the site is started on its home page, on a computer or a phone (owner, 07.11.2026: «Я запускаю сайт, а анимации
  // нету»): a new tab, the address typed, a reload. A link to another page opens that page.
  if (location.pathname !== '/') return
  // Coming back with «Назад», or by a link on the site itself, is not a start.
  var entries = performance.getEntriesByType ? performance.getEntriesByType('navigation') : []
  var how = entries[0] && entries[0].type
  if (how === 'back_forward') return
  if (how !== 'reload' && document.referrer.indexOf(location.origin + '/') === 0) return
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
  var root = document.documentElement
  root.setAttribute('data-startup-intro', 'play')
  // A slow connection or a script that never comes: the page itself is already in the HTML, so it is not kept waiting.
  setTimeout(function () {
    // Already opening: website/src/siteOpening.ts finishes by itself.
    if (root.hasAttribute('data-startup-intro-out')) return
    var intro = document.getElementById('startup-intro')
    if (intro) intro.remove()
    root.removeAttribute('data-startup-intro')
  }, 6000)
})()
