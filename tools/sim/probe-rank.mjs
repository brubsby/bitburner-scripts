// How often does auto.js's target change as the hacking level rises?
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
