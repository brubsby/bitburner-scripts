#!/usr/bin/env node
// Prints the expected-value functions against the live snapshot, so the
// numbers in docs/fidelity-log.md can be reproduced and so the functions get
// exercised outside a simulation run.
//
//   node tools/sim/fidelity/ev-probe.mjs
//   node tools/sim/fidelity/ev-probe.mjs --level 89 --ram 220
//
// NOT CALIBRATED. This prints ev.mjs's functions on a stored snapshot so the
// docs can be reproduced; it compares nothing to the running game. The numbers
// are exact evaluations of the game's formulas at whatever inputs the snapshot
// happens to hold, which means they are only as current as that file.

import { loadSnapshot } from "../world.mjs";
import { calculateSkill } from "../game.mjs";
import * as EV from "./ev.mjs";

const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i > -1 ? argv[i + 1] : d;
};

const snap = loadSnapshot();
const level = Number(flag("level", snap.player.hacking));
const fleetRamGb = Number(flag("ram", 2380));
const horizonSeconds = Number(flag("horizon", 1800));

const player = {
  money: snap.player.money,
  hackExp: snap.player.hackExp,
  skills: { hacking: level, intelligence: 0 },
  mults: { hacking: 1, hacking_chance: 1, hacking_speed: 1, hacking_money: 1, hacking_grow: 1, hacking_exp: 1 },
};

const fmt = (n, d = 2) =>
  !isFinite(n) ? "inf" : Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(d)}b` : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(d)}m` : Math.abs(n) >= 1e3 ? `${(n / 1e3).toFixed(d)}k` : n.toFixed(d);

const reachable = snap.servers.filter(
  (s) => s.moneyMax > 0 && s.requiredHackingSkill <= level && s.numOpenPortsRequired <= 2,
);
for (const s of reachable) s.hasAdminRights = true;

console.log(`\nlevel ${level}, fleet ${fleetRamGb}GB, horizon ${horizonSeconds}s\n`);

console.log(
  "  " +
    "target".padEnd(18) +
    "$/RAM-s".padStart(10) +
    "exp/RAM-s".padStart(11) +
    "prep s".padStart(9) +
    "cap GB".padStart(9) +
    "loadH".padStart(8) +
    "loadG".padStart(8),
);
console.log("  " + "-".repeat(73));
const ranked = reachable
  .map((s) => ({ s, rate: EV.harvestRate(s, player) }))
  .sort((a, b) => b.rate - a.rate)
  .slice(0, 12);
for (const { s, rate } of ranked) {
  const prep = EV.prepCost(s, player);
  console.log(
    "  " +
      s.hostname.padEnd(18) +
      fmt(rate, 4).padStart(10) +
      fmt(EV.harvestExpRate(s, player), 5).padStart(11) +
      fmt(prep.secondsAtRam(fleetRamGb), 0).padStart(9) +
      fmt(EV.targetCapacityRamGb(s, player), 0).padStart(9) +
      fmt(EV.loadedHackRamSeconds(s, player), 1).padStart(8) +
      fmt(EV.loadedGrowRamSeconds(s, player), 1).padStart(8),
  );
}

// --- per operation -----------------------------------------------------------
const t = ranked[0].s;
console.log(`\nper-thread EV on ${t.hostname} (money ${((t.moneyAvailable / t.moneyMax) * 100).toFixed(1)}%, sec ${t.hackDifficulty}/${t.minDifficulty}):`);
const threads = Math.floor(fleetRamGb / 2.4);
for (const [name, ev] of [
  ["hack", EV.evHackThread(t, player, { threads })],
  ["grow", EV.evGrowThread(t, player, { threads })],
  ["weaken", EV.evWeakenThread(t, player, { opsAhead: threads })],
]) {
  console.log(
    `  ${name.padEnd(8)} $${fmt(ev.money).padStart(10)}  exp ${ev.exp.toFixed(2).padStart(7)}` +
      `  ${ev.seconds.toFixed(1).padStart(7)}s  RAM-s ${ev.ramSeconds.toFixed(1).padStart(8)}` +
      (ev.loadedRamSeconds ? `  loaded ${ev.loadedRamSeconds.toFixed(1)}` : "") +
      (ev.ramSecondsSaved !== undefined ? `  saves ${fmt(ev.ramSecondsSaved, 0)} RAM-s` : ""),
  );
}

const choice = EV.evPrepVsHack(t, player, { threads });
console.log(
  `  prep-vs-hack at ${threads} threads: hack $${choice.hackPer.toExponential(3)}/RAM-s,` +
    ` grow $${choice.growPer.toExponential(3)}/RAM-s, weaken $${choice.weakPer.toExponential(3)}/RAM-s` +
    `  -> ${choice.best}`,
);

// --- saturation --------------------------------------------------------------
const cap = EV.marginalHackThread(t, player, 1).capacity;
console.log(`\nhack-thread capacity of ${t.hostname}: ${Math.ceil(cap)} threads (1/phi). Fleet has ${threads}.`);
for (const n of [1, Math.ceil(cap / 2), Math.ceil(cap), Math.ceil(cap * 2)]) {
  const m = EV.marginalHackThread(t, player, n);
  console.log(`  thread #${String(n).padStart(6)}: marginal $${fmt(m.money, 2).padStart(10)}  saturated=${m.saturated}`);
}

// --- retarget ----------------------------------------------------------------
console.log(`\nretarget EV, incumbent ${ranked[0].s.hostname}, H=${horizonSeconds}s, fleet ${fleetRamGb}GB:`);
for (const { s } of ranked.slice(1, 6)) {
  const d = EV.evRetarget({
    current: ranked[0].s,
    candidate: s,
    player,
    fleetRamGb,
    horizonSeconds,
    inFlightRamSeconds: fleetRamGb * 60,
  });
  console.log(
    `  -> ${s.hostname.padEnd(18)} stay $${fmt(d.stay.total).padStart(9)} (prep ${d.stay.prepSeconds.toFixed(0)}s)` +
      `  move $${fmt(d.move.total).padStart(9)} (prep ${d.move.prepSeconds.toFixed(0)}s)` +
      `  discard $${fmt(d.discarded).padStart(9)}  => ${d.switch ? "SWITCH" : "stay"}`,
  );
}

// --- exp price ---------------------------------------------------------------
const price = EV.expPriceFromHorizon(ranked[0].s, { ...player, hackExp: snap.player.hackExp }, { fleetRamGb, horizonSeconds });
console.log(
  `\nexp price at level ${level}: one level is worth $${fmt(price.dollarsPerLevel)} over ${horizonSeconds}s` +
    ` and costs ${fmt(price.expPerLevel)} exp  =>  $${price.dollarsPerExp.toFixed(2)} per exp point`,
);

// --- buy RAM -----------------------------------------------------------------
const achieved = EV.harvestRate(ranked[0].s, player);
console.log(`\nbuy RAM at the top target's rate ($${achieved.toExponential(3)}/RAM-s):`);
for (const gb of [64, 512, 8192]) {
  const d = EV.evBuyRam({ gb, cost: 55000 * gb, achievedRatePerRamSecond: achieved, horizonSeconds });
  console.log(
    `  ${String(gb).padStart(6)}GB cost $${fmt(55000 * gb).padStart(8)}  revenue $${fmt(d.revenue).padStart(9)}` +
      `  payback ${d.paybackSeconds.toFixed(0)}s  => ${d.buy ? "BUY" : "hold"}`,
  );
}
console.log(
  `  (the trap: at the rate actually *achieved* during the flat window — $0/RAM-s — every one of these is "hold")`,
);

const split = EV.fleetSplit(reachable, player, { fleetRamGb });
console.log(`\nfleet split of ${fleetRamGb}GB:`);
for (const p of split.plan.slice(0, 8))
  console.log(`  ${p.server.hostname.padEnd(18)} ${p.ramGb.toFixed(0).padStart(7)}GB of ${p.capacityRamGb.toFixed(0)}GB capacity  rate ${p.rate.toExponential(3)}`);
console.log(`  idle ${split.idleRamGb.toFixed(0)}GB, marginal rate ${split.marginalRate.toExponential(3)}`);

process.exit(0);
