# Capture tools/test/fixture-bn4-installloop-1518.json (the BN4.3 install loop,
# 2026-10-03). Inputs: .telemetry (bladeburner.txt, history.jsonl, exitjump.txt,
# lifetimes.txt) and /tmp/player.json (the save's PlayerSave.data, decoded from
# the RFA getSaveFile at 15:25Z — after the 15:18Z 3-NFG install).
import json, os
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
T = os.environ.get('TEL', '/home/tbusby/Repos/bitburner-scripts/.telemetry/')
tel = json.load(open(T + 'bladeburner.txt'))
keep = ['bitNode', 'joined', 'joinedAt', 'rank', 'skillPoints', 'levels', 'stamina', 'maxStamina', 'city', 'blackOps', 'counts', 'maxLevels', 'cities', 'staminaBonus', 'successes', 'daemon', 'skillsAt']
tel = {k: tel[k] for k in keep if k in tel}
L = [json.loads(l) for l in open(T + 'history.jsonl').readlines()[-80:]]
h = [r for r in L if r['at'].startswith('2026-10-03T15:15')][0]
P = json.load(open('/tmp/player.json'))
mk = [k for k in P['mults'] if any(x in k for x in ['strength', 'defense', 'dexterity', 'agility', 'charisma', 'bladeburner'])]
fx = {
    'why': "BN4.3 2026-10-03 install loop: the 15:18Z pre-install state (history.jsonl 15:15:51Z person, the save's multipliers read 15:25Z after the 3-NFG install, bladeburner.txt 15:21Z division), the plan/gate numbers of the 14:38Z and 15:18Z installs, and the realised exit jumps",
    'tel': tel,
    'person1515': {'skills': h['skills'], 'exp': h['exp']},
    'mults': {k: P['mults'][k] for k in mk},
    'gymExpPerSec': 17.637649706829134,
    'sleeves': {'infiltrate': 0, 'support': 5, 'fa': 0},
    'rankScale': 1.1838,
    'successScale': 1.2061,
    'nfg3': {k: 1.030309 for k in ['strength', 'defense', 'dexterity', 'agility', 'charisma', 'strength_exp', 'defense_exp', 'dexterity_exp', 'agility_exp', 'charisma_exp']},
    'live': {
        '1438': {'nowH': 3.44, 'neverH': 3.1, 'lifeH': 11.5, 'planKey': 'now', 'planWhy': 'held (no event since 2026-10-03T14:28:20.811Z); at that decision: stays on committed: no alternative', 'jumpDiffH': 1.041},
        '1518': {'nowH': 3.469388832692308, 'neverH': 3.7444736790566613, 'lifeH': 0.66, 'planKey': 'now', 'jumpDiffH': 0.894},
    },
    'exitJump1518': json.load(open(T + 'exitjump.txt')),
    'lifetimes': [r for r in json.load(open(T + 'lifetimes.txt')) if r.get('bitNode') == 4],
    'lifeStartMs': 1791040716099,
}
json.dump(fx, open(os.path.join(REPO, 'tools/test/fixture-bn4-installloop-1518.json'), 'w'), indent=1)
print('wrote', len(json.dumps(fx)))
