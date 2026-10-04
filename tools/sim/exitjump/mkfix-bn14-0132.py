# Capture tools/test/fixture-bn14-install-0132.json (the BN14.1 install,
# 2026-10-04 01:32:10Z). Inputs: .telemetry (bladeburner.txt, history.jsonl,
# exitjump.txt, install-last.txt, plan.txt, sleeve.txt, lifetimes.txt) and
# /tmp/bn14/player.json (the save's PlayerSave.data, decoded from the RFA
# getSaveFile at ~01:57Z, after the install: the multipliers carry the 3 NFG).
import json, os
REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
T = os.environ.get('TEL', '/home/tbusby/Repos/bitburner-scripts/.telemetry/')
tel = json.load(open(T + 'bladeburner.txt'))
keep = ['at', 'bitNode', 'joined', 'joinedAt', 'rank', 'skillPoints', 'levels', 'stamina', 'maxStamina', 'city', 'blackOps', 'counts', 'maxLevels', 'cities', 'staminaBonus', 'successes', 'daemon', 'skillsAt', 'lastAugReset']
tel = {k: tel[k] for k in keep if k in tel}
hist = []
with open(T + 'history.jsonl', 'rb') as f:
    f.seek(-60_000_000, 2)
    f.readline()
    for l in f:
        try:
            r = json.loads(l)
        except Exception:
            continue
        if r['at'] >= '2026-10-04T01:20' and r['at'] < '2026-10-04T02:00':
            hist.append(r)
def at(prefix):
    return [r for r in hist if r['at'].startswith(prefix)][0]
h0129 = at('2026-10-04T01:29:54')
h0152 = at('2026-10-04T01:52:07')
P = json.load(open('/tmp/bn14/player.json'))
plan = json.load(open(T + 'plan.txt'))
br = plan['decisions']['bladeRoute']
fx = {
    'why': "BN14.1 2026-10-04 01:32:10Z install on the Bladeburner route: the install actor priced the next life at 81.97h, the new life priced itself at 176.95h (01:37Z) and 126.85h (01:52Z). The pre-install person (history.jsonl 01:29:54Z), the post-install person (01:52:07Z), the save's multipliers (after the 3 NFG), the division (bladeburner.txt ~01:54Z), the timeline of city/work/money after the install, and the plan/gate/exit-jump records.",
    'tel': tel,
    'person0129': {'skills': h0129['skills'], 'exp': h0129['exp'], 'money': h0129['money'], 'city': h0129['city']},
    'person0152': {'skills': h0152['skills'], 'exp': h0152['exp'], 'money': h0152['money'], 'city': h0152['city']},
    'mults': {k: v for k, v in P['mults'].items()},
    'nfg3': {k: 1.030309 for k in P['mults'] if not k.startswith('hacknet_node_') or k == 'hacknet_node_money'},
    'rankScale': br['calibration']['rank']['k'],
    'timeline': [{'at': r['at'], 'city': r['city'], 'location': r['location'], 'money': round(r['money']), 'work': (r.get('currentWork') or {}).get('type'), 'str': r['skills']['strength'], 'def': r['skills']['defense']} for r in hist if r['at'] >= '2026-10-04T01:31'][::2],
    'installLast': [json.loads(l) for l in open(T + 'install-last.txt') if l.strip()][-1],
    'exitJump': json.load(open(T + 'exitjump.txt')),
    'planBladeRoute0157': {k: v for k, v in br.items() if k not in ('samples', 'options')},
    'sleeveBlade0154': json.load(open(T + 'sleeve.txt')).get('blade'),
    'lifetimes': [r for r in json.load(open(T + 'lifetimes.txt')) if r.get('bitNode') == 14],
    'lifeStartMs': plan['lastAugReset'],
}
# The exit inputs' retrain terms, the realised jump ledger, and the live
# numbers the records no longer hold (read off plan.txt / installgate.txt /
# exitjump.txt at the time; the capture ran ~01:58-02:10Z).
ei = json.loads([l for l in open(T + 'exitinputs.txt') if l.strip()][-1])
fx['flatPerSec'] = ei['inputs']['flatIncomePerSec']
fx['installCash'] = ei['inputs']['installCash']
fx['bladeInstallJumps'] = plan['bladeInstallJumps']
fx['gate0207'] = {'nowH': 102.58347591210445, 'neverH': 107.57630843897353, 'ageMs': 2106572, 'planKey': 'now', 'liveGuard': {'ok': False, 'gainH': -90.075, 'biasH': 95.068, 'young': True, 'needH': 0.5}}
fx['live'] = {'0137': {'bladeH': 176.95, 'meanH': 175.13, 'source': 'exitjump.txt first sample'}, '0142': {'bladeH': 148.802, 'source': 'plan.txt exitStability.lastFail'}, '0152': {'bladeH': 126.85, 'fleet': 'none (no /tel/sleeve.txt from this node)', 'success': 'no measured attempts (k 1)', 'rankK': 0.7133, 'source': 'plan.txt decisions.bladeRoute at 01:52:14Z'}, 'actor': {'nowH': 81.967, 'neverH': 84.1, 'planMeanH': 80.526, 'lifeH': 6.74}}
fx['ordersHistory'] = [json.loads(l) for l in open(T + 'act-history.txt') if l.strip() and json.loads(l).get('at', '') >= '2026-10-04T01:30']
fx['watchdog'] = {'bladeburner.js': {'lastLaunch': '2026-10-04T01:40:13.101Z'}, 'sleeve.js': {'lastLaunch': '2026-10-04T01:52:43.641Z'}, 'bootAt': '2026-10-04T01:32:13.126Z', 'bootStarted': ['bladeburner.js on home', 'sleeve.js on home']}
json.dump(fx, open(os.path.join(REPO, 'tools/test/fixture-bn14-install-0132.json'), 'w'), indent=0)
print('wrote', len(json.dumps(fx)))
