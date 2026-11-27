/**
 * SHA-256 of every OCR model the app ships (electron/tessdata: Tesseract's tessdata_fast, the same files the release
 * publishes on the site under /app-delta/resources/tessdata/). A model the app puts into its own folder — copied from the
 * shipped folder or downloaded from the site or the Tesseract project — is used only with exactly these bytes (security
 * review, 27.11.2026: electron/ocrEngine.ts). ocrModels.test.ts checks them against the shipped files and that every
 * language of the app (src/import/gameLanguage.ts OCR_MODEL_FILES) has one: a model added or replaced there needs its line
 * here.
 */
export const OCR_MODEL_SHA256: Readonly<Record<string, string>> = {
  chi_sim: 'a5fcb6f0db1e1d6d8522f39db4e848f05984669172e584e8d76b6b3141e1f730',
  deu: '19d219bbb6672c869d20a9636c6816a81eb9a71796cb93ebe0cb1530e2cdb22d',
  eng: '7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2',
  fra: 'ced037562e8c80c13122dece28dd477d399af80911a28791a66a63ac1e3445ca',
  jpn: '1f5de9236d2e85f5fdf4b3c500f2d4926f8d9449f28f5394472d9e8d83b91b4d',
  kor: '6b85e11d9bbf07863b97b3523b1b112844c43e713df8b66418a081fd1060b3b2',
  pol: 'c4476cdbc0e33d898d32345122b7be1cbf85ace15f920f06c7714756e1ef79b2',
  por: 'c4932b937207a9514b7514d518b931a99938c02a28a5a5a553f8599ed58b7deb',
  rus: 'e16e5e036cce1d9ec2b00063cf8b54472625b9e14d893a169e2b0dedeb4df225',
  spa: '6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464',
  tur: '7393381111e1152420fc4092cb44eef4237580d21b92bf30d7d221aad192c6b7',
}
