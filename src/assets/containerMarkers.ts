import type { LootContainerKind } from '../data/lootContainerKinds'
import buriedBarrelCache from './map-markers/containers/buried-barrel-cache.svg'
import cashRegister from './map-markers/containers/cash-register.svg'
import civilianBody from './map-markers/containers/civilian-body.svg'
import deadScav from './map-markers/containers/dead-scav.svg'
import drawer from './map-markers/containers/drawer.svg'
import duffleBag from './map-markers/containers/duffle-bag.svg'
import grenadeBox from './map-markers/containers/grenade-box.svg'
import groundCache from './map-markers/containers/ground-cache.svg'
import jacket from './map-markers/containers/jacket.svg'
import labTechnicianBody from './map-markers/containers/lab-technician-body.svg'
import medbag from './map-markers/containers/medbag.svg'
import medcase from './map-markers/containers/medcase.svg'
import medicalSupplyCrate from './map-markers/containers/medical-supply-crate.svg'
import pcBlock from './map-markers/containers/pc-block.svg'
import plasticSuitcase from './map-markers/containers/plastic-suitcase.svg'
import pmcBody from './map-markers/containers/pmc-body.svg'
import rationSupplyCrate from './map-markers/containers/ration-supply-crate.svg'
import safe from './map-markers/containers/safe.svg'
import shturmansStash from './map-markers/containers/shturmans-stash.svg'
import technicalSupplyCrate from './map-markers/containers/technical-supply-crate.svg'
import toolbox from './map-markers/containers/toolbox.svg'
import weaponBox from './map-markers/containers/weapon-box.svg'
import woodenAmmoBox from './map-markers/containers/wooden-ammo-box.svg'
import woodenCrate from './map-markers/containers/wooden-crate.svg'

/**
 * Loot containers in the «Стандартные» style (owner, 06.11.2026: «еле видно на карте. Переделай их все под наш стиль, прям возьми,
 * как трафарет перерисуй»): each thing's shape and colours taken from the game, drawn like the map's other marks, a dark outline
 * and a lit rim, nothing around it. Drawn by scripts/draw-container-markers.mjs.
 */
export const LOOT_CONTAINER_PICTURES: Record<LootContainerKind, string> = {
  safe,
  'cash-register': cashRegister,
  jacket,
  'duffle-bag': duffleBag,
  medbag,
  medcase,
  toolbox,
  'pc-block': pcBlock,
  drawer,
  'plastic-suitcase': plasticSuitcase,
  'weapon-box': weaponBox,
  'grenade-box': grenadeBox,
  'wooden-ammo-box': woodenAmmoBox,
  'wooden-crate': woodenCrate,
  'technical-supply-crate': technicalSupplyCrate,
  'medical-supply-crate': medicalSupplyCrate,
  'ration-supply-crate': rationSupplyCrate,
  'buried-barrel-cache': buriedBarrelCache,
  'ground-cache': groundCache,
  'shturmans-stash': shturmansStash,
  'dead-scav': deadScav,
  'pmc-body': pmcBody,
  'civilian-body': civilianBody,
  'lab-technician-body': labTechnicianBody,
}
