// How often does auto.js's target change as the hacking level rises?
//
// NOT CALIBRATED. Exploratory: it sweeps the ranking index over levels on a
// stored snapshot and prints where the top target changes. There is no live
// measurement of "the ranking at level 217" to assert against, and the snapshot
// it reads may be many levels stale. Use it to see the SHAPE of the retargeting
// schedule; do not quote a level from it without re-checking against the game.
import { loadSnapshot } from "./world.mjs";
import { Sim } from "./engine.mjs";
import { INDEX } from "./strategies.mjs";
const world = loadSnapshot();
const sim = new Sim(world, { seed: 1 });
let prev = null;
for (let lvl = 150; lvl <= 300; lvl++) {
  sim.player.skills.hacking = lvl;
  const ranked = [...sim.targets()].filter(t=>t.moneyMax>0)
    .map((t) => ({ n: t.hostname, s: INDEX.batchChance(t, sim) }))
    .sort((a, b) => b.s - a.s);
  const top = ranked[0];
  if (!prev || prev !== top.n) {
    console.log(`lvl ${lvl}: -> ${top.n}   (2nd ${ranked[1]?.n} at ${(100*ranked[1]?.s/top.s).toFixed(1)}% of top)`);
    prev = top.n;
  }
}
