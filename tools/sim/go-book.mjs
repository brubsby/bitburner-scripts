// NOT CALIBRATED: an offline builder. Each entry is a deep search's choice,
// checked by a second independent search; whether the book helps live is
// measured separately (go-w0.mjs --book, paired).
//
// THE OPENING BOOK: deep searches of the first moves of 5x5 games, done
// offline, served by go-solver.mjs at no live search time.
//
//   node tools/sim/go-book.mjs --layouts-list [--samples 30000]        -> tools/goai/layouts-5.json
//   node tools/sim/go-book.mjs --opponent Tetrads --from 0 --to 100 [--shard i/n]
//        [--work 12000] [--depth 6] [--pmin 0.15] [--pathmin 0.03] [--samples 48]
//        --out runs/book-Tetrads-<i>.jsonl                               (resumable: done positions skipped)
//   node tools/sim/go-book.mjs --merge runs/book-Tetrads-*.jsonl --opponent Tetrads  -> tools/goai/book-Tetrads.json
//
// LAYOUTS (--layouts-list): the offline-node layout is dealt from
// WHRNG(totalPlaytime) (offlineNodes.ts:13) and live playtime is effectively
// uniform over the seed cycle, so --samples playtimes on the 200ms grid give
// the live frequency of each layout, counted up to the board's 8 symmetries
// (golib.canonicalBoard). The book covers layouts most-common first.
//
// PER LAYOUT: from the empty layout, our move is chosen by TWO independent
// model searches (golib.modelSession, the opponent's live objective, seeds 1
// and 2, --work model-calling iterations each, no clock: the AI's seed is not
// known in advance). If they agree the move is booked (conf 'agree'); if not, a
// third search at twice the work decides (conf 'tie'). A PASS is never booked.
// Then the AI's reply distribution is sampled (--samples random playtime
// seeds through the game's own getMove, tools/goai), and every reply with
// probability >= --pmin whose path probability stays >= --pathmin is followed,
// to --depth of our moves. Positions are deduplicated up to symmetry.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const LAYOUTS_FILE = path.join(REPO, "tools", "goai", "layouts-5.json");

if (argv.includes("--layouts-list")) {
  await import("./env.mjs");
  const g = await import("./game.bundle.mjs");
  const S = num("samples", 30000);
  const counts = new Map();
  for (let i = 0; i < S; i++) {
    g.Player.totalPlaytime = 200 * Math.floor(Math.random() * 1.5e8) + 1e9;
    const st = g.getNewBoardState(5, g.GoOpponent.Netburners, true);
    const { key } = golib.canonicalBoard(g.simpleBoardFromBoard(st.board));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const list = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, n]) => ({ key, p: +(n / S).toFixed(6) }));
  fs.writeFileSync(LAYOUTS_FILE, JSON.stringify({ size: 5, samples: S, layouts: list }) + "\n");
  console.log(`${list.length} layouts from ${S} samples -> ${LAYOUTS_FILE}`);
  process.exit(0);
}

if (argv.includes("--merge")) {
  const opp = str("opponent", null);
  const files = argv.filter((a) => a.endsWith(".jsonl"));
  const entries = {};
  let n = 0, layouts = new Set();
  for (const f of files)
    for (const l of fs.readFileSync(f, "utf8").split("\n")) {
      if (!l.trim()) continue;
      const e = JSON.parse(l);
      if (e.kind !== "entry" || e.opponent !== opp) continue;
      entries[e.key] = [e.x, e.y, e.wr, e.conf === "agree" ? 1 : 0];
      layouts.add(e.layout);
      n++;
    }
  const out = path.join(REPO, "tools", "goai", `book-${opp}.json`);
  fs.writeFileSync(out, JSON.stringify({ opponent: opp, size: 5, built: new Date().toISOString(), layouts: layouts.size, entries }) + "\n");
  console.log(`${Object.keys(entries).length} positions (${n} lines) over ${layouts.size} layouts -> ${out}`);
  process.exit(0);
}

const { regressEnv, liveConfig, withSeededRandom, gameOpponent } = await import("./go-regress.mjs");
const E = await regressEnv();
const { model, m } = E;
const OPP = str("opponent", "Tetrads");
const oppName = gameOpponent(OPP);
const opp = model.opponentOf(oppName);
const N = 5;
const komi = model.komiOf(oppName);
const cfg = liveConfig(E, OPP, N);
const WORK = num("work", 12000);
const DEPTH = num("depth", 6);
const PMIN = num("pmin", 0.15);
const PATHMIN = num("pathmin", 0.03);
const SAMPLES = num("samples", 48);
const OUT = str("out", null);
if (!OUT) throw new Error("--out required");
const [SI, SN] = str("shard", "0/1").split("/").map(Number);
const layouts = JSON.parse(fs.readFileSync(LAYOUTS_FILE, "utf8")).layouts.slice(num("from", 0), num("to", 100));
const done = new Set();
if (fs.existsSync(OUT))
  for (const l of fs.readFileSync(OUT, "utf8").split("\n")) {
    if (!l.trim()) continue;
    const e = JSON.parse(l);
    if (e.kind === "entry" || e.kind === "nobook") done.add(e.key);
    if (e.kind === "layout-done") done.add("L:" + e.layout);
  }
const emit = (o) => fs.appendFileSync(OUT, JSON.stringify(o) + "\n");
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));

function stateOf(simple, history, last = m.GoColor.white) {
  const st = m.getNewBoardStateFromSimpleBoard(simple, undefined, opp, last);
  st.previousBoards = history.slice();
  st.passCount = 0;
  return st;
}
function validOf(st) {
  const g = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of m.getAllValidMoves(st, m.GoColor.black)) g[p.x][p.y] = true;
  return g;
}
async function search(simple, history, seed, work) {
  let points = 0;
  for (const col of simple) for (const c of col) if (c !== "#") points++;
  const objective = cfg.objective ? golib.powerObjective({ streak: 8, komi, size: N, eBlack: 0.68 * points, rate: cfg.rate, turnS: 1.2, lossScale: cfg.lossScale }) : undefined;
  return withSeededRandom(seed * 7717 + 3, async () => {
    const sess = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: oppName }) }, { seed });
    const r = sess.setRoot(simple, validOf(stateOf(simple, history)), { history, ...(objective ? { objective } : {}) });
    if (!r) return null;
    await sess.search({ maxms: 600000, untilWork: work, untilVisits: 40 * work });
    const b = sess.best();
    if (!b || !b.length) return { pass: true, top: [] };
    return { x: b[0].x, y: b[0].y, wr: b[0].top?.[0]?.[4] ?? null, top: b[0].top };
  });
}

async function expand(simple, history, depth, pathP, layoutKey) {
  if (depth >= DEPTH) return;
  const { key, t } = golib.canonicalBoard(simple);
  if (done.has(key)) return;
  done.add(key);
  const t0 = Date.now();
  const a = await search(simple, history, 1, WORK);
  const b = await search(simple, history, 2, WORK);
  let mv = a, conf = "agree";
  if (!a || !b || a.pass || b.pass || a.x !== b.x || a.y !== b.y) {
    mv = await search(simple, history, 3, 2 * WORK);
    conf = "tie";
  }
  if (!mv || mv.pass) {
    emit({ kind: "nobook", opponent: OPP, key, layout: layoutKey, depth, why: mv ? "pass" : "no stone" });
    return;
  }
  const [kx, ky] = golib.toKeyFrame(N, t, mv.x, mv.y);
  emit({ kind: "entry", opponent: OPP, key, x: kx, y: ky, wr: mv.wr, conf, layout: layoutKey, depth, p: +pathP.toFixed(4), work: WORK, a: a && !a.pass ? [a.x, a.y, a.wr] : null, b: b && !b.pass ? [b.x, b.y, b.wr] : null, ms: Date.now() - t0 });
  // Our move, then the AI's reply distribution over random playtime seeds.
  const st = stateOf(simple, history);
  if (!m.makeMove(st, mv.x, mv.y, m.GoColor.black)) return;
  const after = m.simpleBoardFromBoard(st.board);
  const hist2 = [simple.join(""), ...history];
  const counts = new Map();
  await withSeededRandom(depth * 131 + 7, async () => {
    for (let i = 0; i < SAMPLES; i++) {
      const r = await model.reply(after, { opponent: oppName, history: hist2, passCount: 0, rng: 200 * (1 + Math.floor(Math.random() * 1.5e8)) });
      const k = r ? `${r.x},${r.y}` : "P";
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  });
  if (process.env.BOOK_DEBUG) console.error(depth, JSON.stringify([...counts]))
  for (const [k, c] of [...counts.entries()].sort((x, y) => y[1] - x[1])) {
    const p = c / SAMPLES;
    if (k === "P" || p < PMIN || pathP * p < PATHMIN) continue;
    const st2 = stateOf(after, hist2, m.GoColor.black);
    const [rx, ry] = k.split(",").map(Number);
    if (!m.makeMove(st2, rx, ry, m.GoColor.white)) continue;
    await expand(m.simpleBoardFromBoard(st2.board), [after.join(""), ...hist2], depth + 1, pathP * p, layoutKey);
  }
}

let li = 0;
for (const L of layouts) {
  if (li++ % SN !== SI) continue;
  if (done.has("L:" + L.key)) continue;
  const t0 = Date.now();
  await expand(toSimple(L.key), [], 0, 1, L.key);
  emit({ kind: "layout-done", opponent: OPP, layout: L.key, p: L.p, s: Math.round((Date.now() - t0) / 1000) });
  console.log(`${new Date().toISOString()} layout ${L.key} (p ${L.p}) ${Math.round((Date.now() - t0) / 1000)}s`);
}
process.exit(0);
