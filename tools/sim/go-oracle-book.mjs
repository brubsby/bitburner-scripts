// NOT CALIBRATED: an offline builder; whether its book helps is measured with
// go-w0.mjs --book (paired).
//
// THE PASS-FORCING BOOK: turns go-oracle.mjs lines (the shortest-to-the-AI's-
// pass winning games found against the deterministic AI) into opening-book
// entries, merged over an existing book (oracle entries win a conflict).
//
//   node tools/sim/go-oracle-book.mjs --base tools/goai/book-Tetrads.json --out book.json orc-*.out [--opponent Tetrads] [--seeds 32] [--pmin 0]
//
// Each line is REPLAYED against the same deterministic AI the oracle used
// (the replay must reproduce every reply or the line is cut where it stops);
// every position on it where we move becomes an entry. Positions after the
// AI's pass (the play-on stones) go in `passEntries` (golib.bookMove with
// { passed: true }). Each entry also carries how often the AI, over --seeds
// random seeds, gives the reply the line expects next (p) — the line holds
// live only where the AI's reply does not depend on its seed; entries whose
// path probability falls under --pmin are not written.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
let ms = 12345;
Math.random = () => ((ms = (ms * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
const model = await loadModel({ quiet: false });
if (!model) throw new Error("tools/goai model unavailable");
const OPP = str("opponent", "Tetrads");
const SEEDS = num("seeds", 32);
const PMIN = num("pmin", 0);
const OUT = str("out", null);
if (!OUT) throw new Error("--out required");
const base = str("base", null) ? JSON.parse(fs.readFileSync(str("base", null), "utf8")) : { opponent: OPP, size: 5, entries: {} };
const files = argv.filter((a) => a.endsWith(".out") || a.endsWith(".jsonl"));
const N = 5;
const nbrs = golib.makeGeometry(N);
const scratch = golib.makeScratch(N);
const CH = [".", "X", "O", "#"];
const toStr = (b) => { let s = ""; for (let i = 0; i < N * N; i++) s += CH[b[i]]; return s; };
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const seedOf = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return 1 + ((h >>> 0) % 29999999); };
const entries = { ...base.entries };
// CLOCK LINES (go-oracle --phases): each step carries the reply the AI gave at
// that game's clock. They become CANDIDATES — oracle[key] / oraclePass[key] =
// [[x, y, rx, ry (-1, -1: pass), value]...] (key frame), value = the line's
// black minus LAMBDA x the AI replies still to come. Live, a candidate is
// playable only when the AI's reply predicted from the clock is the one it
// expects (golib.oracleCandidates; go-w0 --oracle-book).
const oracle = { ...(base.oracle ?? {}) };
const oraclePass = { ...(base.oraclePass ?? {}) };
let clockLines = 0, cands = 0;
function addClockLine(rec, best) {
  clockLines++;
  const lam = rec.lambda ?? 2.5;
  let s = rec.layout, passed = !!rec.rootPassed;
  const steps = best.line.filter((m) => m !== "P");
  for (let i = 0; i < steps.length; i++) {
    const [mv, rp] = steps[i].split(">");
    const [x, y] = mv.split(",").map(Number);
    const { key, t } = golib.canonicalBoard(s);
    const [kx, ky] = golib.toKeyFrame(N, t, x, y);
    const r = rp === "P" ? null : rp.split(",").map(Number);
    const [rx, ry] = r ? golib.toKeyFrame(N, t, r[0], r[1]) : [-1, -1];
    const v = +(best.black - lam * (steps.length - i)).toFixed(2);
    const tbl = passed ? oraclePass : oracle;
    const list = (tbl[key] ??= []);
    const same = list.find((c) => c[0] === kx && c[1] === ky && c[2] === rx && c[3] === ry);
    if (same) same[4] = Math.max(same[4], v);
    else { list.push([kx, ky, rx, ry, v]); cands++; }
    const b = golib.parseBoard(toSimple(s));
    if (golib.play(b, nbrs, x * N + y, golib.US, scratch) < 0) throw new Error(`clock line does not replay at ${steps[i]}`);
    if (r) golib.play(b, nbrs, r[0] * N + r[1], golib.THEM, scratch);
    s = toStr(b);
    passed = !r;
  }
}
const passEntries = { ...(base.passEntries ?? {}) };
let lines = 0, written = 0, cut = 0, overrode = 0;
const pAt = [];
for (const f of files)
  for (const l of fs.readFileSync(f, "utf8").split("\n")) {
    if (!l.startsWith("{")) continue;
    const rec = JSON.parse(l);
    const best = rec.bestV ?? rec.best;
    if (!best) continue;
    lines++;
    if (best.line.some((m) => m.includes(">"))) {
      addClockLine(rec, best);
      continue;
    }
    let s = rec.layout, hist = [], passed = false, pathP = 1;
    for (const mv of best.line) {
      if (mv === "P") break;
      const aiPassed = mv.endsWith("p");
      const [x, y] = mv.replace("p", "").split(",").map(Number);
      // The entry: this position, our move.
      const { key, t } = golib.canonicalBoard(s);
      const [kx, ky] = golib.toKeyFrame(N, t, x, y);
      const tbl = passed ? passEntries : entries;
      const b = golib.parseBoard(toSimple(s));
      if (golib.play(b, nbrs, x * N + y, golib.US, scratch) < 0) { cut++; break; }
      const s2 = toStr(b);
      const hist2 = [s, ...hist];
      const r = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: seedOf(s2) });
      if (!!r === aiPassed) { cut++; break; } // the replay does not reproduce the line
      // The entry: this position, our move, and the reply the line expects (key frame).
      if (pathP >= PMIN) {
        if (tbl[key] && (tbl[key][0] !== kx || tbl[key][1] !== ky)) overrode++;
        tbl[key] = [kx, ky, 1, 2, +pathP.toFixed(3), r ? golib.toKeyFrame(N, t, r.x, r.y) : -1];
        written++;
      }
      // How often the AI gives this reply over random seeds.
      let same = 0;
      for (let k = 0; k < SEEDS; k++) {
        const q = await model.reply(toSimple(s2), { opponent: OPP, history: hist2, passCount: 0, rng: 1 + Math.floor(Math.random() * 3e7) });
        if ((q ? `${q.x},${q.y}` : "P") === (r ? `${r.x},${r.y}` : "P")) same++;
      }
      pathP *= same / SEEDS;
      pAt.push(same / SEEDS);
      let s3 = s2, hist3 = hist2;
      if (r) {
        const b3 = b.slice();
        if (golib.play(b3, nbrs, r.x * N + r.y, golib.THEM, scratch) >= 0) { s3 = toStr(b3); hist3 = [s2, ...hist2]; }
      }
      s = s3; hist = hist3; passed = !r;
    }
    if (argv.includes("--verbose")) console.log(rec.layout, best.line.join(" "), "path p", pathP.toFixed(3), pAt.slice(-best.line.length + 1).map((v) => v.toFixed(2)).join(" "));
  }
// --base given: a merged book (entries + candidates); else the candidates alone
// (tools/goai/oracle-<Opponent>.json, which go-solver reads beside the book).
const src = { lines, clockLines, files: files.map((f) => path.basename(f)) };
fs.writeFileSync(OUT, JSON.stringify(str("base", null) ? { ...base, built: new Date().toISOString(), oracleSrc: src, entries, passEntries, oracle, oraclePass } : { opponent: OPP, size: N, built: new Date().toISOString(), oracleSrc: src, oracle, oraclePass }) + "\n");
console.log(`${clockLines} clock lines -> ${cands} candidates at ${Object.keys(oracle).length} positions + ${Object.keys(oraclePass).length} after-pass`);
const mp = pAt.reduce((a, b) => a + b, 0) / Math.max(1, pAt.length);
console.log(`${lines} oracle lines -> ${written} entries (${overrode} overrode the base book, ${cut} lines cut at a non-reproducing reply); mean P(AI's reply as the line expects) ${mp.toFixed(3)}; ${Object.keys(entries).length} positions + ${Object.keys(passEntries).length} after-pass -> ${OUT}`);
process.exit(0);
