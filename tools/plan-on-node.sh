#!/usr/bin/env bash
# RE-SOLVE THE NODE ORDER WHEN THE NODE CHANGES (systemd user timer bitburner-plan.timer).
# plan.mjs writes next-node.txt, which the daemon pushes to /next-node.txt; watchdog.js
# (nextNodeArgsOf) hands it to endgame.js as --next. Hand-set --next went stale twice
# (BN3 replayed ~9h on 10-22; BN13.3 out of plan order on 10-23).
# THEN DRY-RUN THE NEXT NODE'S ENTRY (tools/sim/entry/dryrun.mjs): the live save entered into it by
# the game's own prestige, the stack's first minute and one planner pass run against it, every
# unpriced / held / absurd / blocked decision named in .telemetry/entry-dryrun.json — read by
# tools/healthcheck.mjs as NEXT NODE ENTRY UNPRICED, so it surfaces before the exit, not live.
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

# the entry dry-run of next-node.txt's node, unless one of that node from this node is on file
dryrun() {
  local NEXT
  NEXT=$(python3 -c "import json;d=json.load(open('next-node.txt'));print('%d.%d %s'%(d['next'],d['level'],d['label']))" 2>/dev/null) || { echo "next-node.txt unreadable: no entry dry-run"; return 1; }
  local NL=${NEXT%% *} LABEL=${NEXT#* }
  # on file for this exit: kept, except a failing one is re-run every 3h (a fix lands without a node change)
  if python3 -c "
import json,sys,datetime
d=json.load(open('.telemetry/entry-dryrun.json'))
age=(datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(d['at'].replace('Z','+00:00'))).total_seconds()
sys.exit(0 if d.get('from')==$NODE and (d.get('next') or {}).get('label')=='$LABEL' and (d.get('ok') or age<3*3600) else 1)" 2>/dev/null; then return 0; fi
  echo "$(date -u +%FT%TZ) entry dry-run: $LABEL from BN$NODE"
  nice -n 15 timeout 2400 node tools/sim/entry/dryrun.mjs --chain "$NL" --summary .telemetry/entry-dryrun.json > "$HOME/.cache/entry-dryrun.log" 2>&1
  local RC=$?
  if [ ! -s .telemetry/entry-dryrun.json ] || ! python3 -c "
import json,sys
d=json.load(open('.telemetry/entry-dryrun.json'))
sys.exit(0 if d.get('from')==$NODE and (d.get('next') or {}).get('label')=='$LABEL' else 1)" 2>/dev/null; then
    # the dry-run itself died: say so in the file the healthcheck reads (never silence)
    printf '%s\n' "{\"at\":\"$(date -u +%FT%TZ)\",\"by\":\"tools/plan-on-node.sh\",\"ok\":false,\"from\":$NODE,\"next\":{\"label\":\"$LABEL\"},\"nodes\":[{\"label\":\"$LABEL\",\"ok\":false,\"problems\":[\"NOT RUN dry-run: dryrun.mjs exited $RC without a summary (~/.cache/entry-dryrun.log)\"]}]}" > .telemetry/entry-dryrun.json
  fi
  grep -E '^BN|^  !!' "$HOME/.cache/entry-dryrun.log" | head -20
}

if [ "$SIG" = "$(cat "$STAMP" 2>/dev/null)" ] && [ "$NEXTFROM" = "$NODE" ]; then dryrun; exit 0; fi
echo "$(date -u +%FT%TZ) re-solving: $SIG"
if nice -n 15 timeout 2400 node tools/sim/gameplan/plan.mjs --observe --jobs 3 > "$HOME/.cache/plan-on-node.log" 2>&1; then
  printf '%s' "$SIG" > "$STAMP"
  grep -A1 '^RECOMMENDATION' "$HOME/.cache/plan-on-node.log"; grep 'next-node.txt' "$HOME/.cache/plan-on-node.log"
else
  echo "plan.mjs FAILED (see ~/.cache/plan-on-node.log)"; tail -5 "$HOME/.cache/plan-on-node.log"
  printf '%s\n' "{\"at\":\"$(date -u +%FT%TZ)\",\"failed\":true,\"why\":\"plan.mjs failed: ~/.cache/plan-on-node.log\"}" > .telemetry/plan-on-node-failed.json
  exit 1
fi
dryrun
