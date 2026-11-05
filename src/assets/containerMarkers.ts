import type { LootContainerKind } from '../data/lootContainerKinds'
import buriedBarrelCache from './map-markers/containers/buried-barrel-cache.webp'
import cashRegister from './map-markers/containers/cash-register.webp'
import civilianBody from './map-markers/containers/civilian-body.webp'
import deadScav from './map-markers/containers/dead-scav.webp'
import drawer from './map-markers/containers/drawer.webp'
import duffleBag from './map-markers/containers/duffle-bag.webp'
import grenadeBox from './map-markers/containers/grenade-box.webp'
import groundCache from './map-markers/containers/ground-cache.webp'
import jacket from './map-markers/containers/jacket.webp'
import labTechnicianBody from './map-markers/containers/lab-technician-body.webp'
import medbag from './map-markers/containers/medbag.webp'
import medcase from './map-markers/containers/medcase.webp'
import medicalSupplyCrate from './map-markers/containers/medical-supply-crate.webp'
import pcBlock from './map-markers/containers/pc-block.webp'
import plasticSuitcase from './map-markers/containers/plastic-suitcase.webp'
import pmcBody from './map-markers/containers/pmc-body.webp'
import rationSupplyCrate from './map-markers/containers/ration-supply-crate.webp'
import safe from './map-markers/containers/safe.webp'
import shturmansStash from './map-markers/containers/shturmans-stash.webp'
import technicalSupplyCrate from './map-markers/containers/technical-supply-crate.webp'
import toolbox from './map-markers/containers/toolbox.webp'
import weaponBox from './map-markers/containers/weapon-box.webp'
import woodenAmmoBox from './map-markers/containers/wooden-ammo-box.webp'
import woodenCrate from './map-markers/containers/wooden-crate.webp'

/**
 * Loot containers in the «Стандартные» style (owner, 06.11.2026: «маленькие маркеры реалистичные… не мультяшные»; «без кругов и
 * фона, просто картинка»): each one cut out of its in-game picture on the official wiki, 64 px, nothing around it.
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
