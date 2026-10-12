// NOT CALIBRATED as a live win-rate model: every rate here is the replay
// harness's (go-regress playCheck: the game's own AI on the clock seed, the
// live cheat policy and nets, a fixed work budget per move). Whether the book
// it writes helps live is measured separately (go-w0 --book-b, paired).
//
// THE HARD-LAYOUT BOOK: opening-book entries for the start positions the
// live search opens badly on — off-book deals (layout + Illuminati's handicap
// router) where the first move's search reads low and picks a losing opening
// (the 2026-10-11 14:46Z and 2026-10-12 04:17Z / 04:24Z Illuminati losses:
// 2,2 at 0.08-0.14 while 0,1 / 1,3 / 0,4 won). A bigger first-move budget was
// measured -7.9% power/h (8159ff3), so the fix is offline: a move chosen by
// PLAYING each candidate out against the game's AI, served at no live cost.
//
//   1. --starts --out starts.json
//        every start position: layouts-5.json (live layout frequencies) x the
//        handicap stone's exact placement distribution (boardState.ts
//        applyHandicap: the centre with p 0.2 when online, else uniform over
//        getExpansionMoveArray), canonical up to the 8 symmetries; each marked
//        on-book when book-<Opp>.json already holds it.
//   2. --scan --starts-file starts.json [--pmin 1e-5] [--work 1360] --shard i/n --out scan-i.jsonl
//        per off-book start: the live first-move search (nets, objective, work
//        = the live budget) — its pick and win rate v0.
//   3. --verify --scan-files 'scan-*.jsonl' --vmax 0.3 --top N [--extra s1,s2] --shard i/n --out ver-i.jsonl
//        per hard start (v0 < vmax, highest p first): candidates = the top
//        moves of two deep searches (--deep work) + the live pick; each is
//        played out --seeds times from ply 1 (our first move forced, then the
//        live solver + cheat policy, the AI on a clock seed per game), and the
//        live pick is the baseline, played on the same seeds. A start whose
//        live pick wins all --screen games first is booked with it unverified
//        further (screened: the live line, at no search time). One record per
//        start: every candidate's wins.
//   4. --merge --base tools/goai/book-<Opp>.json ver-*.jsonl --out book.json [--margin 1]
//        a start is booked with its best-measured candidate when that beats the
//        live baseline by >= --margin wins of --seeds; entry [x, y, wr, 1]
//        (wr: the deep search's own reading of the move, the semantics every
//        book entry's wr has — go-solver pre-sends it as the single's wr),
//        provenance in book.hard[key] = [won, of, liveWon, liveOf] for each
//        fully verified start: the booked move's playouts won of played, the
//        live pick's on the same seeds (screened starts: counted in hardSrc).
//
// The case each playout replays is a synthetic corpus case (go-regress
// playCheck): the start, our forced first move, its AI reply on the clock,
// the cheat inputs of the BN13.1 losses (crime 1.7643, SF14.3), the nets.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const num = (n, d) => Number(str(n, d));
const OPP = str("opponent", "Illuminati");
const N = 5;
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const [SI, SN] = str("shard", "0/1").split("/").map(Number);
const OUT = str("out", null);
const emit = (o) => fs.appendFileSync(OUT, JSON.stringify(o) + "\n");
const readJsonl = (files) => files.flatMap((f) => fs.readFileSync(f, "utf8").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l)));
const listFiles = (glob) => {
  const dir = path.dirname(glob), re = new RegExp("^" + path.basename(glob).replace(/[.]/g, "\\.").replace(/\*/g, ".*") + "$");
  return fs.readdirSync(dir).filter((f) => re.test(f)).map((f) => path.join(dir, f));
};

if (argv.includes("--merge")) {
  const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
  const baseFile = str("base", path.join(REPO, "tools", "goai", `book-${OPP}.json`));
  const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, "utf8")) : { opponent: OPP, size: N, entries: {} };
  const MARGIN = num("margin", 1);
  const recs = readJsonl(argv.filter((a) => a.endsWith(".jsonl"))).filter((r) => r.kind === "verify" && r.opponent === OPP);
  const entries = { ...base.entries };
  const hard = { ...(base.hard ?? {}) };
  let booked = 0, kept = 0, pBooked = 0, gain = 0, screened = 0;
  for (const r of recs) {
    // The best candidate among those played to the full seed count; a move
    // other than the live pick must beat the live pick's line by --margin wins.
    const cands = r.cands.filter((c) => !c.m.startsWith("-"));
    const full = Math.max(...cands.map((c) => c.n));
    const best = cands.filter((c) => c.n === full).sort((a, b) => b.won - a.won || b.margin - a.margin)[0];
    const live = cands.find((c) => c.m === r.livePick);
    const need = !live ? 0 : best.m === live.m ? 0 : MARGIN;
    if (!best || (live && best.won - live.won < need)) { kept++; continue; }
    const { key, t } = golib.canonicalBoard(r.start);
    const [x, y] = best.m.split(",").map(Number);
    const [kx, ky] = golib.toKeyFrame(N, t, x, y);
    entries[key] = [kx, ky, +(best.deep ?? 0).toFixed(3), 1];
    // Provenance for the fully verified starts only; a screened one is its
    // live pick at --screen of --screen won (counted in hardSrc).
    if (r.screened) screened++;
    else hard[key] = [best.won, best.n, live ? live.won : -1, live ? live.n : 0];
    booked++;
    pBooked += r.p;
    if (live) gain += r.p * (best.won / best.n - live.won / live.n);
  }
  const out = { ...base, built: new Date().toISOString(), entries, hard, hardSrc: { tool: "tools/sim/go-hardbook.mjs", margin: MARGIN, starts: recs.length, booked, screened, pBooked: +pBooked.toFixed(4) } };
  fs.writeFileSync(str("out", null), JSON.stringify(out) + "\n");
  console.log(`${recs.length} verified starts: ${booked} booked (p ${pBooked.toFixed(4)} of games; expected win-rate gain ${(100 * gain).toFixed(3)} points of all games), ${kept} kept off-book (no candidate beat the live line by ${MARGIN})`);
  process.exit(0);
}

if (argv.includes("--deals")) {
  // --deals --book NEW --base OLD --seed S --games G: the go-w0 --layoutseed S
  // game indices whose start NEW holds and OLD does not (go-w0 --layouts).
  await import("./env.mjs");
  const g = await import("./game.bundle.mjs");
  const { dealPaired } = await import("./go-board.mjs");
  const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
  const nb = JSON.parse(fs.readFileSync(str("book", null), "utf8")), ob = fs.existsSync(str("base", "")) ? JSON.parse(fs.readFileSync(str("base", null), "utf8")) : { entries: {} };
  const out = [];
  for (let i = 0; i < num("games", 300); i++) {
    const b = g.simpleBoardFromBoard(dealPaired(g, N, g.GoOpponent[OPP], num("seed", 1), i).board);
    if (golib.bookMove(nb, b) && !golib.bookMove(ob, b)) out.push(i);
  }
  console.log(out.join(","));
  process.exit(0);
}

const { regressEnv, liveConfig, withSeededRandom, gameOpponent, solverNn, playCheck } = await import("./go-regress.mjs");
const E = await regressEnv();
const { golib, model, m } = E;
const oppName = gameOpponent(OPP);
const opp = model.opponentOf(oppName);
const komi = model.komiOf(oppName);
const cfg = liveConfig(E, OPP, N);

if (argv.includes("--starts")) {
  const layouts = JSON.parse(fs.readFileSync(path.join(REPO, "tools", "goai", "layouts-5.json"), "utf8")).layouts;
  // No book yet for this opponent (Daedalus): every start is off-book.
  const bookFile = str("book", path.join(REPO, "tools", "goai", `book-${OPP}.json`));
  const book = fs.existsSync(bookFile) ? JSON.parse(fs.readFileSync(bookFile, "utf8")) : { entries: {} };
  if (!fs.existsSync(bookFile)) console.log(`no book at ${bookFile}: every start is off-book`);
  const h = m.getHandicap(N, opp);
  const M = 2000;
  const place = (key, seq) => {
    let i = 0;
    const real = Math.random;
    Math.random = () => (i < seq.length ? seq[i++] : 0.5);
    try {
      const st = m.getNewBoardStateFromSimpleBoard(toSimple(key), undefined, m.GoOpponent.Netburners, m.GoColor.white);
      m.applyHandicap(st.board, h);
      return m.simpleBoardFromBoard(st.board).join("");
    } finally {
      Math.random = real;
    }
  };
  const starts = [];
  let onP = 0;
  for (const [rank, L] of layouts.entries()) {
    const dist = new Map();
    const add = (s, p) => dist.set(s, (dist.get(s) ?? 0) + p);
    if (!h) add(L.key, 1);
    else {
      const centre = L.key[2 * N + 2] === ".";
      if (centre) add(place(L.key, [0.1]), 0.2);
      for (let j = 0; j < M; j++) add(place(L.key, centre ? [0.5, (j + 0.5) / M] : [(j + 0.5) / M]), (centre ? 0.8 : 1) / M);
    }
    for (const [s, ph] of dist) {
      const { key } = golib.canonicalBoard(s);
      const on = !!golib.bookMove(book, toSimple(s));
      const p = L.p * ph;
      if (on) onP += p;
      starts.push({ start: s, key, layout: L.key, rank, p: +p.toPrecision(4), on });
    }
  }
  // Canonical duplicates (a handicap stone that maps one layout's start onto another's) merge.
  const byKey = new Map();
  for (const s of starts) {
    const o = byKey.get(s.key);
    if (o) o.p = +(o.p + s.p).toPrecision(4);
    else byKey.set(s.key, s);
  }
  const list = [...byKey.values()].sort((a, b) => b.p - a.p);
  fs.writeFileSync(OUT, JSON.stringify({ opponent: OPP, size: N, starts: list }) + "\n");
  console.log(`${list.length} starts over ${layouts.length} layouts; on-book mass ${onP.toFixed(4)}; off-book ${list.filter((s) => !s.on).length} starts`);
  process.exit(0);
}

function validOf(simple, history = []) {
  const st = m.getNewBoardStateFromSimpleBoard(simple, undefined, opp, m.GoColor.white);
  st.previousBoards = history.slice();
  const g = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of m.getAllValidMoves(st, m.GoColor.black)) g[p.x][p.y] = true;
  return g;
}
const STREAK = num("streak", 30);
async function rootSearch(start, seed, work) {
  const simple = toSimple(start);
  let points = 0;
  for (const c of start) if (c !== "#") points++;
  const objective = cfg.objective ? golib.powerObjective({ streak: STREAK, komi, size: N, eBlack: 0.68 * points, rate: cfg.rate, turnS: 1.2, lossScale: cfg.lossScale }) : undefined;
  const nn = await solverNn(OPP, N);
  return withSeededRandom(seed * 7919 + 17, async () => {
    const sess = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: oppName }) }, { seed, ...(nn ? { nn } : {}) });
    if (!sess.setRoot(simple, validOf(simple), { history: [], ...(objective ? { objective } : {}) })) return null;
    await sess.search({ maxms: 600000, untilWork: work, untilVisits: 40 * work });
    const b = sess.best();
    if (!b || !b.length) return { pass: true, top: [] };
    return { m: `${b[0].x},${b[0].y}`, wr: b[0].top?.[0]?.[4] ?? null, top: (b[0].top ?? []).slice(0, 6).map((t) => [`${t[0]},${t[1]}`, t[3], +(t[4] ?? 0).toFixed(3)]) };
  });
}

if (argv.includes("--scan")) {
  const all = JSON.parse(fs.readFileSync(str("starts-file", null), "utf8")).starts.filter((s) => !s.on && s.p >= num("pmin", 1e-5));
  const WORK = num("work", 1360);
  const done = new Set(fs.existsSync(OUT) ? readJsonl([OUT]).map((r) => r.key) : []);
  for (let i = SI; i < all.length; i += SN) {
    const s = all[i];
    if (done.has(s.key)) continue;
    const r = await rootSearch(s.start, 1, WORK);
    emit({ kind: "scan", key: s.key, start: s.start, p: s.p, rank: s.rank, v0: r?.wr ?? null, m: r?.m ?? null, top: r?.top ?? [] });
  }
  process.exit(0);
}

// Cheats only for an opponent go.js cheats against (SETTINGS.cheat.on).
const CHEATS_ON = !!(E.SETTINGS.cheat.on[OPP] ?? E.SETTINGS.cheat.on.default);
/** One game from `start`: first move `first` forced (null: the live search plays ply 0 too). */
async function playout(start, first, seed, work) {
  const T = 2e9 + 200 * ((seed * 104729 + 7) % 3e6);
  const fx = { id: "hardbook", opponent: OPP, size: N, komi, start, streakBefore: STREAK, ...(CHEATS_ON ? { cheat: { crime: num("crime", 1.7643), sf14: num("sf14", 3) } } : {}), nets: true, moves: first ? [{ m: first, r: "G", T }] : [{ m: "?", r: "G", T }] };
  const r = await playCheck(fx, { from: first ? 1 : 0, work, seed });
  return { won: r.won, m: r.line[0]?.m ?? null, margin: +(r.black - r.white).toFixed(1) };
}

if (argv.includes("--verify")) {
  const scans = readJsonl(listFiles(str("scan-files", null))).filter((r) => r.kind === "scan" && typeof r.v0 === "number");
  const VMAX = num("vmax", 0.3);
  const extra = (str("extra", "") || "").split(",").filter(Boolean);
  let list = scans.filter((r) => r.v0 < VMAX).sort((a, b) => b.p * (1 - b.v0) - a.p * (1 - a.v0)).slice(0, num("top", 200));
  for (const s of extra) {
    const key = golib.canonicalBoard(s).key;
    if (!list.some((r) => r.key === key)) list.unshift({ key, start: s, p: 0, v0: null, m: null, top: [], extra: true });
  }
  const SEEDS = num("seeds", 12), SCREEN = num("screen", 6), SEEDS0 = num("seeds0", 4), WORK = num("work", 1360), DEEP = num("deep", 12000), K = num("cands", 4);
  // --done-files GLOB: starts other runs (another sharding) already verified.
  const done = new Set(readJsonl([...(fs.existsSync(OUT) ? [OUT] : []), ...(str("done-files", null) ? listFiles(str("done-files", null)) : [])]).map((r) => r.key));
  for (let i = SI; i < list.length; i += SN) {
    const s = list[i];
    if (done.has(s.key)) continue;
    const t0 = Date.now();
    if (!s.m) {
      // A start given by hand (--extra): its live pick from the scan's search.
      const r = await rootSearch(s.start, 1, num("scan-work", 1360));
      s.m = r?.m ?? null;
      s.v0 = r?.wr ?? null;
    }
    const playTo = async (c, n) => {
      for (let k = c.n + 1; k <= n; k++) {
        const r = await playout(s.start, c.m, k, WORK);
        if (r.won) c.won++;
        c.margin += r.margin;
        c.n = k;
      }
    };
    // THE SCREEN: the live pick alone, --screen games. Won every one: booked
    // as it stands (the live line, now at no search time), no candidates.
    const liveC = { m: s.m, won: 0, n: 0, margin: 0, deep: null };
    if (s.m && !s.m.startsWith("-")) await playTo(liveC, SCREEN);
    if (s.m && liveC.won === liveC.n && liveC.n > 0) {
      liveC.margin = +(liveC.margin / liveC.n).toFixed(2);
      liveC.deep = s.v0;
      emit({ kind: "verify", opponent: OPP, key: s.key, start: s.start, p: s.p, v0: s.v0, livePick: s.m, screened: true, seeds: SCREEN, work: WORK, cands: [liveC], base: { won: liveC.won, n: liveC.n, m: s.m }, s: Math.round((Date.now() - t0) / 1000) });
      console.log(`${new Date().toISOString()} ${s.start} p ${s.p} v0 ${s.v0}: screened, live ${s.m} ${liveC.won}/${liveC.n}`);
      continue;
    }
    // Candidates: both deep searches' top moves by visits, and the live pick.
    const d1 = await rootSearch(s.start, 1, DEEP), d2 = await rootSearch(s.start, 2, DEEP);
    const deepWr = new Map(), vis = new Map();
    // (A search's top list can hold the pass, -1,-1: never a book move.)
    for (const d of [d1, d2]) for (const [mv, v, wr] of (d?.top ?? []).filter(([mv]) => !mv.startsWith("-"))) {
      vis.set(mv, (vis.get(mv) ?? 0) + v);
      deepWr.set(mv, Math.max(deepWr.get(mv) ?? 0, wr));
    }
    const cands = [...vis.entries()].sort((a, b) => b[1] - a[1]).slice(0, K).map(([mv]) => mv);
    if (s.m && !cands.includes(s.m)) cands.push(s.m);
    // SUCCESSIVE HALVING over seeds: every candidate plays --seeds0 games,
    // those within one win of the best play on to --seeds in all. The live
    // pick (the scan's) is always carried to the end: it is the baseline.
    const res = cands.map((c) => (c === s.m ? Object.assign(liveC, { deep: deepWr.get(c) ?? null }) : { m: c, won: 0, n: 0, margin: 0, deep: deepWr.get(c) ?? null }));
    for (const c of res) await playTo(c, SEEDS0);
    const top0 = Math.max(...res.map((c) => c.won));
    for (const c of res) if (c.won >= top0 - 1 || c.m === s.m) await playTo(c, SEEDS);
    for (const c of res) c.margin = +(c.margin / c.n).toFixed(2);
    const live = res.find((c) => c.m === s.m);
    const bw = live ? live.won : null;
    emit({ kind: "verify", opponent: OPP, key: s.key, start: s.start, p: s.p, v0: s.v0, livePick: s.m, seeds: SEEDS, work: WORK, deep: DEEP, d1: d1?.top, d2: d2?.top, cands: res, base: { won: bw, n: live?.n ?? 0, m: s.m }, s: Math.round((Date.now() - t0) / 1000) });
    console.log(`${new Date().toISOString()} ${s.start} p ${s.p} v0 ${s.v0}: ${res.map((c) => `${c.m} ${c.won}/${c.n}`).join(", ")} | live ${s.m} ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  process.exit(0);
}
throw new Error("one of --starts, --scan, --verify, --merge");
