"""Where each of our own quest photos was shot: writes src/data/questPhotoPlaces.json, { photoId: [x, z] } in game space.

Report 220 (owner, 24.11.2026: «проверь все фото на всех картах… где-то какие-то могут не совпадать»): an objective with several
points on the map (four fuel tankers, five weather stations…) showed every point's photos at each of them. A point now shows the
photos shot at it (src/components/QuestGuidePhotos.tsx photosOfPoint), so each photo needs the place it shows.

The photos are made by E:/SPT-photo/eval/integrate_all.py, which rewrites questGuidePhotos.json and keeps no place; its runs log
which frame each photo id was made of (E:/SPT-photo/server-upload/<map>/report.txt), and the approved frames know their point
(E:/SPT-photo/approved/<map>/<run>/approved.json, the points in E:/SPT-photo/points/*.json). Run after a new batch:

    python -I scripts/quest-photo-places.py
"""
import glob, json, os, re
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UP, APPR, PTS = 'E:/SPT-photo/server-upload', 'E:/SPT-photo/approved', 'E:/SPT-photo/points'

guide = json.load(open(os.path.join(REPO, 'src/data/questGuidePhotos.json'), encoding='utf-8'))

source = {}  # photo id → the run's map, folder and frame file; newer runs last, so they win
for report in sorted(glob.glob(f'{UP}/*/report.txt'), key=lambda path: ('-old' not in path, path)):
    folder = os.path.basename(os.path.dirname(report))
    map_id = folder.replace('-old', '').replace('-docs6', '').replace('-fix', '')
    for line in open(report, encoding='utf-8'):
        line = line.rstrip('\n')
        found = re.match(r'^matched: \w+ -> (\w+) .*\(([^()]+)\)$', line) or re.match(r'^(?:own|approach|item|document up close): \+ (\w+) .*\(([^()]+)\)$', line)
        if found:
            source[found.group(1)] = {'map': map_id, 'folder': folder, 'file': found.group(2)}

approved = defaultdict(list)  # frame file → its approved entries
for path in glob.glob(f'{APPR}/*/*/approved.json'):
    parts = path.replace('\\', '/').split('/')
    for entry in json.load(open(path, encoding='utf-8')):
        entry['_map'], entry['_run'] = parts[-3], parts[-2]
        approved[entry['file']].append(entry)

points = {}
for path in glob.glob(f'{PTS}/*.json'):
    try:
        data = json.load(open(path, encoding='utf-8'))
    except (ValueError, OSError):
        continue
    if isinstance(data, dict) and isinstance(data.get('points'), list):
        for point in data['points']:
            if isinstance(point, dict) and 'id' in point:
                points.setdefault(point['id'], point)


def place(photo_id, file_name):
    """The point a photo shows: the approved frame's point (its run first), else the frame's own place."""
    run = source.get(photo_id)
    if not run and file_name not in (None, 'own.jpg') and approved.get(file_name):
        run = {'map': approved[file_name][0]['_map'], 'folder': 'old-quests', 'file': file_name}
    if not run:
        return None
    entries = [e for e in approved.get(run['file'], []) if e['_map'] == run['map']] or approved.get(run['file'], [])
    want = 'docs6' if 'docs6' in run['folder'] else ('quests' if run['folder'] == 'old-quests' else None)
    pick = next((e for e in entries if want and e['_run'] == want), None) or next((e for e in entries if e['_run'] == 'all'), None) or (entries[0] if entries else None)
    if not pick:
        return None
    point = points.get(pick.get('point'), {})
    at = pick.get('at') or [point.get('x'), point.get('y'), point.get('z')]
    if at[0] is None or at[-1] is None:
        return None
    return [round(at[0], 2), round(at[-1], 2)]


places = {}
for photo_id, entry in sorted(guide['files'].items()):
    if entry.get('own'):
        at = place(photo_id, entry.get('file'))
        if at:
            places[photo_id] = at
missing = sum(1 for entry in guide['files'].values() if entry.get('own')) - len(places)
with open(os.path.join(REPO, 'src/data/questPhotoPlaces.json'), 'w', encoding='utf-8', newline='\n') as out:
    out.write('{\n' + ',\n'.join(f'"{key}": [{x}, {z}]' for key, (x, z) in places.items()) + '\n}\n')
print(f'{len(places)} own photos placed, {missing} without a known place')
