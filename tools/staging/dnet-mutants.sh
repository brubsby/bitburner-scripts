#!/usr/bin/env bash
# Mutation tests for BN15 support (tools/test/dnet.test.mjs): each mutant must be CAUGHT (exit 0).
#   bash tools/staging/dnet-mutants.sh
cd "$(dirname "$0")/../.." || exit 2
m() {
  node tools/mutant.mjs "$1" "$2" "$3" dnet >/dev/null 2>&1
  case $? in 0) echo "CAUGHT    $1: $4" ;; 1) echo "SURVIVED  $1: $4" ;; *) echo "NOT RUN   $1: $4" ;; esac
}
m watchdog.js 'export const NEXT_NODE_MAX = 15' 'export const NEXT_NODE_MAX = 14' 'nextNodeArgsOf caps at 14 again'
m tools/sim/gameplan/state.mjs 'export const LAST = new Set([15])' 'export const LAST = new Set([])' 'BN15 no longer last'
m tools/sim/gameplan/state.mjs "n === 15 ? SF15_TARGET : 3)" "n === 15 ? 0 : 3)" 'BN15 not owed (the old exclusion)'
m tools/sim/gameplan/search.mjs '        if (last[d] && pendingOther) continue' '' 'solveDP ignores the LAST order'
m tools/sim/gameplan/routes.mjs "!(node === 8 && bn8On(world)) && node !== 15,
    hours: hackOnCtx," "!(node === 8 && bn8On(world)),
    hours: hackOnCtx," "the Daedalus hack route prices BN15"
m routepin.js '    labReady: false,' '    labReady: true,' 'the BN15 route rule lifted'
m progress.js 'const acted = nodeRouteOf(pinnedRouteOf(priced, pin), info.currentNode, pin)' 'const acted = pinnedRouteOf(priced, pin)' 'progress.js unwired from the node rule'
m dnetplan.js "fixed(['A'.repeat(2 * n)]" "fixed(['A'.repeat(n)]" 'buffer overflow solver'
m dnetplan.js "  { name: 'et3rn4l_l4byr1nth', depth: 29," "  { name: 'et3rn4l_l4byr1nth', depth: 28," 'lab table drift'
m dnetplan.js "  else if (node === 15 && nextAug === law && !has(RED_PILL)) reward = RED_PILL" "  else if (false) reward = RED_PILL" 'BN15 5th-lab Red Pill rule'
m dnetplan.js "    return dir" "    return OPP[dir]" 'maze walk direction'
m watchdog.js "invariant: (ns) => hasDarknetAccess(ns.getResetInfo()) }," "invariant: (ns) => true }," 'dnet-seed ungated'
