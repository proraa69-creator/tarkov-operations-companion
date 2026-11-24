# tarkov.help's quest pages (PvP), one by one, politely; kept here so the comparison can be re-run.
import json, os, sys, time, urllib.request
qm = json.load(open(sys.argv[1], encoding='utf-8'))
quests = []
def walk(x):
    if isinstance(x, dict):
        if x.get('seo_link') and x.get('trader_id') and 'name' in x: quests.append(x)
        for v in x.values(): walk(v)
    elif isinstance(x, list):
        for v in x: walk(v)
walk(qm)
seen = {}
for q in quests: seen[q['seo_link']] = q
print('quests', len(seen), flush=True)
done = 0
for seo in seen:
    out = os.path.join('help', seo + '.json')
    if os.path.exists(out): continue
    req = urllib.request.Request(f'https://tarkov.help/api/ru/quests/{seo}', headers={'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json'})
    try:
        data = urllib.request.urlopen(req, timeout=30).read()
        open(out, 'wb').write(data)
    except Exception as e:
        print('fail', seo, e, flush=True)
    done += 1
    time.sleep(0.25)
print('fetched', done)
