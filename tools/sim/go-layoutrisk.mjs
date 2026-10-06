// NOT CALIBRATED: a build-order heuristic, not a loss-rate estimate.
//
// LAYOUT RISK for the opening-book build order: each layout's first-move
// root estimate (the chosen move's win rate after one model search of
// --work iterations, the opponent's live objective) — a hard deal reads low.
// The 18:03Z live Tetrads loss (layout rank 422, outside the 300-layout book)
// opened at 0.22 and is won 4/4 at 20000 work but only 2/4 at 1600.
//
//   node tools/sim/go-layoutrisk.mjs --opponent Tetrads --from 300 --to 1494 [--work 3000] [--shard i/n] --out f.jsonl
//   node tools/sim/go-layoutrisk.mjs --order f1.jsonl f2.jsonl ... --from 300 --out tools/goai/layouts-5-<Opp>-risk.json
//     (layouts --from.. reordered by p x (1 - v0): frequency times how hard the deal reads)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const LAYOUTS_FILE = path.join(REPO, "tools", "goai", "layouts-5.json");
const all = JSON.parse(fs.readFileSync(LAYOUTS_FILE, "utf8"));

if (argv.includes("--order")) {
  const v0 = new Map();
  for (const f of argv.filter((a) => a.endsWith(".jsonl")))
    for (const l of fs.readFileSync(f, "utf8").split("\n").filter(Boolean)) {
      const e = JSON.parse(l);
      v0.set(e.key, e.v0);
    }
  const from = Number(str("from", 0));
  const head = all.layouts.slice(0, from);
  const tail = all.layouts.slice(from).map((l) => ({ ...l, v0: v0.get(l.key) ?? 0.5 }));
  tail.sort((a, b) => b.p * (1 - b.v0) - a.p * (1 - a.v0));
  const out = str("out", null);
  fs.writeFileSync(out, JSON.stringify({ ...all, orderedBy: `p x (1 - v0) from ${from}`, layouts: [...head, ...tail] }) + "\n");
  console.log(`${tail.length} layouts reordered -> ${out}; first: ${tail.slice(0, 5).map((l) => `${l.key} p ${l.p} v0 ${l.v0}`).join(" | ")}`);
  process.exit(0);
}

const { regressEnv, liveConfig, gameOpponent, withSeededRandom } = await import("./go-regress.mjs");
const golib = await import(path.join(REPO, "golib.js"));
const E = await regressEnv();
const OPP = str("opponent", "Tetrads");
const oppName = gameOpponent(OPP);
const N = 5;
const komi = E.model.komiOf(oppName);
const cfg = liveConfig(E, OPP, N);
const WORK = Number(str("work", 3000));
const [SI, SN] = str("shard", "0/1").split("/").map(Number);
const OUT = str("out", null);
const list = all.layouts.slice(Number(str("from", 0)), Number(str("to", all.layouts.length)));
for (let i = SI; i < list.length; i += SN) {
  const L = list[i];
  const board = Array.from({ length: N }, (_, x) => L.key.slice(x * N, x * N + N));
  const valid = board.map((c) => [...c].map((ch) => ch === "."));
  let points = 0;
  for (const ch of L.key) if (ch !== "#") points++;
  const objective = cfg.objective ? golib.powerObjective({ streak: 8, komi, size: N, eBlack: 0.68 * points, rate: cfg.rate, turnS: 1.2, lossScale: cfg.lossScale }) : undefined;
  const v0 = await withSeededRandom(i + 1, async () => {
    const s = golib.modelSession(N, komi, { reply: (b, o) => E.model.reply(b, { ...o, opponent: oppName }) }, { seed: 1 });
    s.setRoot(board, valid, { ...(objective ? { objective } : {}) });
    await s.search({ maxms: 600000, untilWork: WORK, untilVisits: 40 * WORK });
    return s.best()?.[0]?.top?.[0]?.[4] ?? null;
  });
  fs.appendFileSync(OUT, JSON.stringify({ key: L.key, p: L.p, v0 }) + "\n");
}
process.exit(0);
