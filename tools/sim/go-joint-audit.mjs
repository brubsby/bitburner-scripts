// NOT CALIBRATED: an anomaly audit (structural checks per decision), not a win-rate or power estimate.
//
// THE JOINT-CHEAT AUDIT: replay every live game in the per-game log through
// the JOINT solver (golib modelSession, opts.pairs + pairsOnly, the cheat
// window from each move's logged playtime T) beside the plain single search,
// at every one of our decisions on the logged line, and flag the shapes that
// cost live games:
//   nullRoot   the pair root reads PASS-only where the single search has stones (07:39Z)
//   badPass    the SOLVER's answer (the joint search, then go-solver's pass
//              guard: a pass among pairs re-searched without pairs) passes
//              where the single search plays a stone. Raw passes among pairs
//              the guard turns into stones are counted as guardCaught (not
//              anomalies: that is the guard working; the count says how often
//              the live solver leans on it).
//   illegal    a pair stone not in the game's valid list before either stone (05:25Z)
//   eyeFill    a stone (single or either of a pair) filling our own one-point eye
//   guard      golib's pass-only guard fired (a pair filter emptied a node)
// and diffs the joint answer against the move actually played (informational:
// the search is stochastic and the live budget differs).
//
//   node tools/sim/go-joint-audit.mjs [--file .telemetry/go-games.txt] [--last 300]
//        [--offset 0] [--crime 3.459] [--sf14 0] [--work 300] [--opp Tetrads,Illuminati] [--json out.jsonl]
//
// Exit 1 when any anomaly is found, 0 when clean, 2 when nothing could be audited.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { regressEnv, gameOpponent } from "./go-regress.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FILE = str("file", path.join(REPO, ".telemetry", "go-games.txt"));
const LAST = Number(str("last", 300));
const OFFSET = Number(str("offset", 0)); // skip the newest OFFSET games (split a long audit across processes)
const CRIME = Number(str("crime", 3.459));
const SF14 = Number(str("sf14", 0));
const WORK = Number(str("work", 300));
const OPPS = new Set(str("opp", "Tetrads,Illuminati").split(","));
const JSON_OUT = str("json", null);
const ONLY = str("games", null) ? new Set(str("games", "").split(",")) : null; // --games AT1,AT2: just these records
const MAX = 12, FROM_TURN = 2, MIN_CHANCE = 0.0034;

const E = await regressEnv();
const { golib, model, m } = E;
const lines = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const games = lines.filter((g) => (!ONLY || ONLY.has(g.at)) && g.size === 5 && OPPS.has(g.opponent) && Array.isArray(g.moves) && g.moves.length && !g.resumed).slice(-(LAST + OFFSET), OFFSET ? -OFFSET : undefined);
const N = 5;
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const ownEye = (board, x, y) => {
  if (board[x][y] !== ".") return false;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const u = x + dx, v = y + dy;
    if (u < 0 || v < 0 || u >= N || v >= N) continue;
    if (board[u][v] !== "X" && board[u][v] !== "#") return false;
  }
  return true;
};
const tally = { games: 0, decisions: 0, windowOpen: 0, pairs: 0, agree: 0, guardCaught: 0, nullRoot: 0, badPass: 0, illegal: 0, eyeFill: 0, guard: 0, skipped: 0 };
const anomalies = [];
const out = JSON_OUT ? fs.openSync(JSON_OUT, "w") : null;

for (const g of games) {
  const opp = model.opponentOf(gameOpponent(g.opponent));
  const st = m.getNewBoardStateFromSimpleBoard(toSimple(g.start), undefined, opp, m.GoColor.white);
  st.previousBoards = [];
  st.passCount = 0;
  let cheats = 0, oppPassed = false, broken = false;
  tally.games++;
  for (let i = 0; i < g.moves.length && !broken; i++) {
    const t = g.moves[i];
    const board = m.simpleBoardFromBoard(st.board);
    const history = st.previousBoards.slice();
    if (t.T > 0 && !(t.s === "book")) {
      const list = model.validMoves(board, history);
      const valid = board.map((col, x) => [...col].map((_, y) => list.some(([a, b]) => a === x && b === y)));
      const p = golib.cheatChance(cheats, CRIME, SF14);
      const open = !oppPassed && i + 1 >= FROM_TURN && cheats < MAX && p >= MIN_CHANCE && golib.cheatRoll(t.T) <= p - 0.003;
      const reply = (b, o) => model.reply(b, { ...o, opponent: gameOpponent(g.opponent) });
      const sj = golib.modelSession(N, g.komi, { reply }, { pairs: [6, 5], pairsOnly: true, seed: 1 + i });
      const ss = golib.modelSession(N, g.komi, { reply }, { seed: 1 + i });
      const rj = sj.setRoot(board, valid, { history, opponentPassed: oppPassed, cheat: { fns: open ? [() => true] : null, cheats } });
      const rs = ss.setRoot(board, valid, { history, opponentPassed: oppPassed });
      tally.decisions++;
      if (open) tally.windowOpen++;
      const flag = (kind, extra) => { tally[kind]++; anomalies.push({ at: g.at, ply: i, kind, board: board.join("/"), played: t.m, open, ...extra }); };
      let jm = null, sm = null;
      if (!rj && rs) flag("nullRoot", {});
      if (rj) { await sj.search({ maxms: 20000, untilWork: WORK, untilVisits: 50 * WORK + 100 }); jm = sj.best()?.[0] ?? null; }
      if (rs) { await ss.search({ maxms: 20000, untilWork: WORK, untilVisits: 50 * WORK + 100 }); sm = ss.best()?.[0] ?? null; }
      if (sj.jointGuard?.hits) flag("guard", { last: sj.jointGuard.last });
      if (rj && !jm && sm && !oppPassed) {
        // go-solver's pass guard: the same root without pairs.
        const r2 = sj.setRoot(board, valid, { history, opponentPassed: oppPassed, cheat: { fns: null, cheats } });
        if (r2) { await sj.search({ maxms: 20000, untilWork: WORK, untilVisits: 50 * WORK + 100 }); jm = sj.best()?.[0] ?? null; }
        if (jm) tally.guardCaught++;
        else {
          // Both plain searches, guard and reference, disagree on a marginal
          // pass at this budget: settle it at 8x the work before calling it
          // an anomaly (search noise between a pass and a stone is not a bug).
          const BIG = 8 * WORK;
          const g2 = golib.modelSession(N, g.komi, { reply }, { seed: 7000 + i });
          const s2 = golib.modelSession(N, g.komi, { reply }, { seed: 9000 + i });
          g2.setRoot(board, valid, { history, opponentPassed: oppPassed });
          s2.setRoot(board, valid, { history, opponentPassed: oppPassed });
          await g2.search({ maxms: 60000, untilWork: BIG, untilVisits: 50 * BIG + 100 });
          await s2.search({ maxms: 60000, untilWork: BIG, untilVisits: 50 * BIG + 100 });
          const gb = g2.best()?.[0] ?? null, sb = s2.best()?.[0] ?? null;
          if (!gb && sb) flag("badPass", { single: `${sm.x},${sm.y}`, settled: `guard pass vs single ${sb.x},${sb.y} at ${BIG} work` });
          else tally.noisyPass = (tally.noisyPass ?? 0) + 1;
        }
      }
      if (jm) {
        const stones = [[jm.x, jm.y], ...(jm.second ? [[jm.second.x, jm.second.y]] : [])];
        if (jm.second) tally.pairs++;
        if (stones.some(([x, y]) => !valid[x]?.[y]) || (jm.second && jm.x === jm.second.x && jm.y === jm.second.y)) flag("illegal", { joint: stones.join("+") });
        if (stones.some(([x, y]) => ownEye(board, x, y))) flag("eyeFill", { joint: stones.join("+") });
        const jtxt = jm.second ? `${jm.x},${jm.y}+${jm.second.x},${jm.second.y}` : `${jm.x},${jm.y}`;
        if (jtxt === t.m || `${jm.x},${jm.y}` === t.m.replace(/\+.*/, "")) tally.agree++;
        if (out) fs.writeSync(out, JSON.stringify({ at: g.at, ply: i, open, played: t.m, joint: jtxt, single: sm ? `${sm.x},${sm.y}` : "P" }) + "\n");
      }
    } else tally.skipped++;
    // Play the logged move and reply.
    if (t.m === "P") m.passTurn(st, m.GoColor.black, false);
    else {
      const ps = t.m.split("+").filter(Boolean);
      for (const q of ps) {
        const [x, y] = q.split(",").map(Number);
        st.previousPlayer = m.GoColor.white;
        if (!m.makeMove(st, x, y, m.GoColor.black)) { broken = true; break; }
      }
      if (ps.length > 1) cheats++;
    }
    if (broken) { console.error(`${g.at}: logged move ${t.m} illegal on the reconstruction — game skipped from ply ${i}`); break; }
    if (t.r === "G") break;
    if (t.r === "P") { m.passTurn(st, m.GoColor.white, false); oppPassed = true; }
    else {
      const [x, y] = t.r.split(",").map(Number);
      if (!m.makeMove(st, x, y, m.GoColor.white)) { console.error(`${g.at}: AI reply ${t.r} illegal on the reconstruction`); broken = true; }
      oppPassed = false;
    }
  }
}
if (out) fs.closeSync(out);
console.log(JSON.stringify(tally));
for (const a of anomalies.slice(0, 40)) console.log(JSON.stringify(a));
const bad = tally.nullRoot + tally.badPass + tally.illegal + tally.eyeFill + tally.guard;
console.log(tally.decisions ? (bad ? `ANOMALIES: ${bad}` : "CLEAN: no anomaly in " + tally.decisions + " decisions (" + tally.windowOpen + " with the cheat window open)") : "NOTHING AUDITED");
process.exit(!tally.decisions ? 2 : bad ? 1 : 0);
