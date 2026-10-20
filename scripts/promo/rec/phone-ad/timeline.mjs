// The phone-apps ad (owner, 20.10.2026: «ролик для инстаграм, вертикальный, с демонстрацией приложений для телефонов»):
// one 9:16 video of about 34 s. Seconds of the finished video; the voice clips are promo/voice/phone-ad/s0N.mp3
// (the owner-approved cloned voice), their lengths and inner pauses measured with silencedetect (-34 dB, 70 ms).
export const FPS = 30

/** Voice lines: where each starts in the video, its clip length and the pauses inside it (start, end). */
export const VOICE = [
  { id: 1, at: 0.35, dur: 4.83, text: 'Дорогие друзья! На нашем сайте уже можно скачать приложения Raid OS для iOS и Android.', pauses: [[0.75, 0.92]] },
  { id: 2, at: 5.85, dur: 4.6, text: 'Квесты, карты, боссы, барахолка — всё, что есть на компьютере, теперь всегда под рукой в телефоне.', pauses: [[1.91, 2.03]] },
  { id: 3, at: 11.5, dur: 5.8, text: 'В рейде нажимаете клавишу скриншота на ПК — карта на телефоне открывается сама, и ваша точка появляется моментально.', pauses: [[2.04, 2.27], [3.79, 4.04]] },
  { id: 4, at: 18.6, dur: 5.33, text: 'Навели на предмет и нажали клавишу — на телефоне сразу видно, что это, сколько стоит и нужен ли он для Каппы.', pauses: [] },
  { id: 5, at: 24.6, dur: 4.05, text: 'Приложения ещё тестируются и дорабатываются каждый день, так что пишите нам, что улучшить.', pauses: [[2.52, 2.6]] },
  { id: 6, at: 29.4, dur: 2.35, text: 'Raid OS. Меньше вкладок — больше рейдов.', pauses: [[0.69, 0.82]] },
]

/** Scenes of the picture (from, to). */
export const SCENES = {
  intro: [0, 5.6],
  tour: [5.6, 11.2],
  map: [11.2, 18.4],
  item: [18.4, 24.3],
  testing: [24.3, 29.1],
  outro: [29.1, 34.0],
}
export const DURATION = SCENES.outro[1]

/** Moments of the story (video seconds): the keys pressed on the PC and what the phone gets from the server. */
export const MOMENTS = {
  // «…нажимаете клавишу скриншота на ПК» — the key, then the PC's position reaches the phone through the server.
  screenshotKey: 13.2,
  positionSent: 13.35,
  // «Навели на предмет и нажали клавишу» — the item key, then the recognised item.
  itemHover: 18.9,
  itemKey: 20.1,
  itemSent: 20.25,
}

/** The phone take covers the intro to the end of «testing»; the outro holds its last frame. */
export const TAKE = { from: 0, to: SCENES.testing[1] }
