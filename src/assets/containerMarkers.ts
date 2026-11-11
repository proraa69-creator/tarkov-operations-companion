import type { LootContainerKind } from '../data/lootContainerKinds'
import buriedBarrelCache from './map-markers/containers-real/buried-barrel-cache.webp'
import cashRegister from './map-markers/containers-real/cash-register.webp'
import civilianBody from './map-markers/containers-real/civilian-body.webp'
import deadScav from './map-markers/containers-real/dead-scav.webp'
import drawer from './map-markers/containers-real/drawer.webp'
import duffleBag from './map-markers/containers-real/duffle-bag.webp'
import grenadeBox from './map-markers/containers-real/grenade-box.webp'
import groundCache from './map-markers/containers-real/ground-cache.webp'
import jacket from './map-markers/containers-real/jacket.webp'
import labTechnicianBody from './map-markers/containers-real/lab-technician-body.webp'
import medbag from './map-markers/containers-real/medbag.webp'
import medcase from './map-markers/containers-real/medcase.webp'
import medicalSupplyCrate from './map-markers/containers-real/medical-supply-crate.webp'
import pcBlock from './map-markers/containers-real/pc-block.webp'
import plasticSuitcase from './map-markers/containers-real/plastic-suitcase.webp'
import pmcBody from './map-markers/containers-real/pmc-body.webp'
import rationSupplyCrate from './map-markers/containers-real/ration-supply-crate.webp'
import safe from './map-markers/containers-real/safe.webp'
import shturmansStash from './map-markers/containers-real/shturmans-stash.webp'
import technicalSupplyCrate from './map-markers/containers-real/technical-supply-crate.webp'
import toolbox from './map-markers/containers-real/toolbox.webp'
import weaponBox from './map-markers/containers-real/weapon-box.webp'
import woodenAmmoBox from './map-markers/containers-real/wooden-ammo-box.webp'
import woodenCrate from './map-markers/containers-real/wooden-crate.webp'

/**
 * Loot containers in the «Стандартные» style as the real things (owner, 11.11.2026: «контейнеры, сделай реалистичные, как в
 * Таркове»): each one's in-game picture, cut out (the pictures of before f52d785b), a little brighter so they no longer
 * get lost on the map (owner, 06.11.2026: «еле видно на карте»); no outline or glow round them (owner, 11.11.2026). The drawn ones stay in map-markers/containers/.
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
