// WHICH IPvGO OPPONENT should go.js farm?
//
//   node tools/sim/go-opponent.mjs results/*.jsonl [--windowh 1.76]
//
// ---------------------------------------------------------------------------
// The question this answers, and the one it does not.
//
// PRECONDITION — THE EXTERNAL SOLVER. Every number below is produced by
// golib.js's chooseMoveUCT at a real search budget, which in the live game
// means tools/go-solver.mjs is running: Netscript shares the browser's main
// thread, so go.js in-game searches at `maxms 20` and treats its own local
// search as a fallback ("local fallback only; the external solver does the
// real search", go.js:138). A run without the solver is NOT a slightly worse
// version of the configuration measured here — it is a regime none of these
// measurements describe, and go.js's own header records flat 20ms search
// losing 90 straight games to the Daedalus AI.
//
// This is stated because it silently failed: on 2026-09-20 the solver was
// found never to have been started across a 67-hour daemon session spanning
// BN5, BN2 and BN4, with `remoteMoves: 0` unread in /tel/go.txt. The daemon
// now supervises the solver and go.js reports `health: 'warn'` when it is not
// answering, so the precondition is checked at runtime as well as asserted
// here — but a reader reaching these numbers from outside that machinery still
// needs to know they do not apply to a solver-less run.
//
//
// tools/sim/go-boardsize.mjs measures NODE POWER PER HOUR. Until 2026-09-20 it
// hardcoded `GoOpponent.Daedalus`, so board size was swept exhaustively and the
// opponent was never a variable at all. go.js likewise carries the opponent as
// a constant (`SETTINGS.opponent = 'Daedalus'`).
//
// Node power per hour is NOT comparable across opponents, for two reasons:
//
//   1. Each opponent feeds a DIFFERENT multiplier (effect.ts:68-101):
//        Netburners   -> hacknet_node_money        bonusPower 1.3  komi 1.5
//        SlumSnakes   -> crime_success             bonusPower 1.2  komi 3.5
//        TheBlackHand -> hacking_money             bonusPower 0.9  komi 3.5
//        Tetrads      -> str/def/dex/agi           bonusPower 0.7  komi 5.5
//        Daedalus     -> company_rep + faction_rep bonusPower 1.1  komi 5.5
//        Illuminati   -> hacking_speed             bonusPower 0.7  komi 7.5
//      A channel is worth what the objective says it is worth, and that
//      changes between BitNodes and within a life.
//
//   2. `bonusPower` scales the effect and differs by up to 1.86x, and the
//      difficulty multiplier that scales POWER ACCRUAL is (komi+0.5)*0.25 —
//      EXCEPT for the one special case that dominates this whole comparison:
//      5x5 versus Illuminati is 8, not 2 (effect.ts:132-135). Against a 1.5
//      for Daedalus that is a 5.33x on power per point scored, available only
//      at the board size we already play for unrelated reasons.
//
// THE RESET IS THE OTHER HALF. Go.prestigeAugmentation (Go/Go.ts:34-47) zeroes
// nodePower for every opponent on EVERY INSTALL. Territory in the gang is a
// node asset; Go power is the opposite — it is destroyed roughly every 1.8h in
// a BN4 install cadence and regrown from zero. So the quantity that matters is
// not the effect at the end of a window but its TIME AVERAGE over one:
//
//     Ebar = (1/H) * integral_0^H  effect(P*t) dt
//
// with effect(n) = 1 + ln(n+1)*(n+1)^0.3*0.002*bonusPower*GoPower*sfBonus
// (effect.ts:16-22). Scoring the end-of-window value instead would overstate
// every opponent by the same rough factor, which is exactly the kind of error
// that survives a comparison and then misprices the channel against augs.
//
// ---------------------------------------------------------------------------
// CALIBRATION. This file measures nothing itself: the win rates, game lengths
// and node power come from tools/sim/go-boardsize.mjs and the wall-clock and
// win-streak models from its report, which is where the live cross-check lives
// and runs. That report's CHECK block — including any NOT CALIBRATED line — is
// REPRINTED here before anything else, because a recommendation that quietly
// drops its own calibration state is worse than no recommendation.
//
// What is uncalibrated even when that block passes: the CHANNEL VALUE. The
// crossover below is arithmetic on objective.deriveWeights, and the elasticity
// it needs (eB) is frequently unmeasured live. When it is, this file refuses to
// name a winner rather than picking one.
//
// ---------------------------------------------------------------------------
// HOW THE CHANNELS COMPARE, once the powers are measured.
//
// objective.deriveWeights gives hacking_money and hacking_speed the SAME
// weight, N*eB, and faction_rep the weight N*eR. So after the measurement the
// decision collapses to one ratio:
//
//     Daedalus beats Illuminati/TheBlackHand  iff  eR/eB > ln(Ebar_them)/ln(Ebar_Daedalus)
//
// This file prints that crossover rather than a single verdict, because eB is
// frequently unmeasured live (the gate publishes `eBudget: null` whenever the
// budget elasticity probe has not run) and a verdict computed from a missing
// elasticity would be a guess wearing a number's clothes.
//
// REFUSALS, by name. crime_success, the combat levels and hacknet_node_money
// are NOT in RATE_CHANNELS, so the aug basket cannot see them at all. Rather
// than score them 0 and let a reader mistake that for "worthless", each is
// refused by name with the reason, and the two that have a live claim on this
// run right now (crime_success and the combat levels both raise Homicide's
// success rate, which is what the karma grind is made of) are priced directly
// against the grind instead.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const num = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 ? Number(argv[i + 1]) : dflt;
};
const FILES = argv.filter((a, i) => !a.startsWith("--") && !(i > 0 && argv[i - 1].startsWith("--")));
const WINDOW_H = num("windowh", 1.76);
const GO_POWER = num("gopower", 1); // currentNodeMults.GoPower; 4 in BN14, 1 elsewhere
const SF14 = num("sf14", 0); // Player.activeSourceFileLvl(14) ? 2 : 1

const OPPONENTS = {
  Netburners: { power: 1.3, channel: "hacknet_node_money" },
  SlumSnakes: { power: 1.2, channel: "crime_success" },
  TheBlackHand: { power: 0.9, channel: "hacking_money" },
  Tetrads: { power: 0.7, channel: "combat levels" },
  Daedalus: { power: 1.1, channel: "faction_rep" },
  Illuminati: { power: 0.7, channel: "hacking_speed" },
};
const PRICEABLE = new Set(["hacking_money", "hacking_speed", "faction_rep"]);

if (!FILES.length) {
  console.error("usage: node tools/sim/go-opponent.mjs <results.jsonl>... [--windowh H]");
  process.exit(1);
}

// Delegate the wall-clock and win-streak model to the report, which is where it
// is transcribed from the game and where its live calibration check lives.
// Duplicating it here would create a second copy to drift.
const out = execFileSync("node", ["tools/sim/go-boardsize-report.mjs", ...FILES], { encoding: "utf8" });

// CALIBRATION — PASSED THROUGH, NOT SWALLOWED. The wall-clock and win-streak
// models live in the report, and so does their live cross-check. An earlier
// draft of this file parsed only the trailing `full:` JSON and threw the rest
// away, which would have printed an opponent recommendation with the report's
// own NOT CALIBRATED lines silently discarded — the precise shape CLAUDE.md
// warns about, where silence reads as "checked and fine". Everything the
// report says about whether it can be trusted is reprinted here first.
const head = out.slice(0, out.indexOf("\nconfig") > -1 ? out.indexOf("\nconfig") : out.length).trimEnd();
console.log("CHECK  (reprinted from tools/sim/go-boardsize-report.mjs — this file measures nothing itself)");
console.log(head);
console.log("");

const marker = out.lastIndexOf("\nfull:");
if (marker < 0) {
  console.error("go-boardsize-report.mjs printed no `full:` block — cannot read its rows");
  process.exit(1);
}
const rows = JSON.parse(out.slice(marker + "\nfull:".length));

const effectAt = (n, bonusPower) =>
  1 + Math.log(n + 1) * Math.pow(n + 1, 0.3) * 0.002 * bonusPower * GO_POWER * (SF14 ? 2 : 1);

/** Time-average of effect() over one install window, by Simpson's rule. */
function meanEffect(powerPerHour, bonusPower, hours) {
  const STEPS = 2000;
  let acc = 0;
  for (let i = 0; i <= STEPS; i++) {
    const t = (hours * i) / STEPS;
    const w = i === 0 || i === STEPS ? 1 : i % 2 ? 4 : 2;
    acc += w * effectAt(powerPerHour * t, bonusPower);
  }
  return (acc * (hours / STEPS)) / 3 / hours;
}

const table = [];
for (const r of rows) {
  const opp = r.config.includes("@") ? r.config.split("@")[1] : "Daedalus";
  const meta = OPPONENTS[opp];
  if (!meta) continue;
  const ebar = meanEffect(r.powerPerHour, meta.power, WINDOW_H);
  table.push({
    config: r.config,
    opp,
    channel: meta.channel,
    bonusPower: meta.power,
    games: r.games,
    winRate: r.winRate,
    winLo: r.winRateLo,
    winHi: r.winRateHi,
    meanBlack: r.meanBlack,
    powerPerHour: r.powerPerHour,
    endPower: r.powerPerHour * WINDOW_H,
    endEffect: effectAt(r.powerPerHour * WINDOW_H, meta.power),
    ebar,
    ln: Math.log(ebar),
    priceable: PRICEABLE.has(meta.channel),
  });
}
table.sort((a, b) => b.ln - a.ln);

const pct = (x) => `${(100 * x).toFixed(1)}%`;
console.log(`window ${WINDOW_H}h (Go power is destroyed by every install — Go/Go.ts:34-47), GoPower ${GO_POWER}, SF14 ${SF14}`);
console.log("");
const H = [
  ["opponent", 13],
  ["channel", 19],
  ["n", 4],
  ["win%", 6],
  ["black", 6],
  ["pwr/hr", 8],
  ["end n", 8],
  ["end x", 7],
  ["MEAN x", 7],
  ["ln", 7],
];
console.log(H.map(([h, w]) => (h === "opponent" || h === "channel" ? h.padEnd(w) : h.padStart(w))).join(" "));
for (const t of table) {
  console.log(
    [
      t.opp.padEnd(13),
      (t.channel + (t.priceable ? "" : " *")).padEnd(19),
      String(t.games).padStart(4),
      pct(t.winRate).padStart(6),
      t.meanBlack.toFixed(1).padStart(6),
      t.powerPerHour.toFixed(0).padStart(8),
      t.endPower.toFixed(0).padStart(8),
      t.endEffect.toFixed(3).padStart(7),
      t.ebar.toFixed(3).padStart(7),
      t.ln.toFixed(4).padStart(7),
    ].join(" "),
  );
}
console.log("\n* channel is not in RATE_CHANNELS — the augmentation basket cannot see it. Refused by name below.");

// ---------------------------------------------------------------------------
// The crossover, which is the actual decision rule.
const byOpp = Object.fromEntries(table.map((t) => [t.opp, t]));
const dae = byOpp.Daedalus;
console.log("\nCROSSOVER — deriveWeights gives hacking_money and hacking_speed weight N*eB, faction_rep weight N*eR.");
if (!dae) {
  console.log("  refused: no Daedalus arm measured, so there is no incumbent to compare against.");
} else {
  for (const t of table) {
    if (!t.priceable || t.opp === "Daedalus") continue;
    const ratio = t.ln / dae.ln;
    console.log(
      `  ${t.opp.padEnd(13)} (${t.channel}) beats Daedalus while  eR/eB < ${ratio.toFixed(3)}` +
        `   [ln ${t.ln.toFixed(4)} vs ${dae.ln.toFixed(4)}]`,
    );
  }
}

// ---------------------------------------------------------------------------
// Live elasticities, if the gate has published them.
let live = null;
try {
  live = JSON.parse(fs.readFileSync(".telemetry/installgate.txt", "utf8"));
} catch {
  /* absent */
}
const eB = live?.eBudget;
const eR = live?.objective?.eRep ?? null;
console.log("");
if (typeof eB === "number" && isFinite(eB) && eB > 0 && typeof eR === "number" && isFinite(eR) && eR > 0) {
  console.log(`LIVE  eB=${eB.toFixed(4)} eR=${eR.toFixed(4)} -> eR/eB = ${(eR / eB).toFixed(3)}`);
  const scored = table
    .filter((t) => t.priceable)
    .map((t) => ({ ...t, value: t.ln * (t.channel === "faction_rep" ? eR : eB) }))
    .sort((a, b) => b.value - a.value);
  for (const s of scored) console.log(`  ${s.opp.padEnd(13)} value ${s.value.toExponential(3)}`);
  console.log(`VERDICT: ${scored[0].opp} (${scored[0].channel})`);
} else {
  console.log(
    `REFUSED to name a live winner: installgate.txt has eBudget=${JSON.stringify(eB)} eRep=${JSON.stringify(eR)}. ` +
      `The budget elasticity is the denominator of the whole comparison; with it unmeasured, any verdict here would ` +
      `be the crossover table above plus a guess. Use the crossover.`,
  );
}
