#!/usr/bin/env bash
# THE SCHEDULE THE HEALTHCHECK NEVER HAD. tools/healthcheck.mjs checked the
# right things for weeks and nobody ran it, so BN8 stalled for 5.8h unseen
# (2026-09-25). Run this in the background from any agent session driving the
# game: it runs the healthcheck every INTERVAL seconds and EXITS — waking the
# session — the first time a problem appears that was not in the previous
# run's set. A known problem does not re-wake; a new one always does.
#   bash tools/watch-run.sh [intervalSeconds=900] [maxHours=12] [baseline]
# "baseline": problems present at start are taken as known (already being
# fixed) — only NEW ones wake the session.
cd "$(dirname "$0")/.." || exit 2
INTERVAL=${1:-900}; MAX=$(( ${2:-12} * 3600 )); seen=""; first=${3:-}
while [ $SECONDS -lt $MAX ]; do
  out=$(timeout 180 node tools/healthcheck.mjs --json 2>/dev/null)
  cur=$(printf '%s' "$out" | python3 -c "import json,sys
try: d=json.load(sys.stdin); print('\n'.join(sorted(p['what'].split(':')[0] for p in d['problems'])))
except Exception: print('HEALTHCHECK DID NOT ANSWER')")
  if [ "$first" = baseline ]; then seen="$cur"; first=""; echo "baseline: ${cur:-none}"; sleep "$INTERVAL"; continue; fi
  new=$(comm -13 <(printf '%s\n' "$seen" | sort -u) <(printf '%s\n' "$cur" | sort -u) | grep -v '^$')
  if [ -n "$new" ]; then echo "$(date -u +%FT%TZ) NEW PROBLEM(S):"; printf '%s\n' "$new"; echo "--- full:"; printf '%s' "$out" | python3 -c "import json,sys;d=json.load(sys.stdin);[print(' !',p['what'],'|',p.get('detail')) for p in d['problems']]" 2>/dev/null; exit 1; fi
  seen="$cur"; sleep "$INTERVAL"
done
echo "$(date -u +%FT%TZ) no new problems in ${2:-12}h"
