# Packs RaidOsHelmets renders into the app's pictures: the helmet as the game's inventory icon draws it (its pose, light and shadow), on
# the inventory cell's background the other tier-list pictures have (a 1px #495154 frame, a fine dark checker), twice their 64 px.
# usage: pack_icons.py <plugin out dir> <app assets dir> <sheet.png> [source kind: icon|capture|bw] [current icons dir]
import os, sys
from PIL import Image

NAMES = {
    'maska-killa': '5c0e874186f7745dc7616606',
    'maska': '5c091a4e0db834001d5addc8',
    'rys-t': '5f60c74e3b85f6263c145586',
    'altyn': '5aa7e276e5b5b000171d0647',
    'vulkan-5': '5ca20ee186f774799474abc2',
    'lshz-2dtm': '5d6d3716a4b9361bc8618872',
}
# the tier list's current picture of each (the preset with its visor, else the helmet alone)
CURRENT = {
    'maska-killa': '657bc821aab96fccee08becc', 'maska': '5c091a4e0db834001d5addc8', 'rys-t': '5f60c74e3b85f6263c145586',
    'altyn': '707265736574000000000004', 'vulkan-5': '5ca20ee186f774799474abc2', 'lshz-2dtm': '5d6d3716a4b9361bc8618872',
}
SIZE = 128   # twice the game's 64 px icon
FRAME = 2    # its 1 px frame, twice
MARGIN = 2   # the item's room inside the frame


def background():
    """The inventory cell: a #495154 frame, inside a checker of 1 px (here 2) going from #313131/#393939 at the top to #2e2e2e/#343434."""
    image = Image.new('RGBA', (SIZE, SIZE), (0x49, 0x51, 0x54, 255))
    pixels = image.load()
    inner = SIZE - 2 * FRAME
    for y in range(FRAME, SIZE - FRAME):
        t = (y - FRAME) / max(1, inner - 1)
        dark = round(0x31 + (0x2e - 0x31) * t)
        light = round(0x39 + (0x34 - 0x39) * t)
        for x in range(FRAME, SIZE - FRAME):
            value = light if ((x // 2) + (y // 2)) % 2 else dark
            pixels[x, y] = (value, value, value, 255)
    return image


def fit(render):
    """The item alone (its alpha's box), as large as the cell takes it, in the middle."""
    box = render.getchannel('A').point(lambda a: 255 if a > 6 else 0).getbbox()
    if not box:
        raise SystemExit('empty render')
    item = render.crop(box)
    room = SIZE - 2 * (FRAME + MARGIN)
    scale = min(room / item.width, room / item.height)
    item = item.resize((max(1, round(item.width * scale)), max(1, round(item.height * scale))), Image.LANCZOS)
    cell = background()
    cell.alpha_composite(item, ((SIZE - item.width) // 2, (SIZE - item.height) // 2))
    return cell


def main():
    out, assets, sheet_path = sys.argv[1], sys.argv[2], sys.argv[3]
    kind = sys.argv[4] if len(sys.argv) > 4 else 'icon'
    current_dir = sys.argv[5] if len(sys.argv) > 5 else None
    os.makedirs(assets, exist_ok=True)
    rows = []
    for name, helmet in NAMES.items():
        row = []
        if current_dir:
            path = os.path.join(current_dir, CURRENT[name] + '-icon.webp')
            row.append(Image.open(path).convert('RGBA').resize((SIZE, SIZE), Image.LANCZOS) if os.path.exists(path) else background())
        for state in ('down', 'up'):
            render = Image.open(os.path.join(out, f'{name}.{state}.{kind}.png')).convert('RGBA')
            cell = fit(render)
            cell.save(os.path.join(assets, f'{helmet}.{state}.webp'), 'WEBP', quality=92, method=6)
            row.append(cell)
        rows.append(row)
        print(name, helmet, 'ok')
    columns = max(len(row) for row in rows)
    sheet = Image.new('RGBA', (columns * (SIZE * 2 + 8), len(rows) * (SIZE * 2 + 8)), (24, 24, 24, 255))
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            sheet.alpha_composite(cell.resize((SIZE * 2, SIZE * 2), Image.NEAREST), (c * (SIZE * 2 + 8), r * (SIZE * 2 + 8)))
    sheet.save(sheet_path)
    print('sheet', sheet_path)


main()
