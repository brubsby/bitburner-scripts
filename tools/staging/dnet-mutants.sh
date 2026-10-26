#!/usr/bin/env bash
# Mutation tests for BN15 support (tools/test/dnet.test.mjs): each mutant must be CAUGHT (exit 0).
#   bash tools/staging/dnet-mutants.sh
cd "$(dirname "$0")/../.." || exit 2
m() {
  node tools/mutant.mjs "$1" "$2" "$3" dnet >/dev/null 2>&1
  case $? in 0) echo "CAUGHT    $1: $4" ;; 1) echo "SURVIVED  $1: $4" ;; *) echo "NOT RUN   $1: $4" ;; esac
}
# --- the first slice (2026-10-25)
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
# --- the labyrinth route (2026-10-25, second slice)
m dnetplan.js "      return kingOfTheHillSolver(model, n, retryNo)" "      return { model, solvable: false, why: 'KingOfTheHill not solved', feedback: true, nextGuess: () => null }" 'KingOfTheHill unsolved again'
m dnetplan.js "              if (Math.abs(ci - cj) <= tol) {" "              if (false) {" 'KotH: the agreement step (two clean-window points fix P)'
m dnetplan.js "export const gapBelowOf = (row) => Number.isFinite(row) && row >= 0 && isAirGap(row + 1)" "export const gapBelowOf = (row) => Number.isFinite(row) && row >= 0 && isAirGap(row)" 'gap edge off by one'
m dnetplan.js "    if (p > 0 && (!best" "    if (p >= 0 && (!best" 'rider picks a carrier that cannot cross'
m dnet.js "        const pid = threads >= 1 ? ns.exec(RIDER, me, { threads }, ride.host) : 0" "        const pid = 0" 'crawler never starts the rider'
m dnetplan.js "  return { coords: [Number(m[2]), Number(m[3])], north: open(rows[0][1])," "  return { coords: [Number(m[2]), Number(m[3])], north: open(rows[2][1])," 'labViewOf reads north from the wrong row'
m dnet-lab.js "      return say({ state: 'cleared', coords: view.coords })" "      ns.scp(['dnet.js'], lab)
      return say({ state: 'cleared', coords: view.coords })" 'walker pays scp per thread again'
m dnet.js "  const pid = ns.exec(LAB_WALKER, me, { threads }, lab)" "  const pid = ns.exec(LAB_WALKER, me, { threads: 1 }, lab)" 'walker started on one thread'
m dnetplan.js "  if (q.has(lab.reward)) return { install: true" "  if (false) return { install: true" 'lab install never fires'
m installgate.js "(terminal || labInst || (!unpricedHold" "(terminal || (!unpricedHold" 'the gate ignores the lab install'
m progress.js "      labInstall: labInstallOf({" "      labInstallX: labInstallOf({" 'progress.js unwired from the lab install'
m chaplan.js "  const skillFactor = (5 * req + (diff + 1) * 100) / (p.cha + 150)" "  const skillFactor = (5 * req + (diff + 1) * 100) / (p.cha + 100)" 'auth time port drift'
m chaplan.js "export const WORKER_GB = 2.25" "export const WORKER_GB = 2.2" 'farm priced on the wrong worker RAM'
m objective.js "  return { ln: v.savedH / c.hoursPerLn," "  return { ln: v.savedH * c.hoursPerLn," 'charisma value in the wrong unit'
m augplan.js "      const full = o.oneoff?.chaLabs ? augValue(" "      const full = false ? augValue(" 'hacking+charisma aug loses its charisma value'
m dnet-seed.js "  const ruleOn = info.currentNode === 15 && rules[15]?.labReady === true" "  const ruleOn = info.currentNode === 15" 'the farm runs off the lab route'
m dnet-seed.js "  if (cha >= need) return stop(" "  if (false) return stop(" 'the farm never stops at the lab'
