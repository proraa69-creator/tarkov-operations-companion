#!/usr/bin/env python3
"""The phone apps as one release (.github/workflows/ios-ipa.yml «publish-mobile»):

    python3 scripts/mobile-release.py <android dir> <ios dir> <out dir>

<android dir> holds raid-os-<version>.apk and version.json (scripts/android-release.mjs), <ios dir> the unsigned IPA.
Writes to <out dir>:
  raid-os-<version>.apk                      the Android app as it is
  Raid-OS-iPhone-<version>.zip               folder «Raid OS для iPhone»: the IPA, the PDF guide, shortcuts that download
                                             iTunes and Sideloadly from their makers' sites, a short «Прочитай меня»
  mobile-release.json                        { version, android: {...}, iphone: {...} } for server/src/services/mobileDownloads.ts

iTunes and Sideloadly are not put into the archive themselves: Apple's licence does not allow passing iTunes on, and an
old Sideloadly stops working after iOS updates, so the shortcuts always fetch the current installers.
"""
import hashlib
import json
import pathlib
import shutil
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
GUIDE = ROOT / 'website' / 'public' / 'guides' / 'raid-os-iphone-install.pdf'
FOLDER = 'Raid OS для iPhone'
SHORTCUTS = {
    '1. Скачать iTunes (с сайта Apple).url': 'https://www.apple.com/itunes/download/win64',
    '2. Скачать Sideloadly.url': 'https://sideloadly.io/SideloadlySetup64.exe',
}
README = """Raid OS для iPhone — установка с компьютера Windows

1. Откройте «Инструкция по установке.pdf» — там всё по шагам с картинками.
2. Двойной щелчок по «1. Скачать iTunes (с сайта Apple)» — скачается iTunes, установите его.
   Нужна версия с сайта Apple, а не из Microsoft Store.
3. Двойной щелчок по «2. Скачать Sideloadly» — скачается Sideloadly, установите его.
4. Подключите iPhone кабелем, откройте Sideloadly, перетащите в него файл «Raid OS.ipa»,
   введите свой Apple ID и нажмите Start.
5. На iPhone: Настройки → Основные → VPN и управление устройством → доверять своему Apple ID.
   На iOS 16 и новее включите «Режим разработчика» (Настройки → Конфиденциальность и безопасность).

С бесплатным Apple ID приложение работает 7 дней, потом его нужно снова поставить через Sideloadly
(данные и вход сохраняются). Сайт: https://raidos.app
"""


def sha256(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def main(android_dir: str, ios_dir: str, out_dir: str) -> None:
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf-8'))['version']
    out = pathlib.Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    android = json.loads((pathlib.Path(android_dir) / 'version.json').read_text(encoding='utf-8'))
    apk_name = android['url'].rsplit('/', 1)[-1]
    apk = pathlib.Path(android_dir) / apk_name
    if apk.stat().st_size != android['size'] or sha256(apk) != android['sha256']:
        raise SystemExit(f'{apk_name}: size or SHA-256 differs from version.json')
    shutil.copyfile(apk, out / apk_name)

    ipas = sorted(pathlib.Path(ios_dir).glob('*.ipa'))
    if len(ipas) != 1:
        raise SystemExit(f'exactly one IPA expected in {ios_dir}, found {len(ipas)}')
    if not GUIDE.is_file():
        raise SystemExit(f'the guide is missing: {GUIDE}')
    zip_name = f"Raid-OS-iPhone-{android['versionName']}.zip"
    # Python marks non-ASCII names as UTF-8 in the archive, so Windows shows the Russian names correctly.
    with zipfile.ZipFile(out / zip_name, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        archive.write(ipas[0], f'{FOLDER}/Raid OS.ipa', compress_type=zipfile.ZIP_STORED)
        archive.write(GUIDE, f'{FOLDER}/Инструкция по установке.pdf')
        for name, url in SHORTCUTS.items():
            archive.writestr(f'{FOLDER}/{name}', f'[InternetShortcut]\r\nURL={url}\r\n')
        archive.writestr(f'{FOLDER}/Прочитай меня.txt', README.replace('\n', '\r\n').encode('utf-8-sig'))
    archive_path = out / zip_name

    release = {
        'version': version,
        'android': {'file': apk_name, 'size': android['size'], 'sha256': android['sha256'], 'versionCode': android['versionCode'], 'versionName': android['versionName']},
        'iphone': {'file': zip_name, 'size': archive_path.stat().st_size, 'sha256': sha256(archive_path)},
    }
    (out / 'mobile-release.json').write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(release, ensure_ascii=False))


if __name__ == '__main__':
    if len(sys.argv) != 4:
        raise SystemExit('usage: scripts/mobile-release.py <android dir> <ios dir> <out dir>')
    main(*sys.argv[1:])
