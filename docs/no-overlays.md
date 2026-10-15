# No in-game overlays (15.10.2026)

Owner, 15.10.2026: «После выпуска убирай функции оверлей, карта поверх игры и информация о предмете поверх игры. все это
будет только в приложении на карте… Перенесем эти функции в телефоне, что бы не считалось оверлеем».

## Removed from the PC app

- The minimap window over the game («Мини Карта»): `src/overlay/OverlayApp.tsx`, `minimapView`, `minimapSize`,
  `minimapClicks`, `overlay.css`, its window, hit-test loop, drag/resize/zones and click-through code in
  `electron/experimental/index.ts`, `inputReattach.ts`, `mapScreenshotRetention.ts` (it kept only the screenshots taken
  with the minimap key).
- The item card over the game (the Kappa / MATE badge over items in raid): its window, `itemCardPlacement`, the cursor
  follow.
- All overlay IPC (`overlay:*`, `experimental:toggle-minimap`) in `main.ts`, `experimental/index.ts`, `preload.ts`,
  `preload.cjs`; the minimap hotkey; the minimap signal of `raidSignals.ts`.
- The «Мини Карта» page (`/experimental`, now a redirect to «Настройки»), its sidebar entry, the opacity / size sliders,
  the minimap key, «Показать / скрыть», the borderless note, the guide's «Мини-карта» tip, the one-time «функция
  мини-карты временно выключена» dialog, and the owner's «Окно мини-карты поверх игры» button.
- Settings files drop `minimapKey`, `minimapOpacity`, `minimapWidth`, `minimapPosition`, `showOnScreenshot` (version 5).

Nothing in the app is always-on-top, transparent or click-through any more; the main window is the only window.

## Kept (they read the screen, they draw nothing over the game)

Screenshot → position (`positionTracker`, `screenshotPosition`), the item lookup (`tooltipLookup`, `itemMatch`,
`iconMatch`, `itemCell`), the item key and the Collector scan key, the game's screenshot key check (`PositionSetupCard`,
`positionReadiness`, now only «no screenshot key in the game»), administrator rights. Their settings moved to
«Настройки» → «Карта и предметы в рейде» (`src/pages/RaidToolsSettings.tsx`).

## Where things show now

- PC «Карты»: the player's marker with direction on the map of the current raid (the map and the floor follow each new
  screenshot); the recognised item's card top-left, under «Вид» (`src/components/MapItemCard.tsx`), until the next item or
  «Закрыть». An item recognised while another page is open waits there (`src/items/recognisedItem.ts`).
- Phone «Карты»: the same marker and card, pushed through the server's live relay (`server/src/routes/live.ts`,
  `server/src/services/liveRelay.ts`): GET `/v1/live/:mode?since=` long-polls; the PC posts `/v1/live/:mode/position` and
  `/v1/live/:mode/item`. Same account only, same access as the game data, per mode, in memory with a TTL (position 5 min,
  item 2 min), rate-limited. When the relay cannot be reached the phone polls `/v1/me/position/:mode` every 3 s.

## Older app versions

They keep their overlays until they update. The server still answers `features.minimapOverlay` and the owner's PUT for
it (only those versions read it), still accepts `POST /v1/me/position`, and `GET /v1/me/position` also returns the live
position, so old phones see the new PCs and new phones see the old PCs.
