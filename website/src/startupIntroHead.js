// Inlined into <head> by website/vite.config.ts, before anything is drawn: whether this page load opens with the start
// intro (src/startup/startupIntro.ts; owner, 06.11.2026: «полная анимация эмблемы и открытие сайта»).
(function () {
  // Browser automation and the search engines' page renderers read the page at once.
  if (navigator.webdriver) return
  try {
    // Once in a tab: a reload, a language switch or the way back from payment opens the page at once.
    if (sessionStorage.getItem('raidos-site-intro') === '1') return
    sessionStorage.setItem('raidos-site-intro', '1')
  } catch (error) { /* storage unavailable: the intro plays */ }
  var root = document.documentElement
  root.setAttribute('data-startup-intro', 'play')
  // A slow connection or a script that never comes: the page itself is already in the HTML, so it is not kept waiting.
  setTimeout(function () {
    var intro = document.getElementById('startup-intro')
    if (intro) intro.remove()
    root.removeAttribute('data-startup-intro')
    root.removeAttribute('data-startup-intro-out')
  }, 6000)
})()
