// NOT CALIBRATED: an offline filter; its effect is measured with go-w0.mjs
// --oracle-file (paired, losses traced).
//
// THE SAFETY FILTER for pass-forcing candidates (go-oracle-book.mjs output).
// A candidate is a step of a line planned against ONE predicted sequence of
// the AI's replies; when a later reply comes out differently the game leaves
// the line, and a thin line can leave it lost (go-w0 2026-10-06: 3 losses in
// 193 games with the raw candidates, 0 in ~200 without). Each position the
// file holds is searched here against the AI's WHOLE reply distribution (the
// model session, free seeds, --work model-calling iterations, the live power
// objective at the streak plateau), and a candidate is kept only if the search
// gave it a fair share of its visits (>= --minshare of the best stone's) and
// wins its lines within --drop of the best stone (share of lines won).
//
//   node tools/sim/go-oracle-safety.mjs IN.json OUT.json [--opponent Tetrads] [--work 3000] [--drop 0.1] [--minshare 0.15] [--shard i/n]
//   (with --shard, OUT gets .i suffixed; --merge OUT.json IN.0 IN.1 ... joins them)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
if (argv[0] === "--merge") {
  const [out, ...ins] = argv.slice(1);
  const parts = ins.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const merged = { ...parts[0], oracle: {}, oraclePass: {}, safety: { kept: 0, dropped: 0 } };
  for (const p of parts) {
    Object.assign(merged.oracle, p.oracle);
    Object.assign(merged.oraclePass, p.oraclePass);
    merged.safety.kept += p.safety.kept;
    merged.safety.dropped += p.safety.dropped;
  }
  fs.writeFileSync(out, JSON.stringify(merged) + "\n");
  console.log(`merged ${ins.length} shards: kept ${merged.safety.kept}, dropped ${merged.safety.dropped} -> ${out}`);
  process.exit(0);
}
let ms = 4242;
Math.random = () => ((ms = (ms * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
const model = await loadModel({ quiet: false });
if (!model) throw new Error("tools/goai model unavailable");
const [IN, OUT0] = argv.filter((a) => !a.startsWith("--") && a.endsWith(".json"));
const OPP = str("opponent", "Tetrads");
const WORK = num("work", 3000), DROP = num("drop", 0.1), MINSHARE = num("minshare", 0.15);
const [SI, SN] = str("shard", "0/1").split("/").map(Number);
const OUT = SN > 1 ? `${OUT0}.${SI}` : OUT0;
const src = JSON.parse(fs.readFileSync(IN, "utf8"));
const N = src.size ?? 5;
const komi = model.komiOf(OPP);
const { POWER_PER_HOUR } = await import(pathToFileURL(path.join(REPO, "goplan.js")).href);
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const out = { opponent: OPP, size: N, built: new Date().toISOString(), from: path.basename(IN), safety: { work: WORK, drop: DROP, minshare: MINSHARE, kept: 0, dropped: 0 }, oracle: {}, oraclePass: {} };
let i = 0;
for (const [tbl, passed] of [["oracle", false], ["oraclePass", true]]) {
  for (const [key, cands] of Object.entries(src[tbl] ?? {})) {
    if (i++ % SN !== SI) continue;
    const simple = toSimple(key);
    const valid = Array.from({ length: N }, () => new Array(N).fill(false));
    for (const [x, y] of model.validMoves(simple, [])) valid[x][y] = true;
    let points = 0;
    for (const c of key) if (c !== "#") points++;
    const objective = golib.powerObjective({ streak: 8, komi, size: N, eBlack: 0.85 * points, rate: (POWER_PER_HOUR[OPP] ?? 0) / 3600, turnS: 1.06 });
    const sess = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: OPP }) }, { seed: 7 + i });
    const r = sess.setRoot(simple, valid, { history: [], opponentPassed: passed, objective });
    if (!r) { out.safety.dropped += cands.length; continue; }
    await sess.search({ maxms: 600000, untilWork: WORK, untilVisits: 40 * WORK });
    const st = sess.rootStats().filter((c) => c.x >= 0);
    const best = st.reduce((b, c) => (!b || c.visits > b.visits ? c : b), null);
    const keep = [];
    for (const c of cands) {
      const s = st.find((e) => e.x === c[0] && e.y === c[1]);
      const ok = best && s && s.visits >= MINSHARE * best.visits && s.wins >= best.wins - DROP;
      if (ok) keep.push([...c.slice(0, 5), +s.wins.toFixed(3)]);
      out.safety[ok ? "kept" : "dropped"]++;
    }
    if (keep.length) out[tbl][key] = keep;
  }
}
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`shard ${SI}/${SN}: kept ${out.safety.kept}, dropped ${out.safety.dropped} -> ${OUT}`);
process.exit(0);
