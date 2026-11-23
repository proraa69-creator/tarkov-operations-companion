# The jobs of RaidOsHelmets: each helmet of the owner's list (20.11.2026) with its built-in plates and the face shield that suits it,
# as a flat item list like the game's presets. Data: the offline copy's own templates (E:\SPT).
import json, sys, uuid

ITEMS = r'E:\SPT\SPT_Runtime\SPT_Data\database\templates\items.json'
HELMETS = [
    ('maska-killa', '5c0e874186f7745dc7616606', '5c0e842486f77443a74d2976'),   # Маска-1Щ (Killa Edition) + its black shield
    ('maska', '5c091a4e0db834001d5addc8', '5c0919b50db834001b7ce3b9'),          # Маска-1Щ (олива) + olive shield
    ('rys-t', '5f60c74e3b85f6263c145586', '5f60c85b58eff926626a60f7'),          # Рысь-Т + its shield
    ('altyn', '5aa7e276e5b5b000171d0647', '5aa7e373e5b5b000137b76f0'),          # Алтын + its shield
    ('vulkan-5', '5ca20ee186f774799474abc2', '5ca2113f86f7740b2547e1d2'),       # Вулкан-5 + its shield
    ('lshz-2dtm', '5d6d3716a4b9361bc8618872', '5d6d3829a4b9361bc8618943'),      # ЛШЗ-2ДТМ + its shield
]

def oid():
    return uuid.uuid4().hex[:24]

items = json.load(open(ITEMS, encoding='utf-8'))
jobs = []
for name, helmet, visor in HELMETS:
    root = oid()
    rows = [{'_id': root, '_tpl': helmet}]
    slots = items[helmet]['_props'].get('Slots', [])
    placed = False
    for slot in slots:
        allowed = [v for f in slot['_props']['filters'] for v in f.get('Filter', [])]
        if slot['_name'].startswith('Helmet_') and allowed:
            rows.append({'_id': oid(), '_tpl': allowed[0], 'parentId': root, 'slotId': slot['_name']})
        elif visor in allowed and not placed:
            rows.append({'_id': oid(), '_tpl': visor, 'parentId': root, 'slotId': slot['_name']})
            placed = True
    if not placed:
        sys.exit(f'{name}: no slot takes {visor}')
    jobs.append({'name': name, 'width': int(sys.argv[2]) if len(sys.argv) > 2 else 512, 'height': int(sys.argv[2]) if len(sys.argv) > 2 else 512, 'items': rows})
json.dump(jobs, open(sys.argv[1], 'w', encoding='utf-8'), indent=1)
print(len(jobs), 'jobs ->', sys.argv[1])
