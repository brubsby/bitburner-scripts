// THE LOST-GAME CORPUS: replay a lost Go game against the game's own AI and
// ask whether the CURRENT solver still loses it.
//
// Used by tools/test/golosses.test.mjs (CI, the corpus in
// tools/test/fixture-go-losses.json) and tools/sim/go-fixture.mjs (turns a
// live go-games.txt loss, or a harness loss, into a corpus entry).
//
// A CASE is one lost game: its start layout (offline nodes, any handicap
// stones), komi, opponent, size, and every ply as played — our move `m`, the
// AI's reply `r`, and, when the record has it, `T`: the playtime in the tick
// we played (go.js, the per-game log since 2026-10-06). The AI's reply was
// seeded with T + 200k (goAI.ts:184, getMove: new WHRNG(rngOverride ||
// Player.totalPlaytime) after one waitCycle; totalPlaytime moves in whole
// 200ms engine cycles, engine.tsx:84-96); `ks` holds the k that reproduce the
// logged reply through the AI's own code (resolved by go-fixture.mjs).
//
// A CHECK replays the logged line up to ply `from` (our moves and the AI's
// logged replies, forced), then lets the solver play the rest against the AI:
//   - while the game is still on the logged line, the AI's reply is the
//     logged one (it is what the game did);
//   - off the line, the AI is the game's getMove seeded from the clock: the
//     last logged T advanced 1.2s a turn, plus 200 x k (k = the case's most
//     common resolved k, else 1) — the deterministic stand-in for the live
//     clock. getDefendMove's Math.random (goAI.ts) runs on a seeded stream.
// The solver is golib.modelSession with the LIVE per-opponent configuration
// (go.js SETTINGS: power objective when it plays on, mirror pass, the clock)
// and a fixed search stream (opts.seed) and WORK budget per move (model-
// calling iterations, not milliseconds: deterministic on any machine; ~1600
// work is ~800ms at 5x5). No ponder: each move searches its budget on a tree
// reused from the previous one.
//
// NOT CALIBRATED as a win-rate estimate: one deterministic line per check, at
// a fixed work budget, with the AI's seeds approximated off the logged line.
// It answers "does the solver still lose THIS position", nothing about rates.

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");

let env = null;
/** golib, the AI model, the goai bundle (board rules), go.js SETTINGS, goplan rates. */
export async function regressEnv() {
  if (env) return env;
  await import(pathToFileURL(path.join(REPO, "tools/test/gameresolve.mjs")).href);
  const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
  const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
  const { OUT } = await import(pathToFileURL(path.join(REPO, "tools/goai/build.mjs")).href);
  const model = await loadModel({ quiet: false });
  if (!model) throw new Error("tools/goai opponent model could not build or load (needs ~/Repos/bitburner and esbuild)");
  const m = await import(pathToFileURL(OUT).href);
  const { SETTINGS } = await import(pathToFileURL(path.join(REPO, "go.js")).href);
  const { POWER_PER_HOUR } = await import(pathToFileURL(path.join(REPO, "goplan.js")).href);
  env = { golib, model, m, SETTINGS, POWER_PER_HOUR };
  return env;
}

/**
 * THE SOLVER'S NETS (a case with `nets: true`): the session's opts.nn exactly
 * as tools/go-solver.mjs sessOpts builds it by default — the outcome net with
 * steer for Tetrads (smallnet-5-o2), the b4c32 net at depth 1 for the other
 * opponents it is on for, nothing elsewhere. Cases recorded before the nets
 * shipped (2026-10-07/08) replay without them, as their checks were set.
 */
const NET_FILES = { outcome: "tools/goai/smallnet-5-o2.json", b4c32: "tools/goai/smallnet-5-b4c32.json" };
const OUTCOME_ON = new Set(["Tetrads"]);
const SMALLNET_ON = new Set(["Tetrads", "Daedalus", "Illuminati", "SlumSnakes", "Netburners"]);
const nets = {};
export async function solverNn(opponent, N) {
  const key = planKey(opponent);
  const which = OUTCOME_ON.has(key) ? "outcome" : SMALLNET_ON.has(key) ? "b4c32" : null;
  if (!which) return null;
  if (!nets[which]) {
    const { loadSmallNet } = await import(pathToFileURL(path.join(REPO, "tools/katago/smallnet.mjs")).href);
    nets[which] = loadSmallNet(path.join(REPO, NET_FILES[which]));
  }
  const net = nets[which];
  if (net.size !== N) return null;
  return { eval: async (b, k) => net.eval(b, k), mix: 0, maxDepth: 1, parallel: 1, ...(which === "outcome" ? { steer: true } : {}) };
}

/** go-games.txt / goplan opponent key -> the game's GoOpponent name. */
export const gameOpponent = (o) => ({ TheBlackHand: "The Black Hand", SlumSnakes: "Slum Snakes" })[o] ?? o;
/** The game's name -> goplan key. */
export const planKey = (o) => ({ "The Black Hand": "TheBlackHand", "Slum Snakes": "SlumSnakes" })[o] ?? o;

/** A seeded Math.random for the duration of fn (getDefendMove draws it). */
export async function withSeededRandom(seed, fn) {
  const real = Math.random;
  let s = seed >>> 0 || 1;
  Math.random = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  try {
    return await fn();
  } finally {
    Math.random = real;
  }
}

/** The live configuration go.js plays `opponent` (goplan key) with at 5x5. */
export function liveConfig(E, opponent, size) {
  const S = E.SETTINGS;
  const mirror = S.mirror[opponent] ?? S.mirror.default;
  return {
    mirror,
    objective: S.power.on || mirror === "search",
    clock: !!(S.clock[opponent] ?? S.clock.default),
    lossScale: S.power.lossScaleBy[opponent] ?? S.power.lossScale,
    maxms: S.model.maxmsBy[opponent] ?? S.model.maxms,
    rate: (E.POWER_PER_HOUR[opponent] ?? 0) / 3600,
    size,
  };
}

const toSimple = (s, N) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));

/** The AI's seed lag k used off the logged line: the case's most common resolved k, else 1. */
export function caseK(fx) {
  const n = new Map();
  for (const mv of fx.moves) if (Array.isArray(mv.ks) && mv.ks.length && mv.ks.length < 8) for (const k of mv.ks) n.set(k, (n.get(k) ?? 0) + 1 / mv.ks.length);
  let best = 1, bw = 0;
  for (const [k, w] of n) if (w > bw) { best = k; bw = w; }
  return best;
}

/**
 * Play check `from` of case `fx` (see the header). Returns
 * { won, black, white, line: [{ply, m, r, onLine}], decisions }.
 *   work: the search's model-calling iterations per move (default 1600)
 *   seed: the search stream and the AI's Math.random stream
 */
export async function playCheck(fx, { from = 0, work = 1600, seed = 1, decideOnly = false, cheatPolicy = null } = {}) {
  const E = await regressEnv();
  const { golib, model, m } = E;
  const N = fx.size;
  const komi = fx.komi;
  const oppName = gameOpponent(fx.opponent);
  const opp = model.opponentOf(oppName);
  const cfg = liveConfig(E, planKey(fx.opponent), N);
  // THE CHEATS (a case with `cheat`: {crime, sf14}, the game's cheat inputs
  // when it was lost): off the forced line the solver's moves are played
  // through go.js's own cheat policy (SETTINGS.cheat, or `cheatPolicy` to
  // compare one) wherever the roll's window is open at the move's playtime
  // (golib.cheatRoll / cheatChance, the clock as for the AI's seed):
  //   joint            the pair search (solver opts.pairs, pairsOnly) decides
  //   hardBelow > 0    the pair search on a move whose single wins < hardBelow
  //   else (greedy)    the single, then a second-stone search on the board
  //                    after it at secondMs/maxms of the budget, its valid list
  //                    the pre-cheat one (playTwoMoves validates both first)
  // A case without `cheat` replays single stones only (as before).
  const CH = fx.cheat ? { ...E.SETTINGS.cheat, ...(cheatPolicy ?? {}), crime: fx.cheat.crime, sf14: fx.cheat.sf14 ?? 0 } : null;
  const nn = fx.nets ? await solverNn(fx.opponent, N) : null;
  return withSeededRandom(seed * 7919 + 17, async () => {
    const st = m.getNewBoardStateFromSimpleBoard(toSimple(fx.start, N), undefined, opp, m.GoColor.white);
    st.previousBoards = [];
    st.passCount = 0;
    const simpleOf = () => m.simpleBoardFromBoard(st.board);
    const validOf = () => {
      const g = Array.from({ length: N }, () => new Array(N).fill(false));
      for (const p of m.getAllValidMoves(st, m.GoColor.black)) g[p.x][p.y] = true;
      return g;
    };
    const scoreOf = () => {
      const b = golib.parseBoard(simpleOf());
      const sc = golib.makeScratch(N);
      const margin = golib.scoreBoard(b, golib.makeGeometry(N), N, komi, sc);
      return { black: sc.us, white: sc.them + komi, margin };
    };
    const playMv = (mv, colour) => {
      if (mv === "P" || mv === "G") {
        m.passTurn(st, colour, false);
        return true;
      }
      // A two-move cheat ("x,y+x2,y2"): both stones (Go.ts playTwoMoves).
      // makeMove refuses a second move of one colour in a row (notYourTurn),
      // which silently dropped a cheat's second stone: hand the turn back.
      let ok = true;
      const other = colour === m.GoColor.black ? m.GoColor.white : m.GoColor.black;
      for (const p of mv.split("+").filter(Boolean)) {
        const [x, y] = p.split(",").map(Number);
        if (mv.includes("+")) st.previousPlayer = other;
        ok = m.makeMove(st, x, y, colour) && ok;
      }
      return ok;
    };
    let points = 0;
    for (const c of fx.start) if (c !== "#") points++;
    const objective = cfg.objective
      ? golib.powerObjective({ streak: Math.max(0, fx.streakBefore ?? 8), komi, size: N, eBlack: 0.68 * points, rate: cfg.rate, turnS: 1.2, lossScale: cfg.lossScale })
      : null;
    // The clock: logged T where the record has it, else extrapolated 1.2s a turn.
    const K = caseK(fx);
    let lastT = null, lastTPly = 0;
    for (let i = 0; i < fx.moves.length; i++) if (fx.moves[i].T > 0) { lastT = fx.moves[i].T; lastTPly = i; break; }
    if (lastT === null) lastT = 2e9; // no clock in the record: any fixed playtime
    const tAt = (ply) => {
      const mv = fx.moves[ply];
      if (mv && mv.T > 0) return mv.T;
      let base = lastT, bp = lastTPly;
      for (let i = Math.min(ply, fx.moves.length) - 1; i >= 0; i--) if (fx.moves[i].T > 0) { base = fx.moves[i].T; bp = i; break; }
      return base + 200 * Math.round(((ply - bp) * 1200) / 200);
    };
    const kw = [[K, 0.6], [K + 1, 0.25], [K - 1, 0.1], [K + 2, 0.05]];
    // A cheat case's session carries the solver's pair options (go-solver JOINT_OPTS).
    const sess = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: oppName }) }, { seed, ...(CH ? { pairs: [6, 5], pairsOnly: true } : {}), ...(nn ? { nn } : {}) });
    let cheats = 0;
    const windowOpen = (ply) => !!CH && !oppPassed && cheats < CH.maxPerGame && ply + 1 >= CH.fromTurn && golib.cheatChance(cheats, CH.crime, CH.sf14) >= CH.minChance && golib.cheatRoll(tAt(ply)) <= golib.cheatChance(cheats, CH.crime, CH.sf14);
    const secondWork = CH ? Math.max(50, Math.round((work * (CH.secondMs ?? cfg.maxms)) / cfg.maxms)) : 0;
    const validList = (g) => {
      const out = [];
      for (let x = 0; x < N; x++) for (let y = 0; y < N; y++) if (g[x][y]) out.push([x, y]);
      return out;
    };
    let oppPassed = false;
    let onLine = true;
    const line = [];
    const decisions = [];
    for (let ply = 0; ply < N * N * 4 && st.passCount < 2; ply++) {
      const logged = fx.moves[ply];
      let mv;
      // The session is rooted on the board after a greedy cheat's first stone
      // (the second-stone request's root): commit the second stone alone.
      let greedySecond = false;
      if (ply < from && logged) {
        mv = logged.m;
        if (mv.includes("+")) cheats++;
        // Keep the session's tree in step with the forced line (cheap: no search).
        sess.setRoot(simpleOf(), validOf(), { history: st.previousBoards.slice(), opponentPassed: oppPassed, ...(objective ? { objective } : {}) });
      } else {
        const clock = cfg.clock ? { T: tAt(ply), kw, turnTicks: 6, jitter: 5, eps: 0.1 } : undefined;
        const simple = simpleOf();
        const valid = validOf();
        const history = st.previousBoards.slice();
        const rootOpts = { history, opponentPassed: oppPassed, ...(objective ? { objective } : {}), ...(clock ? { clock } : {}) };
        const r0 = sess.setRoot(simple, valid, rootOpts);
        mv = "P";
        if (r0) {
          await sess.search({ maxms: 30000, untilWork: work, untilVisits: 40 * work });
          const b = sess.best();
          if (b && b.length) mv = `${b[0].x},${b[0].y}`;
          const d = { ply, mv, top: b?.[0]?.top ?? [] };
          decisions.push(d);
          if (mv !== "P" && windowOpen(ply)) {
            const wr = d.top?.[0]?.[4];
            if (CH.joint || (CH.hardBelow > 0 && typeof wr === "number" && wr < CH.hardBelow)) {
              // The pair search (go-solver with a request's `cheat`: pairs at the root).
              sess.setRoot(simple, valid, { ...rootOpts, cheat: { fns: [() => true], cheats } });
              await sess.search({ maxms: 30000, untilWork: work, untilVisits: 40 * work });
              const pb = sess.best();
              const p0 = pb?.[0];
              if (p0?.second && valid[p0.x]?.[p0.y] && valid[p0.second.x]?.[p0.second.y]) {
                mv = `${p0.x},${p0.y}+${p0.second.x},${p0.second.y}`;
                d.pair = { mv, top: p0.top ?? [], hard: !CH.joint };
              }
            }
            if (!mv.includes("+") && !CH.joint) {
              // The greedy cheat: a second-stone request on the board after the first.
              const [x1, y1] = mv.split(",").map(Number);
              const board2 = golib.applyMove(simple, x1, y1);
              if (board2) {
                const v2 = valid.map((col, x) => col.map((ok, y) => ok && !(x === x1 && y === y1) && board2[x][y] === "."));
                if (validList(v2).length && sess.setRoot(board2, v2, { history: [simple.join(""), ...history], opponentPassed: false, ...(objective ? { objective } : {}), ...(clock ? { clock } : {}) })) {
                  await sess.search({ maxms: 30000, untilWork: secondWork, untilVisits: 40 * secondWork });
                  const s2 = sess.best();
                  if (s2 && s2.length) {
                    mv = `${x1},${y1}+${s2[0].x},${s2[0].y}`;
                    greedySecond = true;
                    d.second = { mv, top: s2[0].top ?? [] };
                  }
                }
              }
            }
            if (mv.includes("+")) cheats++;
          }
        } else decisions.push({ ply, mv, top: [], passOnly: true });
        if (decideOnly) return { won: null, line, decisions };
      }
      if (onLine && (!logged || mv !== (CH ? logged.m : logged.m.replace(/\+.*/, "")))) onLine = false;
      if (!playMv(mv, m.GoColor.black)) {
        playMv("P", m.GoColor.black);
        mv = "P";
      }
      if (mv === "P") sess.commit(null);
      else if (greedySecond) sess.commit(...mv.split("+")[1].split(",").map(Number));
      else if (mv.includes("+")) {
        // A logged cheat: both stones, committed as the pair.
        const [[x1, y1], [x2, y2]] = mv.split("+").map((p) => p.split(",").map(Number));
        sess.commit(x1, y1, { x: x2, y: y2 });
      } else sess.commit(...mv.split(",").map(Number));
      if (st.passCount >= 2) {
        line.push({ ply, m: mv, r: "G", onLine });
        break;
      }
      // The AI's reply: logged while on the line, else the game's getMove on the clock seed.
      let r;
      if (onLine && logged && logged.r !== "G") r = logged.r;
      else {
        const play = await m.getMove(st, m.GoColor.white, opp, false, tAt(ply) + 200 * K);
        r = play.type === "move" ? `${play.x},${play.y}` : "P";
      }
      line.push({ ply, m: mv, r, onLine });
      playMv(r, m.GoColor.white);
      oppPassed = r === "P";
      if (oppPassed) {
        const sc = scoreOf();
        // go.js's mirror pass: an opponent not set to 'search' is passed back at once when black is ahead.
        if (cfg.mirror !== "search" && sc.margin > 0) {
          playMv("P", m.GoColor.black);
          line.push({ ply: ply + 1, m: "P", r: "G", onLine: false, mirror: true });
          break;
        }
      }
    }
    const sc = scoreOf();
    return { won: sc.margin > 0, black: sc.black, white: sc.white, line, decisions };
  });
}

/**
 * Turn a game record (go-games.txt shape: start, komi, opponent, size, moves
 * [{m, r, T?}], streakBefore) into a corpus case: resolve each AI reply's seed
 * lag k through the AI's own code where the record carries T.
 */
export async function caseFromRecord(rec, { id, source = "live", note = "" } = {}) {
  const E = await regressEnv();
  const { model, m } = E;
  const N = rec.size;
  const oppName = gameOpponent(rec.opponent);
  const opp = model.opponentOf(oppName);
  const st = m.getNewBoardStateFromSimpleBoard(toSimple(rec.start, N), undefined, opp, m.GoColor.white);
  st.previousBoards = [];
  st.passCount = 0;
  const moves = [];
  for (const t of rec.moves) {
    const mv = { m: t.m, r: t.r, ...(t.T > 0 ? { T: t.T } : {}), ...(t.s ? { s: t.s } : {}), ...(Array.isArray(t.t) ? { t: t.t } : {}) };
    if (t.m === "P") m.passTurn(st, m.GoColor.black, false);
    else if (t.m.includes("+")) {
      mv.note = "a two-move cheat";
      for (const p of t.m.split("+").filter(Boolean)) {
        const [x, y] = p.split(",").map(Number);
        // Both stones are black's (playTwoMoves): makeMove refuses a second
        // black move in a row, which silently dropped the second stone.
        st.previousPlayer = m.GoColor.white;
        if (!m.makeMove(st, x, y, m.GoColor.black)) throw new Error(`record ${rec.at}: our logged cheat stone ${p} is illegal on the reconstructed board`);
      }
      st.previousPlayer = m.GoColor.black;
    } else {
      const [x, y] = t.m.split(",").map(Number);
      if (!m.makeMove(st, x, y, m.GoColor.black)) throw new Error(`record ${rec.at}: our logged move ${t.m} is illegal on the reconstructed board`);
    }
    if (t.r !== "G" && t.T > 0) {
      const ks = [];
      const board = m.simpleBoardFromBoard(st.board);
      for (let k = -1; k <= 8; k++) {
        const rr = await withSeededRandom(k + 101, () => model.reply(board, { opponent: oppName, history: st.previousBoards.slice(), passCount: st.passCount, rng: t.T + 200 * k }));
        if ((rr ? `${rr.x},${rr.y}` : "P") === t.r) ks.push(k);
      }
      mv.ks = ks;
    }
    if (t.r !== "G") {
      if (t.r === "P") m.passTurn(st, m.GoColor.white, false);
      else {
        const [x, y] = t.r.split(",").map(Number);
        if (!m.makeMove(st, x, y, m.GoColor.white)) throw new Error(`record ${rec.at}: the AI's logged reply ${t.r} is illegal on the reconstructed board`);
      }
    }
    moves.push(mv);
  }
  return {
    id: id ?? `${source}-${rec.at ?? new Date().toISOString()}-${planKey(rec.opponent)}`,
    source,
    at: rec.at ?? null,
    opponent: planKey(rec.opponent),
    size: N,
    komi: rec.komi,
    start: rec.start,
    streakBefore: rec.streakBefore ?? null,
    live: { black: rec.black, white: rec.white, ver: rec.ver ?? null, resumed: !!rec.resumed },
    moves,
    ...(note ? { note } : {}),
  };
}

/**
 * Where to check a case: the last of our moves at which the current solver,
 * replaying the logged line, still finds a winning line (its top win rate
 * >= thr) — the decision the corpus should hold the solver to. Falls back to 0.
 */
export async function criticalPly(fx, { work = 1600, seed = 1, thr = 0.5 } = {}) {
  let best = 0;
  for (let from = 0; from < fx.moves.length; from++) {
    if (fx.moves[from].m.includes("+")) continue;
    const r = await probeAt(fx, from, { work, seed });
    if (r && r.wr >= thr) best = from;
  }
  return best;
}

/** The current solver's choice and top win rate at ply `from` of the logged line. */
export async function probeAt(fx, from, { work = 1600, seed = 1 } = {}) {
  const res = await playCheck(fx, { from, work, seed, decideOnly: true });
  const d = res.decisions.find((d) => d.ply === from);
  if (!d) return null;
  return { mv: d.mv, wr: d.top?.[0]?.[4] ?? 0, top: d.top, passOnly: !!d.passOnly };
}
