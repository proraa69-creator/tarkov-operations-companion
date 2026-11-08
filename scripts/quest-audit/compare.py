# The quests as the game's data has them (tarkov.dev, read from the game, PvP and PvE) against each other and against tarkov.help
# (kept by hand for PvP, patch by patch): what does not match. Writes report.md (Russian, for the owner).
import json, os, re, sys
from collections import defaultdict

P = '../prestige/'
def load(mode):
    d = json.load(open(P + f'tasks-{mode}.json', encoding='utf-8'))['data']
    ru = json.load(open(P + f'tasks-{mode}-ru.json', encoding='utf-8'))['data']
    tasks = d['tasks']; tasks = tasks if isinstance(tasks, dict) else {t['id']: t for t in tasks}
    return tasks, ru
pvp, ru_pvp = load('regular')
pve, ru_pve = load('pve')
items = json.load(open('items-regular-ru.json', encoding='utf-8'))['data']
iname = lambda i: items.get(f'{i} Name', i)
TR = {'54cb50c76803fa8b248b4571': 'Прапор', '54cb57776803fa99248b456e': 'Терапевт', '579dc571d53a0658a154fbec': 'Скупщик', '58330581ace78e27b8b10cee': 'Лыжник',
      '5935c25fb3acc3127c3d8cd9': 'Миротворец', '5a7c2eca46aef81a7ca2145d': 'Механик', '5ac3b934156ae10c4430e83c': 'Барахольщик', '5c0647fdd443bc2504c2d371': 'Егерь',
      '638f541a29ffd1183d187f57': 'Смотритель', '656f0f98d80a697f855d34b1': 'Водитель БТР', '6617beeaa9cfa777ca915b7c': 'Реф'}
tname = lambda t: TR.get(t['trader'], '?')
qname = lambda t, ru: ru.get(t['name'], t['name'])

def objectives(t, ru):
    out = []
    for o in t.get('objectives', []):
        its = sorted(set(o.get('items') or ([o['item']] if isinstance(o.get('item'), str) else [])))
        out.append({'id': o['id'], 'type': o['type'], 'count': o.get('count'), 'fir': bool(o.get('foundInRaid')), 'items': its, 'optional': bool(o.get('optional')),
                    'text': ru.get(o.get('description', ''), o.get('description', ''))})
    return out

def rewards(t):
    fr = t.get('finishRewards') or {}
    its = sorted((r['item'], r['count']) for r in fr.get('items', []))
    st = sorted((s['trader'], round(s['standing'], 3)) for s in fr.get('traderStanding', []))
    return t.get('experience'), its, st

def fmt_items(its): return ', '.join(f'{iname(i)} ×{c}' for i, c in its) or '—'
def fmt_st(st): return ', '.join(f'{TR.get(t, t)} {"+" if v >= 0 else ""}{v}' for t, v in st) or '—'

rows = defaultdict(list)  # section -> lines

# A. PvP and PvE: the same quest, different conditions or rewards
for tid, a in sorted(pvp.items(), key=lambda kv: (tname(kv[1]), qname(kv[1], ru_pvp))):
    b = pve.get(tid)
    if not b: continue
    name = f'{tname(a)} — «{qname(a, ru_pvp)}»'
    diffs = []
    if (a.get('minPlayerLevel') or 0) != (b.get('minPlayerLevel') or 0):
        diffs.append(f'уровень: PvP {a.get("minPlayerLevel") or 1}, PvE {b.get("minPlayerLevel") or 1}')
    oa, ob = objectives(a, ru_pvp), objectives(b, ru_pve)
    ia, ib = {o['id']: o for o in oa}, {o['id']: o for o in ob}
    for oid in ia.keys() - ib.keys(): diffs.append(f'цель только в PvP: «{ia[oid]["text"]}»')
    for oid in ib.keys() - ia.keys(): diffs.append(f'цель только в PvE: «{ib[oid]["text"]}»')
    for oid in ia.keys() & ib.keys():
        x, y = ia[oid], ib[oid]
        if x['count'] != y['count']: diffs.append(f'«{x["text"]}»: количество PvP {x["count"]}, PvE {y["count"]}')
        if x['fir'] != y['fir']: diffs.append(f'«{x["text"]}»: «найдено в рейде» PvP {"да" if x["fir"] else "нет"}, PvE {"да" if y["fir"] else "нет"}')
        if x['items'] != y['items'] and x['items'] and y['items']: diffs.append(f'«{x["text"]}»: другие предметы в PvE')
    ea, ita, sta = rewards(a); eb, itb, stb = rewards(b)
    if ea != eb: diffs.append(f'опыт: PvP {ea}, PvE {eb}')
    if ita != itb: diffs.append(f'награда предметами: PvP {fmt_items(ita)}; PvE {fmt_items(itb)}')
    if sta != stb: diffs.append(f'репутация: PvP {fmt_st(sta)}; PvE {fmt_st(stb)}')
    if diffs: rows['A'].append((name, diffs))

# B. only in one mode
for tid, a in pvp.items():
    if tid not in pve: rows['B-pvp'].append(f'{tname(a)} — «{qname(a, ru_pvp)}»')
for tid, b in pve.items():
    if tid not in pvp: rows['B-pve'].append(f'{tname(b)} — «{qname(b, ru_pve)}»')

# C. PvP against tarkov.help: the items to hand over (count, found in raid), the hand-over items it names that the game has not
help_pages = []
for f in os.listdir('help'):
    try: help_pages.append(json.load(open(os.path.join('help', f), encoding='utf-8'))['data'])
    except Exception: pass
def norm(s): return re.sub(r'[^0-9a-zа-яё]+', ' ', (s or '').lower().replace('ё', 'е')).strip()
by_name = defaultdict(list)
for t in pvp.values(): by_name[(t['trader'], norm(qname(t, ru_pvp)))].append(t)
matched = 0; unmatched_help = []
for h in help_pages:
    if any(m.get('code') != 'regular' for m in h.get('game_modes') or []) and not any(m.get('code') == 'regular' for m in h.get('game_modes') or []): continue
    key = (h.get('trader_id'), norm(h.get('name')))
    cands = by_name.get(key, [])
    if len(cands) != 1:
        if not cands: unmatched_help.append(h)
        continue
    t = cands[0]; matched += 1
    name = f'{tname(t)} — «{qname(t, ru_pvp)}»'
    gives = defaultdict(lambda: [0, False])
    for o in objectives(t, ru_pvp):
        if o['type'] in ('giveItem', 'giveQuestItem') and o['items'] and len(o['items']) == 1:
            g = gives[o['items'][0]]; g[0] += o['count'] or 0; g[1] = g[1] or o['fir']
    diffs = []
    builds = any(o['type'] == 'buildWeapon' for o in objectives(t, ru_pvp))
    for ig in ([] if builds else h.get('item_goals') or []):
        item = (ig.get('item') or {}).get('slug')
        if item and f'{item} Name' not in items and (ig.get('item') or {}).get('name'): items[f'{item} Name'] = ig['item']['name']
        if not item or len(item) != 24: continue
        want, fir = ig.get('count') or 0, bool(ig.get('found_in_raid'))
        if item not in gives:
            # the game's quest may take any of a list here (one objective, several items): not a mismatch
            if any(item in o['items'] for o in objectives(t, ru_pvp)): continue
            # tarkov.help names the same item under another id (the game's vodka is 5d40407c…, theirs 614451b7…)
            if any(norm(iname(i)) == norm(iname(item)) for o in objectives(t, ru_pvp) for i in o['items']): continue
            diffs.append(f'tarkov.help: сдать «{iname(item)}» ×{want}{" (найдено в рейде)" if fir else ""} — в игре такой цели нет')
            continue
        have, hfir = gives[item]
        if have and want and have != want: diffs.append(f'«{iname(item)}»: в игре сдать {have}, на tarkov.help {want}')
        if hfir != fir: diffs.append(f'«{iname(item)}»: «найдено в рейде» в игре {"да" if hfir else "нет"}, на tarkov.help {"да" if fir else "нет"}')
    goals = [g for g in h.get('goal') or [] if g.get('name')]
    real = [o for o in objectives(t, ru_pvp) if not o['optional']]
    if False:
        diffs.append(f'целей: в игре {len(real)}, на tarkov.help {len(goals)}')
    if diffs: rows['C'].append((name, diffs))

# D. a quest the game data has under one id that tarkov.help keeps as several, or the other way: only the count
out = []
out.append('# Сверка квестов: данные игры и наша база')
out.append('')
out.append(f'08.11.2026. Квесты, условия и награды игра держит на своём сервере: на диске у игры их нет (только иконки). Поэтому сверены данные, которые выгружаются из самой игры (tarkov.dev, PvP {len(pvp)} квестов, PvE {len(pve)}), между режимами и с tarkov.help, который ведут вручную по каждому патчу (сопоставлено {matched} квестов PvP). Приложение показывает квесты по данным игры; где они расходятся с tarkov.help, вероятно, устарели данные игры у tarkov.dev или сам tarkov.help — такие места надо проверять в игре.')
out.append('')
out.append(f'## 1. Один квест — разные условия или награды в PvP и PvE ({len(rows["A"])})')
out.append('')
out.append('Это может быть настоящее различие режимов (в PvE часто другой уровень и награды) или устаревшие данные одного из режимов, как было с «Ревизией. Маяк».')
out.append('')
for name, diffs in rows['A']:
    out.append(f'- **{name}**')
    for d in diffs: out.append(f'  - {d}')
out.append('')
out.append(f'## 2. Квест есть только в одном режиме')
out.append('')
out.append(f'Только PvP ({len(rows["B-pvp"])}): ' + '; '.join(sorted(rows['B-pvp'])))
out.append('')
out.append(f'Только PvE ({len(rows["B-pve"])}): ' + '; '.join(sorted(rows['B-pve'])))
out.append('')
out.append(f'## 3. PvP: данные игры не сходятся с tarkov.help ({len(rows["C"])})')
out.append('')
for name, diffs in sorted(rows['C']):
    out.append(f'- **{name}**')
    for d in diffs: out.append(f'  - {d}')
out.append('')
open('report.md', 'w', encoding='utf-8').write('\n'.join(out))
print('A', len(rows['A']), 'B', len(rows['B-pvp']), len(rows['B-pve']), 'C', len(rows['C']), 'matched', matched, 'help without a game quest', len(unmatched_help))
