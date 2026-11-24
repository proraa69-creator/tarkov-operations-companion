// Runs in <head>, before anything is drawn: whether this page start shows the intro (src/startup/startupIntro.ts), and
// what the window shows when the app's code never starts (owner, 23.11.2026: a player's window stayed dark at every start,
// with the graphics card off too — «Делай выпуск приложения которое фиксит баг с черным экраном»).
(function () {
  // Browser automation (the e2e tests) drives the page at once.
  if (navigator.webdriver) return
  var root = document.documentElement

  // What went wrong before the app's code started (src/main.tsx sets __raidosAppStarted first thing and takes over): a
  // script that threw, a file that did not load (an antivirus may hold one back), a promise nobody caught.
  var problems = []
  var note = function (text) { if (problems.length < 12) problems.push(String(text).slice(0, 400)) }
  window.addEventListener('error', function (event) {
    var target = event.target
    var file = target && target !== window && (target.src || target.href)
    if (file) note('Не загрузился файл: ' + file)
    else note((event.message || 'Ошибка') + (event.filename ? ' (' + String(event.filename).split('/').pop() + ':' + event.lineno + ')' : ''))
  }, true)
  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason
    note(reason && reason.message ? reason.message : String(reason))
  })
  var started = function () { return window.__raidosAppStarted === true }

  var played = false
  try {
    // The page loaded again in the same window (a new interface build, «Перезагрузить»): no second show, the finished logo.
    played = sessionStorage.getItem('raidos-startup-intro') === '1'
    sessionStorage.setItem('raidos-startup-intro', '1')
  } catch (error) { /* storage unavailable: the intro plays */ }
  root.setAttribute('data-startup-intro', played ? 'still' : 'play')
  // The PC app: a small logo in the middle of the window, a little bigger than the one at the top left.
  if (window.tarkovDesktop) root.setAttribute('data-startup-intro-size', 'small')
  // The phone apps, the way Capacitor itself tells them (@capacitor/core getPlatformId): a third of the full size. The
  // iPhone first (07.11.2026); Android the same (owner, 20.11.2026: «сделай его аккуратным, как на iPhone… на Android оно очень большое»).
  else if (window.androidBridge || (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.bridge)) root.setAttribute('data-startup-intro-size', 'third')

  var removeIntro = function () {
    var intro = document.getElementById('startup-intro')
    if (intro) intro.remove()
    root.removeAttribute('data-startup-intro')
    root.removeAttribute('data-startup-intro-out')
  }

  // Never a dark window with nothing in it: the reason, «Перезапустить», and the text for the support chat.
  var showFailure = function () {
    if (started() || !document.body || document.getElementById('startup-failure')) return
    removeIntro()
    var english = !/^ru/i.test(navigator.language || '')
    var text = english
      ? { title: 'Raid OS did not start', body: 'Press «Restart». If the window stays empty again, press «Copy for support» and send the text in the chat on raidos.app.', restart: 'Restart', copy: 'Copy for support', copied: 'Copied' }
      : { title: 'Приложение не запустилось', body: 'Нажмите «Перезапустить». Если окно снова останется пустым, нажмите «Скопировать для поддержки» и отправьте текст в чат на raidos.app.', restart: 'Перезапустить', copy: 'Скопировать для поддержки', copied: 'Скопировано' }
    // the main process adds the version, Windows and the graphics card (electron/startDiagnostics.ts)
    var notes = Array.isArray(window.__raidosStartNotes) ? window.__raidosStartNotes : []
    var details = ['Raid OS: интерфейс не запустился'].concat(notes, problems.length ? problems : ['Ошибок не поймано'], [navigator.userAgent]).join('\n')
    var box = document.createElement('div')
    box.id = 'startup-failure'
    box.setAttribute('role', 'alert')
    box.innerHTML = '<section><div class="sf-eyebrow">RAID OS</div><h1></h1><p></p><pre></pre><div class="sf-actions">'
      + '<button type="button" data-action="restart"></button><button type="button" data-action="copy"></button></div></section>'
    box.querySelector('h1').textContent = text.title
    box.querySelector('p').textContent = text.body
    box.querySelector('pre').textContent = details
    var restart = box.querySelector('[data-action="restart"]')
    var copy = box.querySelector('[data-action="copy"]')
    restart.textContent = text.restart
    copy.textContent = text.copy
    restart.addEventListener('click', function () {
      // as src/main.tsx's «Восстановить запуск»: the interface's own cache only, the account and progress stay
      try { localStorage.removeItem('tarkov-operations-ui-v2'); sessionStorage.clear() } catch (error) { /* reload anyway */ }
      location.reload()
    })
    copy.addEventListener('click', function () {
      var done = function () { copy.textContent = text.copied }
      var fallback = function () {
        var range = document.createRange()
        range.selectNodeContents(box.querySelector('pre'))
        var selection = window.getSelection()
        if (selection) { selection.removeAllRanges(); selection.addRange(range) }
        try { if (document.execCommand('copy')) done() } catch (error) { /* the text stays selected for Ctrl+C */ }
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(details).then(done, fallback)
      else fallback()
    })
    document.body.appendChild(box)
  }

  // An error with the app's code not started yet: that start is over, say so soon.
  setTimeout(function () { if (!started() && problems.length) showFailure() }, 8000)
  // Whatever happens to the app's code: the screen under the intro is never hidden for longer than this.
  setTimeout(function () {
    removeIntro()
    if (!started()) showFailure()
  }, 20000)
})()
