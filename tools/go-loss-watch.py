#!/usr/bin/env python3
"""Emit one line per lost Go game in .telemetry/go-games.txt (polls; the log is
rewritten when trimmed, so tail -f would miss or repeat lines). Starts after the
newest game present at launch, or after --since ISO time."""
import json, sys, time, os

LOG = os.path.join(os.path.dirname(__file__), '..', '.telemetry', 'go-games.txt')
since = sys.argv[sys.argv.index('--since') + 1] if '--since' in sys.argv else None


def games():
    try:
        with open(LOG) as f:
            for line in f:
                try:
                    yield json.loads(line)
                except Exception:
                    pass
    except FileNotFoundError:
        return


if since is None:
    since = max((g.get('at', '') for g in games()), default='')
while True:
    newest = since
    for g in games():
        at = g.get('at', '')
        if at <= since:
            continue
        newest = max(newest, at)
        if g.get('won') is False:
            moves = ' '.join(f"{m.get('m')}/{m.get('r')}" for m in g.get('moves', []))
            print(f"GO LOSS {at} {g.get('opponent')}@{g.get('size')} black {g.get('black')} white {g.get('white')} "
                  f"ver {g.get('ver')} streak {g.get('streakBefore')} resumed {g.get('resumed')} moves: {moves}", flush=True)
    since = newest
    time.sleep(5)
