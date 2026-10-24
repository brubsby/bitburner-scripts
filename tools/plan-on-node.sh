#!/usr/bin/env bash
# RE-SOLVE THE NODE ORDER WHEN THE NODE CHANGES (systemd user timer bitburner-plan.timer).
# plan.mjs writes next-node.txt, which the daemon pushes to /next-node.txt; watchdog.js
# (nextNodeArgsOf) hands it to endgame.js as --next. Hand-set --next went stale twice
# (BN3 replayed ~9h on 10-22; BN13.3 out of plan order on 10-23).
set -u
cd "$(dirname "$0")/.." || exit 2
STAMP="$HOME/.cache/plan-on-node.stamp"
curl -s -m 20 localhost:12526/poll >/dev/null 2>&1
SIG=$(python3 -c "
import json
d=json.load(open('.telemetry/state.json'))
sf=d['sourceFiles']['data']; sf=dict(sf) if isinstance(sf,list) else sf
print(d['bitNode'], sorted(sf.items()))" 2>/dev/null) || { echo "state unreadable"; exit 2; }
NEXTFROM=$(python3 -c "import json;print(json.load(open('next-node.txt')).get('from'))" 2>/dev/null)
NODE=${SIG%% *}
if [ "$SIG" = "$(cat "$STAMP" 2>/dev/null)" ] && [ "$NEXTFROM" = "$NODE" ]; then exit 0; fi
echo "$(date -u +%FT%TZ) re-solving: $SIG"
if nice -n 15 timeout 2400 node tools/sim/gameplan/plan.mjs --jobs 3 > "$HOME/.cache/plan-on-node.log" 2>&1; then
  printf '%s' "$SIG" > "$STAMP"
  grep -A1 '^RECOMMENDATION' "$HOME/.cache/plan-on-node.log"; grep 'next-node.txt' "$HOME/.cache/plan-on-node.log"
else
  echo "plan.mjs FAILED (see ~/.cache/plan-on-node.log)"; tail -5 "$HOME/.cache/plan-on-node.log"; exit 1
fi
