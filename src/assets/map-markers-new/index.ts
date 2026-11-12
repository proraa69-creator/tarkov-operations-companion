import type { MarkerLayerId } from '../../domain/types'
import extractPmc from './extract-pmc.svg'
import extractScav from './extract-scav.svg'
import extractCoop from './extract-coop.svg'
import transit from './transit.svg'
import questZone from './quest-zone.svg'
import questItem from './quest-item.svg'
// Locked doors: the real brown wooden door of every style (see ../markerImages.ts for the photo and its CC0 licence).
import key from '../map-markers/real/door.webp'
// Report №108: a key, after the marked key of room 314; the doors keep the lock.
import lootKey from '../map-markers/real/key.webp'
import boss from './boss.svg'
import spawn from './spawn.svg'
import spawnPmc from './spawn-pmc.svg'
import spawnScav from './spawn-scav.svg'
import sniper from './sniper.svg'
import hazard from './hazard.svg'
// Loot as real things (owner, 11.11.2026: «Все иконки должны быть не нарисованы, а картинки взяты с реалистичных предметов»): the
// game's pictures of «Реалистичные» (../map-markers/real/*), with no outline or glow round them (owner, 11.11.2026);
// the mounted weapons as the AGS-30 photo (see ../markerImages.ts).
import lootValuable from './real-valuable.webp'
import lootWeapon from '../map-markers/real/ags-30.webp'
import lootMedical from './real-medical.webp'
import lootProvision from './real-provision.webp'
import lootTechnical from './real-technical.webp'
import lootContainer from './real-container.webp'
import lootDocuments from '../map-markers/documents/folder.webp'
import landmark from './landmark.svg'
import powerSwitch from './switch.svg'
// The drawn carrier (owner, 11.11.2026: «добавить предыдущие маркеры бтр»), as in «Реалистичные».
import btr from './btr.svg'
import lootGuaranteed from './loot-guaranteed.svg'

/** «Стандартные» marker icons (no background plate), one per map layer: flat drawings, the door and the loot as real pictures. */
export const newMarkerImages: Record<MarkerLayerId, string> = {
  'extract.pmc': extractPmc,
  'extract.scav': extractScav,
  'extract.coop': extractCoop,
  transit,
  'quest.zone': questZone,
  'quest.item': questItem,
  key,
  boss,
  spawn,
  'spawn.pmc': spawnPmc,
  'spawn.scav': spawnScav,
  sniper,
  hazard,
  'loot.valuable': lootValuable,
  'loot.weapon': lootWeapon,
  'loot.medical': lootMedical,
  'loot.provision': lootProvision,
  'loot.technical': lootTechnical,
  'loot.container': lootContainer,
  'loot.documents': lootDocuments,
  'loot.key': lootKey,
  'loot.guaranteed': lootGuaranteed,
  landmark,
  switch: powerSwitch,
  btr,
}
