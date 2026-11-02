/**
 * The browser built into the «Яндекс» app (with Алиса) — not the separate Яндекс Браузер (`YaBrowser/`), where paying works.
 * ЮKassa's payment page can stay white in it (support, 02.11.2026: five SBP attempts of one player from the app 26.102 with
 * its webOmni engine, while the same page opened elsewhere), so the checkout suggests Chrome or Яндекс Браузер (owner,
 * 02.11.2026: «Да, добавь»). Android names it YaSearchApp / YaApp_Android and YaSearchBrowser, iOS YaApp_iOS.
 */
export function isYandexAppBrowser(userAgent: string) {
  return /\b(?:YaSearchApp|YaSearchBrowser|YaApp_(?:Android|iOS))\//.test(userAgent)
}
