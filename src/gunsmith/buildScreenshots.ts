/**
 * The owner's own «Сборки оружия» screenshots of the finished Gunsmith builds (owner, 11.10.2026: «на квесты оружейника
 * замени их на мои»), shipped with the app: shown instead of tarkov.help's. Each one is checked against its task before it
 * goes in (the parts the task asks for are on it, its stats meet the targets); a task without one keeps tarkov.help's.
 */
const files = import.meta.glob<string>('../assets/gunsmith-builds/*.webp', { eager: true, import: 'default' })

export const screenshotFiles = new Map(Object.entries(files).map(([path, url]) => [path.replace(/^.*\/|\.webp$/g, ''), url]))

/** tarkov.dev task id, the objective's weapon (a part can ask for several; the M4A1 is in two parts), the file's name. */
export const BUILD_SCREENSHOTS: ReadonlyArray<readonly [task: string, weapon: string, file: string]> = [
  ['5ac23c6186f7741247042bad', '54491c4f4bdc2db1078b4568', 'gunsmith-mp-133'], // Оружейник. МР-133
  ['5ac2426c86f774138762edfe', '57dc2fa62459775949412633', 'gunsmith-aks-74u'], // Оружейник. АКС-74У
  ['5ac2428686f77412450b42bf', '5926bb2186f7744b1c6c6e60', 'gunsmith-hk-mp5'], // Оружейник. HK MP5
  ['5ae3267986f7742a413592fe', '5a7828548dc32e5a9c28b516', 'gunsmith-model-870'], // Оружейник. Remington M870
  ['5ae3277186f7745973054106', '5ab8e9fcd8ce870019439434', 'gunsmith-aks-74n'], // Оружейник. АКС-74Н
  ['5ae327c886f7745c7b3f2f3f', '5ac66d9b5acfc4001633997a', 'gunsmith-ak-105'], // Оружейник. АК-105
  ['5b47799d86f7746c5d6a5fd8', '58948c8e86f77409493f7266', 'gunsmith-mpx'], // Оружейник. SIG MPX
  ['639872f9decada40426d3447', '587e02ff24597743df3deaeb', 'gunsmith-op-sks'], // Оружейник. ОП-СКС
  ['639872fa9b4fb827b200d8e5', '56d59856d2720bd8418b456a', 'gunsmith-p226r'], // Оружейник. P226R
  ['639872fc93ae507d5858c3a6', '5fc3f2d5900b1d5091531e57', 'gunsmith-vector-9x19'], // Оружейник. Vector 9x19
  ['5ac244eb86f7741356335af1', '5447a9cd4bdc2dbd208b4567', 'gunsmith-m4a1'], // Оружейник. М4A1
  ['5ae3270f86f77445ba41d4dd', '59d6088586f774275f37482f', 'gunsmith-akm'], // Оружейник. АКМ
  ['5ae3280386f7742a41359364', '57c44b372459772d2b39b8ce', 'gunsmith-as-val'], // Оружейник. АС «Вал»
  ['639872fe8871e1272b10ccf6', '5bb2475ed4351e00853264e3', 'gunsmith-master-part-1'], // Оружейник - Мастер. Часть 1 (HK 416A5)
  ['5ac244c486f77413e12cf945', '5a367e5dc4a282000e49738f', 'gunsmith-master-part-2'], // Часть 2 (RSASS)
  ['5ac242ab86f77412464f68b4', '588892092459774ac91d4b11', 'gunsmith-master-part-3'], // Часть 3 (ДВЛ-10)
  ['5b47749f86f7746c5d6a5fd4', '5ac66d015acfc400180ae6e4', 'gunsmith-master-part-4'], // Часть 4 (АК-102)
  ['5b477b6f86f7747290681823', '5a0ec13bfcdbcb00165aa685', 'gunsmith-master-part-5'], // Часть 5 (АКМН)
  ['639873003693c63d86328f25', '5c46fbd72e2216398b5a8c9c', 'gunsmith-master-part-6'], // Часть 6 (СВДС)
  ['5b477f7686f7744d1b23c4d2', '5aafa857e5b5b00018480968', 'gunsmith-master-part-7'], // Часть 7 (M1A)
  ['63987301e11ec11ff5504036', '5bfea6e90db834001b7347f3', 'gunsmith-master-part-8-m700'], // Часть 8, оружие 1 из 2 (M700)
  ['5b47825886f77468074618d3', '5447a9cd4bdc2dbd208b4567', 'gunsmith-master-part-9'], // Часть 9 (M4A1)
  ['64f83bb69878a0569d6ecfbe', '606587252535c57a13424cfd', 'gunsmith-master-part-10'], // Часть 10 (Mk47)
  ['64f83bcdde58fc437700d8fa', '5df8ce05b11454561e39243b', 'gunsmith-master-part-11'], // Часть 11 (SR-25)
  ['676529af9c90953d090882e7', '5df24cf80dee1b22f862e9bc', 'gunsmith-master-part-12-t-5000m'], // Часть 12, оружие 1 из 3 (T-5000M)
  ['666314b0acf8442f8b0531a1', '5580223e4bdc2d1c128b457f', 'hell-on-earth-part-1'], // Ад на земле. Часть 1 (MP-43-1C)
]

const byBuild = new Map(BUILD_SCREENSHOTS.map(([task, weapon, file]) => [`${task}:${weapon}`, file]))

/** The owner's screenshot of this task's build of this weapon, when there is one. */
export function buildScreenshot(taskId: string | undefined, weaponId: string): string | undefined {
  const file = taskId ? byBuild.get(`${taskId}:${weaponId}`) : undefined
  return file ? screenshotFiles.get(file) : undefined
}
