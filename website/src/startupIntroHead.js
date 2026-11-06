// Inlined into <head> by website/vite.config.ts, before anything is drawn: whether this page load opens with the start
// intro (src/startup/startupIntro.ts; owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»).
(function () {
  // Browser automation and the search engines' page renderers read the page at once.
  if (navigator.webdriver || /bot|crawl|spider|slurp|lighthouse|pagespeed|inspectiontool|headless|prerender/i.test(navigator.userAgent)) return
  // Once in a browser, whichever page came first: a visitor who comes back is not kept waiting.
  var seen = true
  try {
    seen = localStorage.getItem('raidos-site-intro') === '1'
    localStorage.setItem('raidos-site-intro', '1')
  } catch (error) { /* it cannot be remembered: no waiting on every visit */ }
  if (seen) return
  // The home page on a computer. A link to another page opens that page; a phone or motion turned off opens at once.
  if (location.pathname !== '/') return
  if (matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 720px)').matches) return
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
