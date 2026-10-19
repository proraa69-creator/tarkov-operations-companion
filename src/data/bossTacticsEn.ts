import type { BossTactics } from './bossTactics'

/**
 * «Тактика боя» in English (owner, 13.10.2026: the English interface everywhere, the tactics page was Russian only):
 * the lines of bossTactics.ts translated one to one, in the same order (bossTacticsEn.test.ts checks every boss and every
 * list). Sources stay in bossTactics.ts.
 */
export type BossTacticsText = Pick<BossTactics, 'summary' | 'behavior' | 'weakPoints' | 'tactics' | 'dangers' | 'loot'>

export const BOSS_TACTICS_EN: Record<string, BossTacticsText> = {
  reshala: {
    summary: 'Leader of the Customs Scavs with four guards (up to five in some sources). Found by the dorms, the new gas station and the Fortress; sometimes on Terminal.',
    behavior: [
      'Reshala himself stays back and hides while his guards move forward: they push aggressively and flank.',
      'The guards throw a lot of grenades and flashbangs, especially when you hold a room or sit behind cover.',
      'The guards stick together and quickly converge on noise: shooting one of them wakes them all.',
      'The guards are much better equipped than the boss: helmets, body armor, rifles and shotguns.',
      'A Scav player with Fence reputation above 6 is usually not attacked first by the boss and his guards (this was being fixed in 1.2.0.0).',
    ],
    weakPoints: [
      'Reshala wears no armor: a short burst to the head or chest with almost any round is enough.',
      'The guards wear helmets and body armor: PS and weak 5.56 will not do, bring BS, BP, M995 and the like.',
      'If your rounds lack penetration, shoot the guards in the legs.',
    ],
    tactics: [
      'Do not rush Reshala: first take out the guards one by one from cover.',
      'Keep a wall behind you and stay out of the open, or the guards will pin you from two or three sides.',
      'The guards move in a group: one grenade into them often stuns or kills two at once.',
      'In the dorms, hold the stairs or the door they will push through and let them come to you.',
      'Do not loot until you are sure every guard is dead: the last one will come to the bodies.',
      'In PvE since 1.2.0.0, PMC bots attack bosses more often: shooting at a spawn point may mean the guards are already worn down.',
    ],
    dangers: [
      'Tunnel vision on the boss while a guard you never saw comes from behind.',
      'A flashbang or grenade into your room, followed by a push.',
      'Dying while looting to a guard you did not finish.',
    ],
    loot: 'Golden TT, physical bitcoin; rarely a Labs keycard.',
  },
  killa: {
    summary: 'A loner without guards, in heavy armor and with a machine gun. Stays in the middle of the ULTRA mall on Interchange — by IDEA, OLI and Goshan, on the 1st and 2nd floors and in the parking lots; also seen on Terminal.',
    behavior: [
      'Once he spots a target, he attacks at once: runs at you, lays down suppressive fire and does not retreat.',
      'He strafes constantly and dashes between cover, so headshots on the move are hard.',
      'Throws grenades to flush you out of cover; sometimes smokes too.',
      'When he loses sight of you, he goes to the last place he saw you — often through the same door or passage.',
      'Hostile to PMCs and to Scavs alike, unless the Scav has high Fence reputation.',
    ],
    weakPoints: [
      'Unarmored legs (120 HP each): the "leg meta" is the safest option with weak rounds.',
      '6B13 M (Killa) body armor is class 5: the chest needs BS, Igolnik, M995, M61 or 7.62×39 BP.',
      'The Maska-1Shch face shield is class 6 and the helmet itself class 4: aim at the helmet above the shield, not at the face.',
      'The head has only 70 HP: one shot that gets through the helmet often ends the fight.',
    ],
    tactics: [
      'Do not fight in the long open corridors of the mall: he wins a spray on the move. Play around pillars, shop fronts and the passages between floors.',
      'Let him come to you: hold the corner or the door he will push through.',
      'A grenade will hardly kill him — throw it to break his push or to drive him out of cover.',
      'Fire at his legs slows him down — then finish him in the helmet or the chest.',
      'Two players have it easier: while he suppresses one, the other comes from behind.',
    ],
    dangers: [
      'A firefight in an open corridor against a light machine gun on the move.',
      'Counting on a grenade: he runs out from behind cover and finishes you point-blank.',
      'Trackers say Tagilla can also be on Interchange — do not relax after Killa.',
    ],
    loot: 'Killa\'s Maska-1Shch helmet and 6B13 M body armor, RPK-16; a chance of the KIBA key, a Labs keycard and bitcoin.',
  },
  glukhar: {
    summary: 'The Reserve boss with up to six guards: scouts, security and assault troops. Spawns by the "chess" buildings (White Knight and others), the barracks, the storage bunkers and the train station; also seen on Terminal.',
    behavior: [
      'His guards work as a squad: the scouts (SMGs, light armor) engage first, then the security with rifles rushes in.',
      'The assault troops are the most armored and usually hold position next to Glukhar.',
      'The security often works in pairs: one pair presses while the other flanks.',
      'Guides say Glukhar himself barely uses cover — he can be caught in the open.',
      'He patrols the base, so you can meet him away from his spawn — for example by the train station when the train arrives.',
      'The number and gear of his guards change from raid to raid.',
    ],
    weakPoints: [
      'The head has 70 HP: a shot that gets through the helmet is the fastest option.',
      'Unarmored arms and legs, 145 HP each: with weak rounds, shoot the legs.',
      'The guards wear class 4–5 body armor and helmets, some with face shields: bring BP, BS, M995, M61 and the like.',
      'Guides disagree about Glukhar\'s own armor — bring armor-piercing rounds with ammo to spare.',
    ],
    tactics: [
      'Do not take on the whole group at once: make noise, draw some of the guards out and pick them off one by one.',
      'Fight from a room with a single entrance — they will have to come in one at a time.',
      'Grenades decide fights here: the assault troops and Glukhar stay close together, one grenade can catch several.',
      'Avoid the open yards and the parade ground — you will be shot from several sides there.',
      'Peek from the right side and change position after every shot instead of holding one corner.',
      'Solo, only from an ambush; two or three players is safer, or catch the squad moving between buildings.',
    ],
    dangers: [
      'A hit from the ASh-12 (12.7×55) — huge damage even through good armor.',
      'The second pair of guards flanking you while you deal with the first.',
      'A fight in the open against all of his guards at once.',
    ],
    loot: 'ASh-12, IFAK first aid kit, the Reserve minefield map; a chance of a Labs keycard.',
  },
  shturman: {
    summary: 'The Woods boss: holds the sawmill with two guards and fights at long range.',
    behavior: [
      'He and his guards prefer long range: they watch the sightlines around the sawmill and rarely push.',
      'Before aimed fire Shturman may fire a few warning shots from his SVD — it means you have been spotted.',
      'They like to hide behind the log piles and inside the buildings, where they are hard to reach.',
      'They shoot very accurately — in the open they will take you apart quickly.',
    ],
    weakPoints: [
      'Shturman himself usually wears no armor: a couple of hits to the chest or head with any decent round is enough.',
      'His guards may wear armor — bring rounds with good penetration for them.',
      'Up close his accuracy advantage is gone.',
    ],
    tactics: [
      'Do not step onto the open field by the sawmill — approach through the forest and the buildings.',
      'Close the distance: the squad\'s sniper play does not work up close.',
      'Smoke and hard cover are more reliable than a long-range duel.',
      'If you hear warning shots, leave the line of fire at once and change position.',
      'Deal with the guards first, then Shturman; loot the bodies only once the area is clear.',
    ],
    dangers: [
      'Walking into an open clearing under long-range fire.',
      'A long-range firefight against three accurate shooters at once.',
    ],
    loot: 'Shturman\'s stash key (always), SVDS; a chance of a graphics card and a Labs keycard.',
  },
  tagilla: {
    summary: 'Killa\'s brother, a loner with a sledgehammer and a welding mask. His home is Factory (day and night); trackers also report him on Interchange and Terminal.',
    behavior: [
      'Active from the start of the raid: he does not wait to be provoked and looks for targets himself.',
      'At range he fires a shotgun (Saiga-12K, MP-155); up close he pulls out the sledgehammer and charges you.',
      'He can wait in ambush behind a corner and burst into rooms.',
      'If he cannot reach you (stairs, catwalks, beams), he shoots with his main weapon.',
      'A sledgehammer hit deals huge damage and breaks limbs — up close it is almost a one-shot.',
    ],
    weakPoints: [
      'The Crye AVS (Tagilla) plate carrier is class 6 but covers only the chest: the stomach and legs are unarmored.',
      'The "Gorilla" and "UBEY" welding masks are class 5: with M995, M61, BP or Igolnik you can aim for the head.',
      'With weak or expanding rounds — only the stomach and legs.',
      'The back of the head is not covered by the mask: a team can come from behind, but sources disagree on this.',
    ],
    tactics: [
      'Do not stand in long straight corridors — pick doors, stairs and catwalks he has to come through.',
      'Keep 5–10 m between you and back off when he charges: the sledgehammer is only dangerous when he is right on you.',
      'Shoot his legs to stop the charge, then finish him in the stomach or head.',
      'Reload only behind cover and with distance to spare — a pause often ends with the sledgehammer.',
      'In a team, one player keeps his attention while the other comes from behind.',
    ],
    dangers: [
      'Close combat in a corridor — one or two sledgehammer hits.',
      'An ambush behind a corner or a door, especially on night Factory.',
      'Shooting the chest with weak rounds — the class 6 plate simply soaks it.',
    ],
    loot: 'A welding mask ("Gorilla", "UBEY" and others), Tagilla\'s plate carrier; the sledgehammer cannot be looted.',
  },
  sanitar: {
    summary: 'The Shoreline boss and the game\'s main medic: walks with 2–3 guards around the resort, the pier and the cottages; also seen on Terminal.',
    behavior: [
      'Aggressive but not reckless: he uses cover and flanks.',
      'Heals himself and his guards and uses stimulants mid-fight — a Sanitar you did not finish is quickly back in action.',
      'Badly wounded, he may fall back to heal and then return.',
      'His guards work well together: covering fire, suppression and flanking.',
      'Dangerously accurate at close and medium range.',
    ],
    weakPoints: [
      'Sanitar himself wears no armor; the head has 70 HP — the fastest kill.',
      'Chest 360 HP, legs 230 each: bursts to the body will not drop him quickly, especially while he uses stims.',
      'The guards almost always wear class 5 armor and helmets with face shields — bring BP, BS, M995, M61 or better.',
    ],
    tactics: [
      'Once he is wounded, finish him at once: any pause gives him time to stim and heal.',
      'Take out the guards first, or they will flank you while you chase Sanitar.',
      'Keep to medium or long range when you can.',
      'In the resort, watch both wings and the stairs — the fight often moves between floors.',
      'Do not stand on the open pier: besides his guards, other PMCs can easily shoot you there.',
    ],
    dangers: [
      'A drawn-out fight: Sanitar heals while you spend time and ammo.',
      'The guards flanking you in the resort.',
      'An exposed position on the pier.',
    ],
    loot: 'Sanitar\'s bag with surgical kits (CMS, Surv12), stimulants and meds, keys to valuable rooms.',
  },
  kaban: {
    summary: 'The Streets of Tarkov boss: dug in at the LexOs car dealership with a large crew — lieutenants Basmach and Gus, armored guards and snipers on the roofs.',
    behavior: [
      'Kaban himself never leaves his base: he stays in the dealership and the fenced lot next to it.',
      'He suppresses with long PKP bursts, pinning you behind cover.',
      'Snipers on the roofs cover the approaches, the guards hold the windows and the cover.',
      'Mounted AGS-30 and Utyos guns stand on the grounds, and the grass and dirt around are mined with claymores.',
      'The guards react to noise and come out to the entrances of the base.',
    ],
    weakPoints: [
      'Most guides say Kaban wears no armor and his head has 85 HP: two penetrating hits are enough. Some sources mention armor under his clothes.',
      'His body is very tough: chest 355 HP, stomach 260.',
      'The guards wear class 4–5 armor — bring armor-piercing rounds.',
    ],
    tactics: [
      'Take out the rooftop snipers first, and only then move onto the grounds.',
      'Approach from the north along Chekannaya Street and stay on asphalt and concrete: the mines are in the grass and dirt.',
      'Draw the guards to the entrances one by one and fight from cover, out of the crossfire.',
      'Use grenades to drive the guards out of cover; stay out of the AGS and Utyos sectors.',
      'Slow right-side peeks buy you time before you are spotted.',
      'Finish Kaban himself with headshots, not bursts to the body.',
    ],
    dangers: [
      'A claymore in the grass or dirt on the way in.',
      'A rooftop sniper you did not take out first.',
      'Crossfire from the PKP, the guards and the mounted guns.',
    ],
    loot: 'PKP Pecheneg (if he carries it), the key to the locked section of the dealership; a chance of a Labs keycard.',
  },
  kollontay: {
    summary: 'A Streets of Tarkov boss, a former security officer with a rubber baton. Found at the Klimov mall or the MVD Academy with guards (2–4 depending on the source).',
    behavior: [
      'He prefers to hold position and only occasionally patrols his area.',
      'His guards push aggressively while Kollontay stays behind.',
      'He and his guards use frag grenades and flashbangs.',
      'When he feels he has the upper hand, he closes in and finishes you with his PR-Taran baton.',
      'Guides say a baton hit can jam and damage your weapon.',
    ],
    weakPoints: [
      'The PSh-97 DJETA helmet with its face shield stops weak rounds, but the head has only 65 HP — with armor-piercing rounds, aim for the head.',
      'Unarmored legs, 120 HP each — the best option with low penetration.',
      'Chest 300 HP: shooting the body takes a long time.',
    ],
    tactics: [
      'Take out the guards first — they push harder than Kollontay himself.',
      'Do not let him get close: keep to medium range, out of reach of the baton.',
      'Use stairs and high ground — his guards will not be able to rush you all at once.',
      'In the Klimov mall, make the guards come up the side stairs and meet them there.',
      'Stretch the group out with cover and long sightlines and pick them off one by one.',
    ],
    dangers: [
      'Close combat and a baton hit.',
      'A grenade or flashbang into your position, followed by a push from the guards.',
    ],
    loot: 'PR-Taran rubber baton, PSh-97 DJETA helmet.',
  },
  partisan: {
    summary: 'A lone saboteur who roams Customs, Woods, Shoreline and Lighthouse. He hunts players with low karma first; the chance to meet him depends on the karma of the PMCs in the raid and changes with patches.',
    behavior: [
      'He moves stealthily: hides in the terrain and in bushes, sets tripwires in advance and during the fight.',
      'A fight often starts with one of his tripwires going off before you ever see him.',
      'He strikes and falls back, changing position — he fights only on his own terms.',
      'He never sets off tripwires, neither his own nor the players\'; his footsteps are quieter than a regular Scav\'s.',
      'He throws a lot of grenades and fires a GP-25 underbarrel launcher.',
      'He hunts PMCs and Scavs with low karma first, but may attack anyone who gets too close.',
    ],
    weakPoints: [
      'Head 80 HP, chest 220: he goes down fastest from hits to the head and chest.',
      'He has no guards — once you have found him, it is one on one.',
      'Traps are useless against him — rely on gunfire alone.',
    ],
    tactics: [
      'Avoid the obvious paths: his tripwires are usually set by loot, passages and crossings.',
      'After he attacks, do not run to his last known position — a trap may be waiting there.',
      'Draw him into the open: in the bushes and among cover the fight favors him.',
      'Break line of sight, wait for him to show himself and hit him in the chest or head.',
      'Play "fair": according to BSG, camping, ambushes at extracts and being AFK lower your karma and make you his target.',
    ],
    dangers: [
      'Setting off a tripwire on a path or by loot.',
      'Chasing him through narrow passages full of traps.',
      'A grenade or a VOG round while you look for where the shots come from.',
    ],
    loot: 'The unique "Partisan\'s bag" backpack, VOG-25 rounds, explosives and meds.',
  },
  zryachiy: {
    summary: 'A cultist sniper guarding the Lightkeeper\'s island on Lighthouse; spawns in almost every raid with two followers.',
    behavior: [
      'Sits on the island\'s rocks in a ghillie suit and shoots very accurately with an SVDS — he is hard to spot in advance.',
      'He does not touch players carrying an encoded DSP radio transmitter unless provoked.',
      'Without the transmitter he shoots everyone on the bridge; with it, only if you hit him or his followers.',
      'His two followers respawn (up to three times each) while Zryachiy is alive.',
      'The bridge and the approaches to the island are mined with claymores.',
    ],
    weakPoints: [
      'No armor (the balaclava is cosmetic), but the head has 175 HP and his total is 1655 HP: there will be no one-shot.',
      'You will have to shoot for a long time — bring high-damage rounds and spare magazines.',
      'His scope holds only one player at a time — the others can flank him.',
    ],
    tactics: [
      'Kill Zryachiy first, then his followers, or the followers will keep respawning.',
      'Ideally a trio: one player works on Zryachiy while the other two take both followers at the same time.',
      'Bring your own long-range rifle: trying to close in usually ends on the way there.',
      'Do not stop on the bridge — dash from cover to cover and watch your step for claymores.',
      'Damaging him or his followers un-encodes your DSP transmitter — you will have to encode it again.',
    ],
    dangers: [
      'Stepping onto the bridge or the open rocks under his SVDS.',
      'Claymores on the way to the island.',
      'The wrong order: the followers are dead, they respawn, and Zryachiy is still alive.',
    ],
    loot: 'SVDS, Zryachiy\'s balaclava, the Azimut "Khamelion" chest rig.',
  },
  knight: {
    summary: 'Leader of the Goons (former USEC): moves in a trio with Big Pipe and Birdeye between Customs, Woods, Shoreline and Lighthouse; trackers say he is always on Icebreaker.',
    behavior: [
      'The squad\'s stormtrooper: once he spots a target, he and Big Pipe close in at once and press.',
      'Works as a team: while Knight and Big Pipe push, Birdeye hangs back and waits for his moment.',
      'He gives you no time to breathe or heal — a fight with the Goons is fast and loud.',
      'Guides say the squad keeps to big landmarks: the Fortress on Customs, the Scav bunker on Woods, the weather station on Shoreline, the water treatment plant on Lighthouse.',
    ],
    weakPoints: [
      'The Crye CPC (Goons Edition) armor is class 5: the body needs M995, M61, BS, Igolnik and the like.',
      'The "Death Knight" mask is only class 1: the head (80 HP) is almost bare — a short burst to the head decides it.',
      'Unarmored legs, 150 HP each — the fallback with weak rounds.',
    ],
    tactics: [
      'Do not fight the trio in the open — make them come through a door or a corridor.',
      'Fight from hard cover and isolate the fight so you face one enemy at a time.',
      'Target order: Big Pipe with his grenade launcher and Knight, then look for Birdeye.',
      'Grenades help break their push and drive them out of cover.',
      'Check a Goons tracker before the raid — the squad changes maps.',
    ],
    dangers: [
      'Knight and Big Pipe pushing together while Birdeye holds an angle.',
      'A fight in a field or behind soft cover.',
      'Looting right after killing Knight while Birdeye is still alive.',
    ],
    loot: 'The "Death Knight" mask, Crye CPC (Goons Edition), SIG MCX SPEAR; a chance of a Labs keycard.',
  },
  'big-pipe': {
    summary: 'The Goons\' grenadier: moves in one trio with Knight and Birdeye across Customs, Woods, Shoreline and Lighthouse.',
    behavior: [
      'The main threat is his grenade launcher (M32A1 or FN40GL): it flushes you out of cover and hits your position with arcing shots.',
      'Pushes aggressively together with Knight; up close he switches to a shotgun, rifle or machine gun.',
      'Static and soft cover is a target for him: a rock or a low wall will not save you.',
    ],
    weakPoints: [
      'No helmet, only a bandana: the head has 70 HP, a penetrating headshot is a quick kill.',
      'His body is tough (chest 220, stomach 200 HP) and covered by a plate carrier — the body needs armor-piercing rounds.',
      'Legs 100 HP each — with weak rounds, shoot the legs.',
    ],
    tactics: [
      'Take him out first: the grenade launcher is more dangerous than any rifle in the squad.',
      'Fight inside buildings — walls and ceilings limit the grenades\' arc.',
      'Do not stay behind one piece of cover for long: when you hear the launcher, move.',
      'Choose hard cover — concrete, buildings, terrain — not bushes and fences.',
    ],
    dangers: [
      'A grenade behind the cover you thought was safe.',
      'A push together with Knight while the explosions pin you down.',
    ],
    loot: '40 mm grenades, stimulants; a chance of keys, bitcoin and a Labs keycard.',
  },
  birdeye: {
    summary: 'The Goons\' marksman and scout: stays behind Knight and Big Pipe and shoots from long range.',
    behavior: [
      'The quietest of the trio: he moves almost silently, and many players die without ever seeing him.',
      'While Knight and Big Pipe push, he stays back and comes out when the fight calms down.',
      'Shoots accurately from long range with a marksman rifle (RSASS, M4A1).',
      'He changes position often and rarely returns to the same angle.',
    ],
    weakPoints: [
      'Head 70 HP, chest 175: he has the smallest health pool in the squad.',
      'Up close his advantage is gone — pull the fight to medium or close range.',
      'Guides say his armor is a concealed THOR vest — the head is the safest target.',
    ],
    tactics: [
      'After killing Knight and Big Pipe, do not run to loot — find Birdeye first.',
      'Break the sightlines of long angles and draw him to medium range.',
      'Do not re-peek the same angle — change position after every exchange.',
      'Check a Goons tracker to know in advance which map the squad is on.',
    ],
    dangers: [
      'A shot from afar while you loot Knight and Big Pipe.',
      'A long open sightline where he is stronger.',
    ],
    loot: 'THOR CRV vest, marksman rifles; a chance of a graphics card and a Labs keycard.',
  },
  'shadow-of-tagilla': {
    summary: 'Shadow of Tagilla is the boss of the Labyrinth (entered through a basement on Shoreline with a single-use keycard): a "shadow" Tagilla with a chained labrys. He is in the Labyrinth almost every time, and after his death Vengeful Killa appears.',
    behavior: [
      'Faster, quieter and more aggressive than the regular Tagilla; the main threat is close combat with the Chained Labrys axe.',
      'At range he fires a Saiga-12K or an AK-12.',
      'He takes no damage from explosions and never sets off tripwires — grenades and traps are useless against him.',
      'He can appear anywhere on the small map and corners you.',
      'The map itself is dangerous: tripwires, poison barbed wire and spike pits, placed differently every raid.',
      'In PvE since 1.2.0.0, PMC bots also show up in the Labyrinth.',
    ],
    weakPoints: [
      'Mask and plate carrier are class 6: the head (105 HP) only with M995, M61, M993, BS and the like.',
      'The plate covers only the chest — with weak or expanding rounds, hit the stomach (280 HP) and legs.',
      '1305 HP in total — one magazine is usually not enough, keep spares ready.',
    ],
    tactics: [
      'Keep your distance and a clear line of fire; fall back into rooms with a second exit.',
      'With good penetration focus the head and chest; with weak rounds, the stomach.',
      'If he gets close, do not trade blows with him: back off and restore the distance.',
      'Bring a multitool to disarm traps and an antidote for the poison.',
      'After he dies, get ready for a second fight: Vengeful Killa (about 960 HP) is very aggressive.',
    ],
    dangers: [
      'A dead end or a corner where he has trapped you with the axe.',
      'Counting on grenades: explosions do not hurt him.',
      'Vengeful Killa while you loot or heal after the Shadow.',
    ],
    loot: 'His axe and mask cannot be taken — the value is mostly the Labyrinth\'s own loot.',
  },
  'cultist-priest': {
    summary: 'The Cultist Priest with a group of cultists (usually 3–4, more in some sources). Night raids only: Customs, Woods, Shoreline, night Factory and Ground Zero 21+.',
    behavior: [
      'Cultists move almost silently and often lie in the grass or bushes, waiting for a target.',
      'They come right up to you, strike with poisoned knives and back off to come again.',
      'If you shoot first or kill the Priest, the whole group opens fire with their guns at once.',
      'They are hard to see in thermals — sources disagree whether they show up at all.',
      'If one cultist shows himself, the others are most likely already flanking you.',
    ],
    weakPoints: [
      'The Priest has about 850 HP; the cultists usually wear no heavy armor — shooting first matters most.',
      'After a knife strike a cultist backs off — that is your window to fire back.',
    ],
    tactics: [
      'Carry an antidote: the poison is cured by xTG-12 (and by Augmentin, according to guides), otherwise it keeps hurting after the fight.',
      'Play with headphones and check the bushes around you, especially after the first contact.',
      'Keep your distance and cover, do not let them close in; a team has it much easier.',
      'Do not start the fight with a stray shot unless you are ready for the whole group to open fire.',
      'At night bring NVGs, but do not rely on thermals alone.',
    ],
    dangers: [
      'A poisoned knife from a bush — the poison finishes you after the fight.',
      'A second or third cultist flanking you while you watch the first.',
    ],
    loot: 'The cultist knife (poisoned), keys (Factory emergency exit, dorm rooms, director\'s office, gas station), SAS and SSD drives, flash drives, diaries, meds and stims.',
  },
  'the-wedge': {
    summary: 'The Wedge is the Black Division commander on the "Borey" icebreaker. He keeps guards around him, and the bigger your group, the more guards there are.',
    behavior: [
      'His guards scale: about three against a solo player, four against a duo and six against a trio.',
      'He remembers where he last saw you and punishes re-peeking the same angle.',
      'He and his guards throw CS gas grenades — without a gas mask, leave the cloud at once.',
      'More Black Division groups hold the helipad by the extract.',
      'Guides say 1.2.0.0 slowed the reactions of the Wedge and his guards and changed how bots behave in smoke.',
    ],
    weakPoints: [
      'Class 5 plates and above — weak rounds do not penetrate; bring M995, M61, M993 and the like.',
      'About 880 HP — roughly twice a PMC\'s.',
      'With low penetration — head and legs; with armor-piercing rounds the chest beats long fire at the limbs.',
    ],
    tactics: [
      'Do not rush: hold angles and wait for the enemy to step into your line of fire.',
      'Frags and flashbangs make the Wedge and his guards change position and stop shooting — push at that moment.',
      'Change angle after every shot — do not re-peek the same spot.',
      'Bring a gas mask: the chained door may have a tripwire with a gas grenade.',
      'Mind the scaling: the bigger the group, the more guards.',
    ],
    dangers: [
      'Re-peeking the same angle.',
      'CS gas without a gas mask.',
      'The Black Division squad at the helipad by the extract.',
    ],
    loot: 'Spiritus Systems LV-119 plate carrier (MultiCam Black) — needed for the task "A Wedge Between Us".',
  },
}
