// NOT CALIBRATED (a diagnostic): where was a lost game lost? For each of our
// plies in a corpus case (tools/test/fixture-go-losses.json, or a fresh
// go-games.txt / harness record via go-fixture.mjs --dry), replay the logged
// line to that ply and let the solver play on at each work budget
// (go-regress.mjs playCheck). The last ply from which the solver wins at a
// budget is where that budget's play went wrong; a ply won only at a large
// budget is a search-strength loss, one lost even at the largest is lost earlier.
//
//   node tools/sim/go-whylost.mjs <case id substring> [--work 1600,8000] [--seeds 1,2]

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { playCheck } from "./go-regress.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FIX = str("fixture", path.join(HERE, "..", "test", "fixture-go-losses.json"));
const WORKS = str("work", "1600,8000").split(",").map(Number);
const SEEDS = str("seeds", "1").split(",").map(Number);
const want = argv.find((a) => !a.startsWith("--") && !/^[\d,]+$/.test(a)) ?? "";
const cases = JSON.parse(fs.readFileSync(FIX, "utf8")).cases.filter((c) => c.id.includes(want));
for (const fx of cases) {
  console.log(`${fx.id} (${fx.moves.length} plies, live ${fx.live?.black}-${fx.live?.white})`);
  for (let from = 0; from < fx.moves.length; from++) {
    const cells = [];
    for (const w of WORKS) {
      let won = 0;
      for (const s of SEEDS) if ((await playCheck(fx, { from, work: w, seed: s })).won) won++;
      cells.push(`w${w}: ${won}/${SEEDS.length}`);
    }
    console.log(`  from ply ${String(from).padStart(2)} (live ${fx.moves[from].m}/${fx.moves[from].r}) ${cells.join("  ")}`);
  }
}
process.exit(0);
