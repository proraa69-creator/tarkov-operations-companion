# Builds the demo profile (localStorage values) from the live catalog: real quest ids, prerequisites completed.
import json, datetime, sys
LANG=sys.argv[1] if len(sys.argv)>1 else 'ru'
STORY_EN={'story-tour-14':'Survive and extract from Woods or visit Woods 3 times','story-tour-15':'Find the entrance to the port Terminal','story-tour-16':'Find a way to contact the military at the Terminal',
  'story-tour-3':'Talk to Ref','story-tour-4':'Survive and extract from Interchange or visit Interchange 3 times','story-tour-5':'Tell Ref about the results of the recon',
  'story-falling-skies-2':'Locate the plane crash site','story-falling-skies-3':'Find the armored case','story-falling-skies-4':'Hand over the armored case'}
import os
D=os.path.join(os.environ['PROMO_WORK'],'promo/rec') if 'PROMO_WORK' in os.environ else os.path.dirname(os.path.abspath(__file__))
cat=json.load(open(f'{D}/catalog-pvp.json'))
Q={q['id']:q for q in cat['quests']}
storage=json.load(open(f'{D}/default-storage.json'))
state=json.loads(storage['tarkov-operations-profiles-v2'])
profile=state['profiles'][0]
now=datetime.datetime.utcnow()
iso=lambda m=0: (now-datetime.timedelta(minutes=m)).strftime('%Y-%m-%dT%H:%M:%S.000Z')

def closure(ids):
    seen=set(); stack=list(ids)
    while stack:
        i=stack.pop()
        for p in (Q.get(i,{}).get('previous') or []):
            if p not in seen: seen.add(p); stack.append(p)
    return seen

import sys
sys.setrecursionlimit(10000)
DEPTH={}
def depth(i, visiting=frozenset()):
    if i in DEPTH: return DEPTH[i]
    if i in visiting: return 0
    prev=[p for p in (Q.get(i,{}).get('previous') or []) if p in Q]
    value=0 if not prev else 1+max(depth(p, visiting|{i}) for p in prev)
    DEPTH[i]=value
    return value
GUNSMITH={q['id'] for q in cat['quests'] if 'Оружейник' in q['name']}
PLAN={
 'pvp': dict(level=27, faction='usec', active=[
    '597a160786f77477531d39d2','597a171586f77405ba6887d3','5b4795fb86f7745876267770','675c085d59b0575973005f52','5979eee086f774311955e614','59c124d686f774189b3c843f',
    '665eec4a4dfc83b0ed0a9dca','666314c3acf8442f8b0531a3','5a27b75b86f7742e97191958','5ac346cf86f7741d63233a02','639136fa9444fb141f4e6eee','65734c186dc1e402c80dc19e',
    '671a49f77d49aea42c029b5f','6179ac7511973d018217d0b9','5ac2426c86f774138762edfe'],
    extra_done=['5ac23c6186f7741247042bad'], story={'story-tour': 15}, tracked=['597a160786f77477531d39d2','5b4795fb86f7745876267770','675c085d59b0575973005f52'],
    fav=['5c0530ee86f774697952d952','57347ca924597744596b4e71','544fb45d4bdc2dee738b4568']),
 'pve': dict(level=41, faction='bear', active=['6086c852c945025d41566124','6179b4d1bca27a099552e04e','6089732b59b92115597ad789','64ee99639878a0569d6ec8c9','5a27bc1586f7741f6d40fa2f','626bd75e47ea7f506e5493c5','5ae3277186f7745973054106'],
    extra_done=['5ac23c6186f7741247042bad','5ac2426c86f774138762edfe','5ac2428686f77412450b42bf'], story={'story-falling-skies': 3}, tracked=[], fav=['5c0530ee86f774697952d952']),
 'seasonal': dict(level=12, faction='usec', active=['5936da9e86f7742d65037edf','59674eb386f774539f14813a','59689fbd86f7740d137ebfc4','5ac23c6186f7741247042bad'],
    extra_done=['5936d90786f7742b1420ba5b','59674cd986f7744ab26e32f2'], story={'story-tour': 4}, tracked=[], fav=['57347ca924597744596b4e71']),
}
for mode, plan in PLAN.items():
    m=profile['modes'][mode]
    m['playerLevel']=plan['level']; m['faction']=plan['faction']
    active=[i for i in plan['active'] if i in Q]
    done=(closure(active)|set(plan['extra_done'])|closure(plan['extra_done']))-set(active)
    # A believable count for the level: early quests of the main traders whose chains do not run through an active one.
    target={'pvp':86,'pve':142,'seasonal':23}[mode]
    MAIN=['Прапор','Терапевт','Лыжник','Миротворец','Механик','Егерь','Барахольщик']
    pool=sorted((q for q in cat['quests'] if q.get('kind')!='story' and q.get('trader') in MAIN and q['id'] not in active and '[PVP ZONE]' not in q['name'] and q['id'] not in GUNSMITH),
        key=lambda q:(depth(q['id']), MAIN.index(q['trader']), q['name']))
    for q in pool:
        if len(done)>=target: break
        chain=closure([q['id']])
        if chain & set(active): continue
        done |= chain | {q['id']}
    done -= set(active)
    tp={}
    for i in sorted(done): tp[i]={'taskId':i,'status':'completed','source':'eft-log','updatedAt':iso(600)}
    for i in active: tp[i]={'taskId':i,'status':'active','source':'eft-log','updatedAt':iso(30)}
    for sid, stage in plan['story'].items():
        if sid not in Q: continue
        stages=Q[sid].get('stages') or []
        objectives=[]
        for k in (stage-1, stage):
            if 0<=k<len(stages):
                text=STORY_EN.get(stages[k]['id'], stages[k]['title']) if LANG=='en' else stages[k]['title']
                objectives.append({'id':stages[k]['id'],'text':text,'optional':False,'completed':k<stage,'stageIndex':k})
        tp[sid]={'taskId':sid,'status':'active','source':'eft-log','updatedAt':iso(20),'currentStageIndex':stage,'storyObjectives':objectives}
    m['taskProgress']=tp
    m['trackedTaskIds']=[i for i in plan['tracked'] if i in Q]
    m['favoriteItemIds']=plan['fav']
    m['lastLogSyncAt']=iso(1)
    print(mode, 'active', len(active), 'completed', len(done))
profile['displayName']='Оператор'
profile['selectedMode']='pvp'
state['profiles'][0]=profile
collector=Q.get('5c51aac186f77432ea65c552',{})
req=[r['itemId'] for r in (collector.get('raidRequirements') or []) if r.get('itemId')] or collector.get('requiredItems') or []
req=list(dict.fromkeys(req))
print('collector items', len(req))
ui=json.loads(storage['tarkov-operations-ui-v2']); ui['selectedMapId']='customs'
out={'tarkov-operations-profiles-v2': json.dumps(state, ensure_ascii=False), 'tarkov-operations-ui-v2': json.dumps(ui), 'collector': req}
json.dump(out, open(f'{D}/seed-{LANG}.json','w'), ensure_ascii=False)
print('wrote', f'seed-{LANG}.json')
