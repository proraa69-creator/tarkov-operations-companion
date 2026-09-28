import type { MarkerLayerId } from '../../domain/types'
import extractPmc from './extract-pmc.svg'
import extractScav from './extract-scav.svg'
import extractCoop from './extract-coop.svg'
import transit from './transit.svg'
import questZone from './quest-zone.svg'
import questItem from './quest-item.svg'
import key from './key.svg'
import boss from './boss.svg'
import spawn from './spawn.svg'
import hazard from './hazard.svg'
import lootValuable from './loot-valuable.svg'
import lootWeapon from './loot-weapon.svg'
import lootMedical from './loot-medical.svg'
import lootProvision from './loot-provision.svg'
import lootTechnical from './loot-technical.svg'
import lootContainer from './loot-container.svg'
import lootDocuments from './loot-documents.svg'
import landmark from './landmark.svg'

/** Flat outlined marker icons (48x48, no background plate), one per map layer. */
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
  hazard,
  'loot.valuable': lootValuable,
  'loot.weapon': lootWeapon,
  'loot.medical': lootMedical,
  'loot.provision': lootProvision,
  'loot.technical': lootTechnical,
  'loot.container': lootContainer,
  'loot.documents': lootDocuments,
  landmark,
}
