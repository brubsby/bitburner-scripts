// CALIBRATION: this IS the check — golib.cheatRoll against the game's own WHRNG.
// golib.cheatRoll is the game's own WHRNG first draw, bit for bit, and
// cheatWaitS lands inside the window. Run: node tools/sim/go-cheatroll-check.mjs
//
// The reference is the game's class itself, out of the bundle
// (src/Casino/RNG.ts:40-63), not a re-typed copy of it.
import "./env.mjs";
const g = await import("./game.bundle.mjs");
const m = await import("../../golib.js");
if (!g.WHRNG) throw new Error("game.bundle.mjs does not export WHRNG — add it to build.mjs ENTRY and rebuild");

let bad = 0;
const N = 200000;
for (let i = 0; i < N; i++) {
  const T = Math.random() < 0.5 ? Math.floor(Math.random() * 5e7) * 200 : Math.random() * 1e10;
  if (new g.WHRNG(T).random() !== m.cheatRoll(T)) bad++;
}
console.log(`cheatRoll vs game WHRNG: ${bad} mismatches in ${N}`);

// Waiting cheatWaitS (rounded up to the next 200ms engine tick) must land in
// the window r <= p, or on the tick after it at worst.
let miss = 0;
for (let i = 0; i < N; i++) {
  const T = Math.floor(Math.random() * 5e7) * 200;
  const p = 0.004 + Math.random() * 0.6;
  const w = m.cheatWaitS(T, p);
  const T2 = T + Math.ceil((w * 1000) / 200) * 200;
  if (new g.WHRNG(T2).random() > p && new g.WHRNG(T2 + 200).random() > p) miss++;
}
console.log(`cheatWaitS window misses: ${miss} in ${N}`);
console.log(`cheatChance(k) k=0..10 @crime 1: ${[...Array(11).keys()].map((k) => m.cheatChance(k).toFixed(4)).join(" ")}`);
process.exit(bad || miss ? 1 : 0);
