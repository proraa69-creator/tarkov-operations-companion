import type { MarkerLayerId } from '../domain/types'
import pmcExtraction from './map-markers/01_pmc_extraction.png'
import coopExtraction from './map-markers/03_coop_extraction.png'
import transition from './map-markers/04_transition.png'
// Quest and quest-item markers are red geotag pins drawn in the tactical style.
import quest from './map-markers/geotag/quest-tactical.svg'
import questItem from './map-markers/geotag/quest-item-tactical.svg'
// Locked doors and keycard readers (the «key» layer holds tarkov.dev locks), drawn as a door with a card reader.
import key from './map-markers/geotag/door-lock-tactical.svg'
import lootKey from './map-markers-new/loot-key-314.svg'
import boss from './map-markers/08_boss.png'
import spawn from './map-markers/09_spawn.png'
// PMC and Scav spawns: the running man of the Scav exit's picture, green and orange.
import spawnPmc from './map-markers-new/spawn-pmc.svg'
import spawnScav from './map-markers-new/spawn-scav.svg'
import danger from './map-markers/10_danger.png'
import landmark from './map-markers/11_landmark.png'
import valuableLoot from './map-markers/12_valuable_loot.png'
import weaponsAmmo from './map-markers/13_weapons_ammo.png'
import medicine from './map-markers/14_medicine.png'
import provisions from './map-markers/15_provisions.png'
import technicalLoot from './map-markers/16_technical_loot.png'
import containerStash from './map-markers/17_container_stash.png'
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
  'loot.valuable': valuableLoot,
  'loot.weapon': weaponsAmmo,
  'loot.medical': medicine,
  'loot.provision': provisions,
  'loot.technical': technicalLoot,
  'loot.container': containerStash,
  'loot.documents': battlePassDocuments,
  'loot.key': lootKey,
  'loot.guaranteed': lootGuaranteed,
  switch: powerSwitch,
  btr,
}
