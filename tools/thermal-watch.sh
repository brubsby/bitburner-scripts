#!/usr/bin/env bash
# THERMAL WATCHDOG for this laptop (puter) and bubtop. Polls every POLL seconds,
# prints one line per state change (so a Monitor can alert on it), and PAUSES
# (SIGSTOP) experiment jobs when something runs hot, resuming (SIGCONT) when it
# cools. It never touches the live game, the RFA daemon, go-solver, the live
# KataGo service (tools/katago service.mjs / run-analysis*), or the cipher jobs.
#
# There is no room thermometer on either machine (bubtop's only Windows thermal
# zone reads 3010K = 27.85C, the classic ACPI dummy constant). The room proxies:
#   - bubtop GPU hot while nearly idle (heat the card is not making itself);
#   - the laptop's SEN2 board sensor.
#
# Usage: bash tools/thermal-watch.sh [--dry]   (--dry: report, never pause)
set -u
POLL=${POLL:-60}
DRY=0; [ "${1:-}" = "--dry" ] && DRY=1
LOG=${LOG:-$HOME/Repos/bitburner-scripts/.telemetry/thermal.log}
# Thresholds (C). GPU: the 4090 throttles ~84-88.
GPU_PAUSE=${GPU_PAUSE:-83}; GPU_RESUME=${GPU_RESUME:-72}
GPU_IDLE_UTIL=${GPU_IDLE_UTIL:-20}; GPU_IDLE_HOT=${GPU_IDLE_HOT:-60}
PKG_PAUSE=${PKG_PAUSE:-97}; PKG_STREAK=${PKG_STREAK:-3}
SEN2_HOT=${SEN2_HOT:-55}
# Experiment jobs (bracketed first char so pgrep/pkill never match their own shell).
BUBTOP_JOBS='[n]ode .*tools/sim/go-|[n]ode .*go-w0|[n]ode .*go-book|[n]ode .*go-oracle|[p]ython.*(train|selfplay|finetune)|[k]atago .*(selfplay|train)'
LOCAL_JOBS='[n]ode .*tools/sim/go-|[n]ode .*go-w0|[n]ode .*go-book|[n]ode .*go-oracle'

zone() { for z in /sys/class/thermal/thermal_zone*; do [ "$(cat $z/type 2>/dev/null)" = "$1" ] && { echo $(( $(cat $z/temp) / 1000 )); return; }; done; echo NA; }
say() { local m="$(date -u +%H:%M:%SZ) $*"; echo "$m"; echo "$m" >>"$LOG"; }

bub_paused=0; loc_paused=0; pkg_streak=0; last=""
while true; do
  pkg=$(zone x86_pkg_temp); sen2=$(zone SEN2)
  g=$(timeout 15 ssh -o ConnectTimeout=8 -o BatchMode=yes bubtop '/usr/lib/wsl/lib/nvidia-smi --query-gpu=temperature.gpu,utilization.gpu --format=csv,noheader,nounits' 2>/dev/null | tr -d ' ')
  gt=${g%%,*}; gu=${g##*,}; [ -z "$g" ] && { gt=NA; gu=NA; }

  reasons=()
  [ "$gt" != NA ] && [ "$gt" -ge "$GPU_PAUSE" ] && reasons+=("bubtop GPU ${gt}C >= ${GPU_PAUSE}")
  [ "$gt" != NA ] && [ "$gu" -lt "$GPU_IDLE_UTIL" ] && [ "$gt" -ge "$GPU_IDLE_HOT" ] && reasons+=("ROOM? bubtop GPU ${gt}C at ${gu}% util")
  [ "$sen2" != NA ] && [ "$sen2" -ge "$SEN2_HOT" ] && reasons+=("ROOM? laptop SEN2 ${sen2}C >= ${SEN2_HOT}")
  if [ "$pkg" != NA ] && [ "$pkg" -ge "$PKG_PAUSE" ]; then pkg_streak=$((pkg_streak+1)); else pkg_streak=0; fi

  # bubtop: pause on any reason; resume once GPU < resume and no room flag.
  if [ ${#reasons[@]} -gt 0 ] && [ $bub_paused -eq 0 ]; then
    say "HOT: ${reasons[*]} -> pausing bubtop experiment jobs$([ $DRY = 1 ] && echo ' (dry)')"
    [ $DRY = 0 ] && timeout 20 ssh -o BatchMode=yes bubtop "pkill -STOP -f '$BUBTOP_JOBS'; pgrep -af '$BUBTOP_JOBS' | head -5" 2>&1 | sed 's/^/  stopped: /' | tee -a "$LOG"
    bub_paused=1
  elif [ ${#reasons[@]} -eq 0 ] && [ $bub_paused -eq 1 ] && { [ "$gt" = NA ] || [ "$gt" -lt "$GPU_RESUME" ]; }; then
    say "COOL: bubtop GPU ${gt}C, laptop SEN2 ${sen2}C -> resuming bubtop experiment jobs"
    [ $DRY = 0 ] && timeout 20 ssh -o BatchMode=yes bubtop "pkill -CONT -f '$BUBTOP_JOBS'" >/dev/null 2>&1
    bub_paused=0
  fi
  # laptop: pause local experiment jobs on a sustained hot package.
  if [ $pkg_streak -ge "$PKG_STREAK" ] && [ $loc_paused -eq 0 ]; then
    say "HOT: laptop CPU package ${pkg}C for ${pkg_streak} polls -> pausing local experiment jobs$([ $DRY = 1 ] && echo ' (dry)')"
    [ $DRY = 0 ] && pkill -STOP -f "$LOCAL_JOBS"
    loc_paused=1
  elif [ $pkg_streak -eq 0 ] && [ $loc_paused -eq 1 ] && [ "$pkg" != NA ] && [ "$pkg" -lt $((PKG_PAUSE-8)) ]; then
    say "COOL: laptop CPU package ${pkg}C -> resuming local experiment jobs"
    [ $DRY = 0 ] && pkill -CONT -f "$LOCAL_JOBS"
    loc_paused=0
  fi
  [ "$gt" = NA ] && [ "$last" != "gpuNA" ] && { say "WARN: bubtop GPU temperature unreadable (ssh/nvidia-smi) - cannot guard it"; last=gpuNA; }
  [ "$gt" != NA ] && last=""
  echo "$(date -u +%FT%TZ) pkg=$pkg sen2=$sen2 gpu=$gt util=$gu bubPaused=$bub_paused locPaused=$loc_paused" >>"$LOG"
  sleep "$POLL"
done
