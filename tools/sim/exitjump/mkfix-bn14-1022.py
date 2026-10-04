# Capture tools/test/fixture-bn14-install-1022.json (the second BN14.1
# install, 2026-10-04 10:22:41Z: actor 33.46h, the new life 80.18h at 10:27Z).
# Inputs (all read-only copies):
#   SNAP  a copy of .telemetry taken at 10:31Z (bladeburner.txt, plan.txt,
#         sleeve.txt, install-last.txt, exitjump.txt, exitinputs.txt, and the
#         tail of history.jsonl as history-tail.jsonl)
#   CAP   the BN14 recorder's captures (tools/sim/bbcal14/recorder.mjs):
#         save.20261004T095529.json (pre-install player + division) and
#         save.20261004T103145.json (post-install), plan.txt.20261004T095830
#   SAVE  a full save fetched at ~10:35Z (its GoSave: Tetrads nodePower)
#   AUGS  .telemetry/snap-augstats.txt (getAugmentationStats per name)
import json, os, math
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SNAP = os.environ.get('SNAP', '/tmp/bn14b/snap1031/')
CAP = os.environ.get('CAP', '/tmp/bbk14/cap/')
SAVE = os.environ.get('SAVE', '/tmp/bn14b/save.20261004T103525.json')
AUGS = os.environ.get('AUGS', '/home/tbusby/Repos/bitburner-scripts/.telemetry/snap-augstats.txt')
keep = ['at', 'bitNode', 'joined', 'joinedAt', 'rank', 'skillPoints', 'levels', 'stamina', 'maxStamina', 'city', 'blackOps', 'counts', 'maxLevels', 'cities', 'citiesAt', 'staminaBonus', 'successes', 'daemon', 'skillsAt', 'lastAugReset']
tel = json.load(open(SNAP + 'bladeburner.txt'))
tel = {k: tel[k] for k in keep if k in tel}
tel0958 = json.load(open(CAP + 'bladeburner.txt.20261004T095830'))
tel0958 = {k: tel0958[k] for k in keep if k in tel0958}
hist = {}
for l in open(SNAP + 'history-tail.jsonl', 'rb'):
    try:
        r = json.loads(l)
    except Exception:
        continue
    if '2026-10-04T10:19' <= r['at'] <= '2026-10-04T10:32':
        hist[r['at']] = r
def person(prefix):
    r = [v for k, v in sorted(hist.items()) if k.startswith(prefix)][0]
    return {'at': r['at'], 'skills': r['skills'], 'exp': r['exp'], 'money': r['money'], 'city': r['city']}
pre = json.load(open(CAP + 'save.20261004T095529.json'))
post = json.load(open(CAP + 'save.20261004T103145.json'))
top = json.load(open(SAVE))
P = json.loads(top['data']['PlayerSave'])['data']
go = json.loads(top['data']['GoSave'])
gostats = go.get('stats') or go.get('data', {}).get('stats')
il = [json.loads(l) for l in open(SNAP + 'install-last.txt') if l.strip()][-1]
S = json.load(open(AUGS))['data']['stats']
plan = json.load(open(SNAP + 'plan.txt'))
br = plan['decisions']['bladeRoute']
plan0958 = json.load(open(CAP + 'plan.txt.20261004T095830'))
ei = json.loads([l for l in open(SNAP + 'exitinputs.txt') if l.strip()][-1])
fx = {
    'why': "BN14.1 2026-10-04 10:22:41Z install (13 augs) on the Bladeburner route: the install actor priced the next life at 33.46h (never 40.1h); the new life priced itself at 80.18h at 10:27:44Z (EXIT JUMP AT INSTALL +46.8h). Pre-install person (history 10:19:55Z) and multipliers (save 09:55Z), post-install persons (history 10:25-10:31Z) and multipliers (save 10:31Z, 10:35Z), the Go stats (save 10:35Z), the division (bladeburner.txt 10:31Z; 09:58Z), the batch and its getAugmentationStats, the plan's calibrations and start.",
    'tel': tel,
    'tel0958': tel0958,
    'personPre': person('2026-10-04T10:19:55'),
    'personPost': [person(p) for p in ('2026-10-04T10:25:23', '2026-10-04T10:29:51', '2026-10-04T10:31:11')],
    'multsPre0955': pre['player']['mults'],
    'skillsPre0955': pre['player']['skills'],
    'expPre0955': pre['player']['exp'],
    'multsPost1031': post['player']['mults'],
    'multsPost1035': P['mults'],
    'skillsPost1035': P['skills'],
    'expPost1035': P['exp'],
    'goStats1035': gostats,
    'goTxt1033': {'bonuses': {'Tetrads': 26.455, 'The Black Hand': 35.77}, 'goPower': 4, 'sf14': 0, 'opponent': 'Tetrads'},
    'batch': il['batch'],
    'augStats': {n: S[n] for n in il['batch']},
    'installLast': il,
    'exitJump': json.load(open(SNAP + 'exitjump.txt')),
    'lifeStartPreMs': 1791077530463,
    'lifeStartPostMs': 1791109362591,
    'installAt': '2026-10-04T10:22:41.953Z',
    'cal': {'success': {k: br['calibration']['success'][k] for k in ('k', 'sdLn', 'n')}, 'rank': {'k': br['calibration']['rank']['k'], 'sdLn': br['calibration']['rank']['sdLn']}},
    'start1027': br['start'],
    'start0957': plan0958['decisions']['bladeRoute']['start'],
    'sleevesPost': br['sleeves'],
    'sleevesPre0957': plan0958['decisions']['bladeRoute']['sleeves'],
    'install0957': {k: v for k, v in plan0958['decisions']['install'].items() if k in ('key', 'spec', 'options', 'why')},
    'live1027': {'pointH': br['bladeH'], 'meanH': br['meanH'], 'members': br['bladeMembers'], 'at': br['pricedAt']},
    'flatPerSec': ei['inputs']['flatIncomePerSec'],
    'installCash': ei['inputs']['installCash'],
    'bladeInstallJumps': plan['bladeInstallJumps'],
}
json.dump(fx, open(os.path.join(REPO, 'tools/test/fixture-bn14-install-1022.json'), 'w'), indent=0)
print('wrote', len(json.dumps(fx)))
