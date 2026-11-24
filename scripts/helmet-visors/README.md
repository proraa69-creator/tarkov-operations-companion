# Helmet visor pictures («Тир листы» → «Шлемы»)

The pictures in `src/assets/helmet-visors/<helmet id>.<down|up>.webp` (owner, 20.11.2026: «сделай скрины под каждый шлем с
забралами… опустить, поднять забрало»). Made in the offline SPT copy on `E:\SPT` (client 0.16.9), never in the live game.

1. `python make_jobs.py <plugin folder>\jobs.json 512` — each helmet with its built-in plates and the visor that suits it.
2. Build `RaidOsHelmets.csproj` (`dotnet build -c Release`), put the dll and `jobs.json` into `E:\SPT\BepInEx\plugins\RaidOsHelmets`.
3. Start the game to its main menu, then create `go.flag` in that folder (it waits while RaidOsGuns renders). The plugin sets the
   visor's `TogglableComponent.On` (down = true) and draws the helmet with the game's own inventory icon renderer
   (`ItemIconCreator.GetItemSpriteAsync`: the pose from the model's `PreviewPivot`, the icon lights; no icon cache is written):
   `out/<name>.<down|up>.icon.png`.
4. `python pack_icons.py <plugin folder>\out src\assets\helmet-visors sheet.png icon [current icons dir]` — 128 px cells on the
   inventory cell's background, like the other tier-list pictures.

What the game counts with the visor up or down (Assembly-CSharp 0.16.9) is in `src/screen/tierLists.ts` `helmetWorn`.
