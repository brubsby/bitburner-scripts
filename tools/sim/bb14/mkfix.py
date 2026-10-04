# Freeze the live BN14.1 Bladeburner state for tools/sim/bb14.mjs (the policy audit).
#   python3 tools/sim/bb14/mkfix.py <out.json>
# Reads ~/Repos/bitburner-scripts/.telemetry (bladeburner.txt, plan.txt bladeRoute,
# sleeve.txt, go.txt, state.json) and the newest post-install recorder save in
# /tmp/bbk14/cap for the *_exp multipliers (unchanged since the 10:22Z install:
# the same 14 augmentations). The combat/charisma LEVEL multipliers are solved
# from (level, exp) by bb14.mjs, since the save digest carries no mults.
import json, glob, os, sys
T = os.path.expanduser('~/Repos/bitburner-scripts/.telemetry')
J = lambda f: json.load(open(os.path.join(T, f)))
bb = J('bladeburner.txt'); plan = J('plan.txt'); sl = J('sleeve.txt'); go = J('go.txt'); st = J('state.json')
save = json.load(open(sorted(glob.glob('/tmp/bbk14/cap/save.*'))[-1]))
br = plan['decisions']['bladeRoute']
keep = ['at','joined','joinedAt','rank','rankPerHour','skillPoints','levels','stamina','maxStamina','city','team','blackOps','counts','maxLevels','cities','citiesAt','staminaBonus','skillsAt','calibration','action','daemon']
tel = {k: bb.get(k) for k in keep}
tel['calibration'] = {k: v for k, v in (bb.get('calibration') or {}).items()}
out = {
  'at': bb['at'],
  'tel': tel,
  'person': {'skills': st['skills'], 'exp': st['exp'], 'money': st['money'], 'city': st['city'], 'augmentations': st['augmentations'], 'sourceFiles': st['sourceFiles']['data'],
             'expMults': {k: v for k, v in save['player']['mults'].items() if k.endswith('_exp') or k.startswith('bladeburner_')}, 'expMultsFrom': save.get('at')},
  'go': {k: go.get(k) for k in ['at','bonuses','opponent','goPower','sf14','lastAugReset']},
  'sleeves': [{'i': p['i'], 'shock': p['shock'], 'sync': p['sync'], 'skills': p['skills'], 'exp': p['exp']} for p in sl['persons']],
  'bladeRoute': {k: br.get(k) for k in ['bladeH','q10','q50','q90','bladeMembers','sleeves','calibration','start','simulacrum','installBasis']},
}
json.dump(out, open(sys.argv[1], 'w'), indent=1)
print('wrote', sys.argv[1], out['at'], 'rank', tel['rank'])
