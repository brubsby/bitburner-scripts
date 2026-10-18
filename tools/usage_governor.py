#!/usr/bin/env python3
"""THE SESSION'S USAGE REFERENCE GOVERNOR.

The driving Claude session is the plant; its "reference" is the operating LEVEL it
works at (how often it wakes, whether it starts subagents). This governor sits
outside that loop and shapes only the level so the predicted weekly usage at the
reset stays under a cap -- a reference governor in the control sense: predict the
trajectory, pick the most aggressive admissible reference.

  usage now u, hours to reset H, burn rate r(level) in %/h
  admissible level  <=>  u + r(level) * H <= CAP
  chosen level = the highest admissible one (hysteresis: move up only with MARGIN
  to spare and after DWELL; move down at once)

Source: ~/.claude/cache/statusline-input.json rate_limits.seven_day (shared by every
session on the account; rewritten whenever any session renders its statusline).
Samples go to ~/.claude/cache/usage-samples.jsonl (shared). The measured burn rate
is the slope over the last WINDOW hours of samples taken at the CURRENT level; the
other levels' rates are that measurement scaled by FACTOR (priors, re-fitted from
samples tagged with each level once there are enough).

State: ~/.claude/cache/usage-level.json {level, u, hoursLeft, rate, projected, why}.
The process EXITS (waking the session) only when the level changes, printing the
new level and its directives; the session applies them and restarts the governor.
At 'minimal' and 'off' it stops the session's wake watchers itself.

  python3 tools/usage_governor.py            # run (background)
  python3 tools/usage_governor.py --status   # print the current projection and exit
"""
import json, os, subprocess, sys, time

HOME = os.path.expanduser('~')
SRC = os.environ.get('USAGE_FILE', f'{HOME}/.claude/cache/statusline-input.json')
SAMPLES = f'{HOME}/.claude/cache/usage-samples.jsonl'
STATE = f'{HOME}/.claude/cache/usage-level.json'
CAP = float(os.environ.get('CAP', 97))          # % allowed at the reset
MARGIN = float(os.environ.get('MARGIN', 5))     # % spare needed to step a level UP
DWELL = float(os.environ.get('DWELL', 2)) * 3600  # s at a level before stepping up
POLL = int(os.environ.get('POLL', 300))
WINDOW = float(os.environ.get('WINDOW', 6))     # h of samples for the burn rate
HARD = float(os.environ.get('HARD', 95))        # % -> 'off' regardless of projection
MIN_SPAN_CUR = float(os.environ.get('MIN_SPAN_CUR', 2)) * 3600  # s of the current level's own samples before its slope counts

LEVELS = ['off', 'minimal', 'conserve', 'full']  # ascending aggressiveness
FACTOR = {'full': 1.0, 'conserve': 0.45, 'minimal': 0.12, 'off': 0.02}  # prior burn vs full
DIRECTIVES = {
    'full': 'normal operation: watchers armed, subagents as needed',
    'conserve': 'batch Go losses (3 per diagnosis); subagents only for live regressions/stalls; '
                'healthcheck ignores cosmetic classes; no new optimisation projects',
    'minimal': 'Go loss watcher OFF; healthcheck only for stalls (daemon unreachable, PLAYER IDLE, '
               'NO INSTALL, EXIT NOT APPROACHING); deploy/restart only, no subagents unless the run is stalled',
    'off': 'no wake watchers; no subagents; one final autonomy audit, then sleep to the reset',
}
WATCHERS = {  # bracketed patterns: pkill -f must never match its own shell
    'minimal': ['[g]o-loss-watch.py', '[g]rep --line-buffered -m1 -E HOT'],
    'off': ['[g]o-loss-watch.py', '[w]atch-run.sh', '[g]rep --line-buffered -m1 -E HOT'],
}


def read_src():
    try:
        r = json.load(open(SRC))['rate_limits']['seven_day']
        return float(r['used_percentage']), int(r['resets_at'])
    except Exception:
        return None, None


def load_samples():
    out = []
    try:
        for line in open(SAMPLES):
            try:
                out.append(json.loads(line))
            except Exception:
                pass
    except FileNotFoundError:
        pass
    return out


def slope(samples, reset, level=None, now=None, min_span=1800):
    """%/h over the last WINDOW h of this week's samples (optionally one level's)."""
    now = now or time.time()
    s = [x for x in samples if x.get('reset') == reset and now - x['t'] <= WINDOW * 3600
         and (level is None or x.get('level') == level)]
    if len(s) < 2 or s[-1]['t'] - s[0]['t'] < min_span:
        return None
    # least squares
    n = len(s); mt = sum(x['t'] for x in s) / n; mu = sum(x['u'] for x in s) / n
    den = sum((x['t'] - mt) ** 2 for x in s)
    if den <= 0:
        return None
    return max(0.0, sum((x['t'] - mt) * (x['u'] - mu) for x in s) / den * 3600)


def rates(samples, reset, current, now):
    """Burn rate per level: measured where there are samples, else the current level's
    measurement scaled by the FACTOR ratio, else a week-average fallback."""
    # The CURRENT level needs >= MIN_SPAN_CUR of its own samples before its slope counts: the wake
    # a level change sends is itself a burst of usage, and 30 min of it extrapolated over the week
    # flapped off -> minimal -> off in minutes (2026-10-18: minimal "projected 173%" on the wake's burst).
    meas = {lv: slope(samples, reset, lv, now, MIN_SPAN_CUR if lv == current else 1800) for lv in LEVELS}
    base = None
    for lv in [current] + [l for l in LEVELS if l != current]:
        if meas.get(lv) is not None:
            base = meas[lv] / FACTOR[lv]
            break
    # The week's average burn (u / hours elapsed) is a FLOOR on the full-level base:
    # an idle stretch measures ~0 at a low level, and 0 / factor says nothing about what
    # running fuller costs (2026-10-13: idle conserve projected full at 84% -> stepped to
    # full). Idle time may lift the level slowly, never make full look free.
    u_now, _ = read_src()
    week_start = reset - 7 * 86400
    avg = (u_now or 0) / max(1.0, (now - week_start) / 3600)
    base = max(base if base is not None else 0.0, avg)
    return {lv: (meas[lv] if meas.get(lv) is not None else base * FACTOR[lv]) for lv in LEVELS}, meas


def decide(u, reset, current, since, samples, now):
    H = max(0.0, (reset - now) / 3600)
    r, meas = rates(samples, reset, current, now)
    proj = {lv: u + r[lv] * H for lv in LEVELS}
    if u >= HARD:
        return 'off', H, r, proj, meas, f'usage {u:.0f}% >= hard stop {HARD:.0f}%'
    admissible = [lv for lv in LEVELS if proj[lv] <= CAP]
    best = admissible[-1] if admissible else 'off'
    ci, bi = LEVELS.index(current), LEVELS.index(best)
    if bi > ci:  # stepping up needs margin and dwell
        up = LEVELS[ci + 1]
        if proj[up] <= CAP - MARGIN and now - since >= DWELL:
            return up, H, r, proj, meas, f'{up} projects {proj[up]:.1f}% <= {CAP - MARGIN:.0f}% (cap {CAP:.0f} - margin) after {(now - since) / 3600:.1f}h at {current}'
        return current, H, r, proj, meas, f'holding {current} ({proj[current]:.1f}% projected); {up} would project {proj[up]:.1f}%'
    if bi < ci:
        return best, H, r, proj, meas, f'{current} projects {proj[current]:.1f}% > cap {CAP:.0f}%; highest admissible is {best} ({proj[best]:.1f}%)'
    return current, H, r, proj, meas, f'{current} projects {proj[current]:.1f}% <= cap {CAP:.0f}%'


def write_state(d):
    tmp = STATE + '.tmp'
    json.dump(d, open(tmp, 'w'), indent=1)
    os.replace(tmp, STATE)


def prev_state():
    try:
        return json.load(open(STATE))
    except Exception:
        return {}


def main():
    status_only = '--status' in sys.argv
    st = prev_state()
    level = st.get('level', 'full') if st.get('level') in LEVELS else 'full'
    since = st.get('since', time.time())
    while True:
        now = time.time()
        u, reset = read_src()
        if u is None:
            print(f'USAGE FILE UNREADABLE ({SRC})'); sys.exit(2)
        samples = load_samples()
        if not samples or samples[-1].get('u') != u or now - samples[-1]['t'] >= POLL:
            rec = {'t': now, 'u': u, 'reset': reset, 'level': level}
            with open(SAMPLES, 'a') as f:
                f.write(json.dumps(rec) + '\n')
            samples.append(rec)
        if now > reset:  # a new week the file hasn't shown yet: wait for a render
            new, H, r, proj, meas, why = level, 0, {}, {}, {}, 'reset time passed; waiting for the file to show the new week'
        else:
            new, H, r, proj, meas, why = decide(u, reset, level, since, samples, now)
        out = {'at': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(now)), 'level': new, 'since': since if new == level else now,
               'u': u, 'resetsAt': time.strftime('%Y-%m-%dT%H:%MZ', time.gmtime(reset)), 'hoursLeft': round(H, 2),
               'rate': {k: round(v, 3) for k, v in r.items()}, 'measured': {k: (round(v, 3) if v is not None else None) for k, v in meas.items()},
               'projected': {k: round(v, 1) for k, v in proj.items()}, 'cap': CAP, 'why': why, 'directive': DIRECTIVES[new]}
        if status_only:
            print(json.dumps(out, indent=1)); return
        write_state(out)
        if new != level:
            for pat in WATCHERS.get(new, []):
                subprocess.run(['pkill', '-f', pat])
            backlog = (' BUDGET RAISED: work the postponed backlog in docs/postponed-after-reset.md'
                       ' (highest value first; strike items with their commits).') if LEVELS.index(new) > LEVELS.index(level) else ''
            print(f"USAGE LEVEL {level} -> {new}: {why}. u={u:.0f}% resets {out['resetsAt']} ({H:.1f}h). DIRECTIVE: {DIRECTIVES[new]}.{backlog} Apply it, then restart: python3 tools/usage_governor.py")
            return
        time.sleep(POLL)


if __name__ == '__main__':
    main()
