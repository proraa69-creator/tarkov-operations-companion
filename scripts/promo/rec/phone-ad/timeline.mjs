// The phone-apps ad (owner, 20.10.2026: «ролик для инстаграм, вертикальный, с демонстрацией приложений для телефонов»;
// «на русском и английском»): one 9:16 video of 34 s per language. Seconds of the finished video; the voice clips are
// promo/voice/phone-ad (ru) and promo/voice/phone-ad-en (en), the owner-approved cloned voice; their lengths and inner
// pauses measured with silencedetect (-34 dB, 70 ms).
export const FPS = 30
export const DURATION = 34

const RU = {
  voiceDir: 'phone-ad',
  voice: [
    { id: 1, at: 0.35, dur: 4.83, text: 'Дорогие друзья! На нашем сайте уже можно скачать приложения Raid OS для iOS и Android.' },
    { id: 2, at: 5.85, dur: 4.6, text: 'Квесты, карты, боссы, барахолка — всё, что есть на компьютере, теперь всегда под рукой в телефоне.' },
    { id: 3, at: 11.5, dur: 5.8, text: 'В рейде нажимаете клавишу скриншота на ПК — карта на телефоне открывается сама, и ваша точка появляется моментально.' },
    { id: 4, at: 18.6, dur: 5.33, text: 'Навели на предмет и нажали клавишу — на телефоне сразу видно, что это, сколько стоит и нужен ли он для Каппы.' },
    { id: 5, at: 24.6, dur: 4.05, text: 'Приложения ещё тестируются и дорабатываются каждый день, так что пишите нам, что улучшить.' },
    { id: 6, at: 29.4, dur: 2.35, text: 'Raid OS. Меньше вкладок — больше рейдов.' },
  ],
  scenes: { intro: [0, 5.6], tour: [5.6, 11.2], map: [11.2, 18.4], item: [18.4, 24.3], testing: [24.3, 29.1], outro: [29.1, 34] },
  // «…нажимаете клавишу скриншота на ПК» / «Навели на предмет и нажали клавишу»; «Ещё» on «пишите нам».
  moments: { screenshotKey: 13.2, positionSent: 13.35, itemHover: 18.9, itemKey: 20.1, itemSent: 20.25, more: 25.1, chat: 26.9 },
}

const EN = {
  voiceDir: 'phone-ad-en',
  voice: [
    { id: 1, at: 0.35, dur: 4.52, text: 'Hey everyone! The Raid OS apps for iOS and Android are now available on our website.' },
    { id: 2, at: 5.85, dur: 4.44, text: 'Quests, maps, bosses, the flea market — everything from your PC, now always in your pocket.' },
    { id: 3, at: 11.5, dur: 5.96, text: 'In raid, press the screenshot key on your PC — the map opens on your phone by itself, and your position shows up instantly.' },
    { id: 4, at: 18.6, dur: 5.96, text: 'Hover over an item and press the key — your phone instantly shows what it is, what it\'s worth, and whether you need it for Kappa.' },
    { id: 5, at: 25.0, dur: 3.32, text: 'The apps are still in testing and get better every day, so tell us what to improve.' },
    { id: 6, at: 29.4, dur: 2.43, text: 'Raid OS. Fewer tabs, more raids.' },
  ],
  scenes: { intro: [0, 5.6], tour: [5.6, 11.2], map: [11.2, 18.4], item: [18.4, 24.8], testing: [24.8, 29.1], outro: [29.1, 34] },
  moments: { screenshotKey: 13.15, positionSent: 13.3, itemHover: 18.75, itemKey: 20.05, itemSent: 20.2, more: 25.5, chat: 27.0 },
}

export const TIMELINES = { ru: RU, en: EN }
export const timeline = (lang) => TIMELINES[lang] ?? RU

/** The phone take covers the intro to the end of «testing»; the outro holds its last frame. */
export const takeSpan = (lang) => ({ from: 0, to: timeline(lang).scenes.testing[1] })
