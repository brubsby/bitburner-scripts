#!/usr/bin/env bash
# THE SESSION'S WEEKLY-USAGE GOVERNOR. The driving Claude session wakes on
# background watchers (go-loss-watch.py, watch-run.sh, the thermal-log grep).
# Near the weekly usage limit those wake-ups are what burns the remainder, so:
#   threshold  poll ~/.claude/cache/statusline-input.json (Claude Code rewrites it
#              every turn; rate_limits.seven_day.used_percentage / resets_at) every
#              POLL s; at >= TH percent stop the wake watchers and EXIT — waking the
#              session once, for its final audit.
#   reset      sleep silently until seven_day.resets_at (+ MARGIN s), then EXIT —
#              waking the session to re-arm its watchers.
# The game, the RFA daemon, thermal-watch.sh and the KataGo service are never
# touched: only the session's wake-ups stop.
#   bash tools/usage-governor.sh threshold|reset
set -u
F=${USAGE_FILE:-$HOME/.claude/cache/statusline-input.json}
TH=${TH:-90}; POLL=${POLL:-300}; MARGIN=${MARGIN:-300}
read_usage() {
  python3 -c "import json,sys
try:
  r=json.load(open('$F'))['rate_limits']['seven_day']; print(int(r['used_percentage']), int(r['resets_at']))
except Exception as e: print('NA NA')"
}
case "${1:-}" in
  threshold)
    while true; do
      read -r pct reset < <(read_usage)
      if [ "$pct" != NA ] && [ "$pct" -ge "$TH" ]; then
        # [b]racket patterns: pkill -f must never match this shell (memory: pkill-self-match).
        pkill -f '[g]o-loss-watch.py' ; pkill -f '[w]atch-run.sh' ; pkill -f '[g]rep --line-buffered -m1 -E HOT'
        echo "USAGE ${pct}% >= ${TH}%: wake watchers stopped at $(date -u +%FT%TZ); weekly reset at $(date -u -d @"$reset" +%FT%TZ) — run the final audit, start no new subagents, then: bash tools/usage-governor.sh reset"
        exit 0
      fi
      sleep "$POLL"
    done ;;
  reset)
    read -r pct reset < <(read_usage)
    [ "$reset" = NA ] && { echo "USAGE FILE UNREADABLE ($F) — cannot time the reset"; exit 2; }
    now=$(date +%s); wait=$(( reset + MARGIN - now ))
    [ "$wait" -gt 0 ] && sleep "$wait"
    # The file only refreshes when a session renders, so it may still show the old
    # week here: the woken session must confirm used_percentage dropped (and a new
    # resets_at) before re-arming, and run `reset` again if not (gtnh's check).
    echo "WEEKLY USAGE RESET (confirm on wake: used_percentage dropped / resets_at moved; if not, run reset again) at $(date -u -d @"$reset" +%FT%TZ) (now $(date -u +%FT%TZ)) — re-arm the wake watchers (Go loss, healthcheck, thermal) and restart: bash tools/usage-governor.sh threshold"
    exit 0 ;;
  *) echo "usage: $0 threshold|reset"; exit 2 ;;
esac
