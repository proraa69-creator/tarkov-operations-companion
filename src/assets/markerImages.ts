import type { MarkerLayerId } from '../domain/types'
import pmcExtraction from './map-markers/01_pmc_extraction.png'
import coopExtraction from './map-markers/03_coop_extraction.png'
import transition from './map-markers/04_transition.png'
// Quest and quest-item markers are red geotag pins drawn in the tactical style.
import quest from './map-markers/geotag/quest-tactical.svg'
import questItem from './map-markers/geotag/quest-item-tactical.svg'
// Locked doors (the «key» layer holds tarkov.dev locks): a real brown wooden door (owner, 11.11.2026: «Сделай двери коричневые,
// деревянные… Реалистичные»), so it no longer looks like the battle pass documents. Cut from the photo «Lakeside Door» by Jason
// Rosewell (Unsplash), CC0: https://commons.wikimedia.org/wiki/File:Lakeside_Door_(Unsplash).jpg — toned brown, in a dark jamb.
import key from './map-markers/real/door.webp'
// «Реалистичный» (owner, 09.11.2026): the loot layers as the game's own pictures of the things (tarkov.dev base images);
// the key is the same picture in every style («Картинка ключа везде»).
import lootKey from './map-markers/real/key.webp'
import realMedical from './map-markers/real/medical.webp'
import realValuable from './map-markers/real/valuable.webp'
import realTechnical from './map-markers/real/technical.webp'
import realProvision from './map-markers/real/provision.webp'
import realContainer from './map-markers/real/container.webp'
import boss from './map-markers/08_boss.png'
import spawn from './map-markers/09_spawn.png'
// PMC and Scav spawns: the running man of the Scav exit's picture, green and orange.
import spawnPmc from './map-markers-new/spawn-pmc.svg'
import spawnScav from './map-markers-new/spawn-scav.svg'
import danger from './map-markers/10_danger.png'
import landmark from './map-markers/11_landmark.png'
// «Станковое оружие»: the AGS-30 itself (owner, 11.11.2026: «реальная картинка АГС или утеса, просто обрезанная»), cut out of the
// photo «AGS-30 maks2009» by Allocer, CC BY-SA 3.0: https://commons.wikimedia.org/wiki/File:AGS-30_maks2009.jpg
import mountedWeapon from './map-markers/real/ags-30.webp'
import battlePassDocuments from './map-markers/documents/folder.webp'
// Power switches (рубильники): the wall box with its lever, as in the game.
import powerSwitch from './map-markers/geotag/switch-tactical.svg'
// BTR stops: the carrier from the side.
import btr from './map-markers-new/btr.svg'
// «100 % спавн»: a gold badge with a tick.
import lootGuaranteed from './map-markers-new/loot-guaranteed.svg'

export const markerImages: Record<MarkerLayerId, string> = {
  'extract.pmc': pmcExtraction,
  'extract.scav': pmcExtraction,
  'extract.coop': coopExtraction,
  transit: transition,
  'quest.zone': quest,
  'quest.item': questItem,
  key,
  boss,
  spawn,
  'spawn.pmc': spawnPmc,
  'spawn.scav': spawnScav,
  hazard: danger,
  landmark,
  'loot.valuable': realValuable,
  'loot.weapon': mountedWeapon,
  'loot.medical': realMedical,
  'loot.provision': realProvision,
  'loot.technical': realTechnical,
  'loot.container': realContainer,
  'loot.documents': battlePassDocuments,
  'loot.key': lootKey,
  'loot.guaranteed': lootGuaranteed,
  switch: powerSwitch,
  btr,
}
