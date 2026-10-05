// Which opponent the live go.js picks at a fresh BN14.2 life on the EARLY
// weights (goplan.earlyGoWeights), with and without the measured cheat rates.
//
//   node tools/sim/go-cheatpick.mjs [Opp=powerPerHour ...]
//
// Each Opp=pph replaces that opponent's 5x5 power/h (the cheat arm's harness
// rate) in chooseOpponent's table. Every opponent at n = 0, streak 0, BN14's
// GoPower, SF14.1 (BN14.2). Scenarios: no Bladeburner division (the hacking
// worker only), the Bladeburner route presumed before the join, after the
// join, and faction work.
import "../test/gameresolve.mjs";

const GP = await import("goplan.js");
const BN = await import("bitNodeMultipliers.js");
const n14 = BN.bitNodeMults(14);
const over = Object.fromEntries(process.argv.slice(2).map((a) => a.split("=")).map(([k, v]) => [k, Number(v)]));
const table = { ...GP.POWER_PER_HOUR, ...over };
const pick = (weights, powerPerHour) =>
  GP.chooseOpponent({
    weights,
    windowH: GP.EARLY.windowH,
    incumbent: "Daedalus",
    nodePower: Object.fromEntries(Object.keys(GP.OPPONENTS).map((k) => [k, 0])),
    dwellH: 5 / 60,
    dwellGames: 5,
    streaks: Object.fromEntries(Object.keys(GP.OPPONENTS).map((k) => [k, 0])),
    boardSize: 5,
    goPower: n14.GoPower,
    sf14: 1,
    powerPerHour,
  });
const scen = {
  "hack only (no division)": { hackIncome: 50 },
  "Bladeburner presumed, before the join": { hackIncome: 50, blade: { open: true, route: null, joined: false }, nodeMults: n14 },
  "Bladeburner joined": { hackIncome: 50, blade: { open: true, route: "blade", joined: true }, nodeMults: n14 },
  "faction work": { hackIncome: 50, work: "faction" },
};
for (const [name, inp] of Object.entries(scen)) {
  const w = GP.earlyGoWeights(inp).weights;
  const a = pick(w, GP.POWER_PER_HOUR);
  const b = pick(w, table);
  console.log(`${name}: release 3 -> ${a.opponent}; with cheat rates -> ${b.opponent}`);
}
