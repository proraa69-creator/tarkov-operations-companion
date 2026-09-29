import type { MarkerLayerId } from '../domain/types'
import pmcExtraction from './map-markers/01_pmc_extraction.png'
import coopExtraction from './map-markers/03_coop_extraction.png'
import transition from './map-markers/04_transition.png'
// Quest and quest-item markers are red geotag pins drawn in the tactical style.
import quest from './map-markers/geotag/quest-tactical.svg'
import questItem from './map-markers/geotag/quest-item-tactical.svg'
// Locked doors and keycard readers (the «key» layer holds tarkov.dev locks), drawn as a door with a card reader.
import key from './map-markers/geotag/door-lock-tactical.svg'
import boss from './map-markers/08_boss.png'
import spawn from './map-markers/09_spawn.png'
import danger from './map-markers/10_danger.png'
import landmark from './map-markers/11_landmark.png'
import valuableLoot from './map-markers/12_valuable_loot.png'
import weaponsAmmo from './map-markers/13_weapons_ammo.png'
import medicine from './map-markers/14_medicine.png'
import provisions from './map-markers/15_provisions.png'
import technicalLoot from './map-markers/16_technical_loot.png'
import containerStash from './map-markers/17_container_stash.png'
import battlePassDocuments from './map-markers/18_battle_pass_documents.svg'

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
  hazard: danger,
  landmark,
  'loot.valuable': valuableLoot,
  'loot.weapon': weaponsAmmo,
  'loot.medical': medicine,
  'loot.provision': provisions,
  'loot.technical': technicalLoot,
  'loot.container': containerStash,
  'loot.documents': battlePassDocuments,
}
