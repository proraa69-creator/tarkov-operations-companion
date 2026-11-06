// Runs in <head>, before anything is drawn: whether this page start shows the intro (src/startup/startupIntro.ts).
(function () {
  // Browser automation (the e2e tests) drives the page at once.
  if (navigator.webdriver) return
  var root = document.documentElement
  var played = false
  try {
    // The page loaded again in the same window (a new interface build, «Перезагрузить»): no second show, the finished logo.
    played = sessionStorage.getItem('raidos-startup-intro') === '1'
    sessionStorage.setItem('raidos-startup-intro', '1')
  } catch (error) { /* storage unavailable: the intro plays */ }
  root.setAttribute('data-startup-intro', played ? 'still' : 'play')
  // Whatever happens to the app's code: the screen under the intro is never hidden for longer than this.
  setTimeout(function () {
    var intro = document.getElementById('startup-intro')
    if (intro) intro.remove()
    root.removeAttribute('data-startup-intro')
    root.removeAttribute('data-startup-intro-out')
  }, 20000)
})()
