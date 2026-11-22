// «Модули убежища» → Season: the gym and the bitcoin farm there from the start for every player (owner, 20.11.2026: «по команде
// ты просто включишь… оно сразу же без обновления приложения появится»). The same as «Админ панель» → «Модули убежища» → «Сезон» →
// «Со старта» → «Сохранить» in the owner app (server/src/routes/hideoutModules.ts).
//
// Paste the whole file into the console (F12) of a raidos.app tab where the owner account is signed in. The session is read from
// that page's localStorage ('toc.session') and never printed. Other Season settings are kept. To put both back as in the game,
// change the last line to `})(false)`. Players' apps pick it up with their next check of the notice (3–6 minutes, or at once when
// their window gets the focus back); the apps must already have the «Модули убежища» code (0.6.0.325 or later) and the server the
// route.
(async (on = true) => {
  const GYM = '6377a9b9a93bde8fa30eb79a'
  const BITCOIN_FARM = '5d494a445b56502f18c98a10'
  const PATH = '/v1/accounts/me/admin/hideout-modules'
  const token = localStorage.getItem('toc.session')
  if (!token) { console.warn('Войдите в аккаунт владельца на raidos.app и запустите ещё раз.'); return }
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${token}` }
  const current = await fetch(PATH, { headers })
  const stored = await current.json().catch(() => ({}))
  if (!current.ok) { console.warn(`Сервер ответил ${current.status}: ${stored.error ?? 'нет раздела «Модули убежища» (сервер не обновлён?)'}`); return }
  const season = stored.modules?.modes?.seasonal ?? { open: [], hidden: [] }
  const ours = new Set([GYM, BITCOIN_FARM])
  const open = on ? [...new Set([...season.open, ...ours])] : season.open.filter((id) => !ours.has(id))
  const hidden = season.hidden.filter((id) => !open.includes(id))
  const saved = await fetch(PATH, { method: 'PUT', headers, body: JSON.stringify({ mode: 'seasonal', open, hidden }) })
  const answer = await saved.json().catch(() => ({}))
  if (!saved.ok) { console.warn(`Не сохранено (${saved.status}): ${answer.error ?? ''}`); return }
  console.log(on ? 'Сезон: спортзал и биткоин-ферма — со старта.' : 'Сезон: спортзал и биткоин-ферма — как в игре.', answer.modules?.modes?.seasonal ?? 'весь сезон как в игре')
})()
