// NOT CALIBRATED: a diagnostic replay against the opponent model with free
// seeds; it prices nothing, and the live AI's replies were clock-seeded.
// Replay a logged live Go game (go.js /tel/go-games.txt, mirrored by the daemon
// to .telemetry/go-games.txt) against the opponent model — the game's own AI
// code (tools/goai) — to see why it was lost.
//
//   node tools/sim/go-replay.mjs [--file .telemetry/go-games.txt] [--loss 1 | --index I | --last]
//        [--maxms 800] [--analyze] [--play K] [--json]
//
//   --loss N    the Nth most recent LOST game (default 1); --index I: line I (0 = oldest);
//               --last: the most recent game, won or lost
//   --analyze   (default) walk the logged moves. At each of OUR moves: a fresh
//               model search on that exact position (golib.modelSession, the
//               budget --maxms) — its choice and top 3 next to what was played
//               live and the live top 3; at each AI reply: how likely the
//               model (free seeds, 32 draws) made the reply the AI actually
//               played. A position where the live move differs from the
//               replayed search, or the AI's reply was one the model rarely
//               plays, is marked.
//   --play K    play K fresh games from the logged START board (the same
//               offline-node layout) with the model search against the AI's
//               own code: was the loss the deal, or the play?
//
// The board is the AI's own state code (tools/goai bundle: boardState,
// getMove), scored by golib.scoreBoard (stones + single-colour regions, komi
// to white — the game's getScore). NOT the live clock: replies here draw free
// seeds, live they were seeded by the playtime (goAI.ts:184).

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

try {
  os.setPriority(19);
} catch {
  /* not fatal */
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const FILE = str("file", path.join(REPO, ".telemetry", "go-games.txt"));
const MAXMS = Number(str("maxms", 800));
const PLAY = Number(str("play", 0));
// --play: the live session search — one tree across moves, pondered for the
// AI's reply time (~1s live: waitCycles x 200ms + pattern rows).
const PONDER_MS = Number(str("ponder-ms", 1000));
const JSON_OUT = argv.includes("--json");

const golib = await import(path.join(REPO, "golib.js"));
const { loadModel } = await import(path.join(REPO, "tools/goai/model.mjs"));
const { OUT } = await import(path.join(REPO, "tools/goai/build.mjs"));
const model = await loadModel({ quiet: false });
if (!model) throw new Error("tools/goai opponent model could not build or load");
const m = await import(pathToFileURL(OUT).href);

if (!fs.existsSync(FILE)) throw new Error(`no game log at ${FILE} (go.js writes /tel/go-games.txt; the daemon mirrors it to .telemetry)`);
const games = fs.readFileSync(FILE, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
let rec;
if (argv.includes("--index")) rec = games[Number(str("index", 0))];
else if (argv.includes("--last")) rec = games[games.length - 1];
else {
  const losses = games.filter((g) => g.won === false);
  rec = losses[losses.length - Number(str("loss", 1))];
}
if (!rec) throw new Error(`no such game in ${FILE} (${games.length} games, ${games.filter((g) => g.won === false).length} losses)`);

const N = rec.size;
const komi = rec.komi;
const opp = model.opponentOf(rec.opponent === "TheBlackHand" ? "The Black Hand" : rec.opponent === "SlumSnakes" ? "Slum Snakes" : rec.opponent);
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const startSimple = toSimple(rec.start);
const freshState = () => {
  const st = m.getNewBoardStateFromSimpleBoard(startSimple, undefined, opp, m.GoColor.white);
  st.previousBoards = [];
  st.passCount = 0;
  return st;
};
const simpleOf = (st) => m.simpleBoardFromBoard(st.board);
const validOf = (st) => {
  const g = Array.from({ length: N }, () => new Array(N).fill(false));
  for (const p of m.getAllValidMoves(st, m.GoColor.black)) g[p.x][p.y] = true;
  return g;
};
const scoreOf = (st) => {
  const b = golib.parseBoard(simpleOf(st));
  const sc = golib.makeScratch(N);
  const margin = golib.scoreBoard(b, golib.makeGeometry(N), N, komi, sc);
  return { black: sc.us, white: sc.them + komi, margin };
};
const objective = rec.objective ? golib.powerObjective({ streak: rec.streakBefore ?? 0, komi, size: N }) : undefined;
const search = async (st, oppPassed) => {
  const s = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: opp }) }, {});
  const r = s.setRoot(simpleOf(st), validOf(st), { history: st.previousBoards.slice(), opponentPassed: oppPassed, ...(objective ? { objective } : {}) });
  if (!r) return { move: "P", top: [] };
  await s.search({ maxms: MAXMS });
  const b = s.best();
  return { move: !b || !b.length ? "P" : `${b[0].x},${b[0].y}`, top: b?.[0]?.top ?? [] };
};
const play = (st, mv, colour) => {
  if (mv === "P" || mv === "G") {
    m.passTurn(st, colour, false);
    return true;
  }
  const [x, y] = mv.split(",").map(Number);
  return m.makeMove(st, x, y, colour);
};

const out = { game: { at: rec.at, opponent: rec.opponent, size: N, black: rec.black, white: rec.white, won: rec.won, streakBefore: rec.streakBefore, moves: rec.moves.length }, turns: [], play: null };
if (!argv.includes("--play") || argv.includes("--analyze")) {
  const st = freshState();
  let oppPassed = false;
  for (const [i, t] of rec.moves.entries()) {
    const ours = await search(st, oppPassed);
    const ourLive = t.m.replace("+", "");
    const turn = { i, live: ourLive, src: t.s, liveTop: t.t ?? null, replay: ours.move, replayTop: ours.top, differs: ours.move !== ourLive };
    if (t.s === "cheat") turn.note = "a two-move cheat: the second stone is not in the log";
    if (!play(st, ourLive, m.GoColor.black)) {
      turn.error = "the logged move is illegal on the reconstructed board — the log and the board disagree";
      out.turns.push(turn);
      break;
    }
    if (t.r === "G" || st.passCount >= 2) {
      out.turns.push(turn);
      break;
    }
    // How likely the model makes the reply the AI actually played (free seeds).
    const counts = new Map();
    for (let k = 0; k < 32; k++) {
      const r = await model.reply(simpleOf(st), { opponent: opp, history: st.previousBoards.slice(), passCount: st.passCount, rng: 1 + Math.floor(Math.random() * 3e7) });
      const key = r ? `${r.x},${r.y}` : "P";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    turn.ai = t.r;
    turn.aiModelP = +((counts.get(t.r) ?? 0) / 32).toFixed(3);
    turn.aiModelTop = [...counts.entries()].sort((a, z) => z[1] - a[1]).slice(0, 3).map(([k, c]) => [k, c / 32]);
    play(st, t.r, m.GoColor.white);
    oppPassed = t.r === "P";
    turn.score = scoreOf(st);
    out.turns.push(turn);
  }
  out.final = scoreOf(st);
}
if (PLAY > 0) {
  const res = [];
  for (let k = 0; k < PLAY; k++) {
    const st = freshState();
    let oppPassed = false;
    const sess = golib.modelSession(N, komi, { reply: (b, o) => model.reply(b, { ...o, opponent: opp }) }, {});
    for (let guard = 0; guard < N * N * 4 && st.passCount < 2; guard++) {
      const r0 = sess.setRoot(simpleOf(st), validOf(st), { history: st.previousBoards.slice(), opponentPassed: oppPassed, ...(objective ? { objective } : {}) });
      let mv = "P";
      if (r0) {
        await sess.search({ maxms: r0.reused ? Math.min(MAXMS, 50) : MAXMS });
        const b = sess.best();
        if (b && b.length) mv = `${b[0].x},${b[0].y}`;
      }
      play(st, mv, m.GoColor.black);
      if (mv === "P") sess.commit(null);
      else sess.commit(...mv.split(",").map(Number));
      if (st.passCount >= 2) break;
      await sess.ponder(PONDER_MS);
      const r = await m.getMove(st, m.GoColor.white, opp, false, 1 + Math.floor(Math.random() * 3e7));
      if (r.type === "move") {
        m.makeMove(st, r.x, r.y, m.GoColor.white);
        oppPassed = false;
      } else {
        m.passTurn(st, m.GoColor.white, false);
        oppPassed = true;
        const sc = scoreOf(st);
        if (sc.margin > 0) {
          m.passTurn(st, m.GoColor.black, false);
          break;
        }
      }
    }
    const sc = scoreOf(st);
    res.push({ won: sc.margin > 0, black: sc.black, white: sc.white });
  }
  out.play = { games: PLAY, wins: res.filter((r) => r.won).length, meanBlack: +(res.reduce((a, r) => a + r.black, 0) / PLAY).toFixed(2), games_: res };
}

if (JSON_OUT) console.log(JSON.stringify(out, null, 1));
else {
  const g = out.game;
  console.log(`${g.at} ${g.opponent} ${g.size}x${g.size}: live ${g.won ? "WON" : "LOST"} ${g.black}-${g.white} (streak before ${g.streakBefore}), ${g.moves} turns; replayed at ${MAXMS}ms`);
  for (const t of out.turns) {
    const flag = t.differs ? " <-- replay differs" : "";
    const aiFlag = t.aiModelP !== undefined && t.aiModelP < 0.2 ? ` <-- the AI's reply had model p=${t.aiModelP}` : "";
    console.log(`  #${t.i} us ${t.live} [${t.src}] live top ${JSON.stringify(t.liveTop)} | replay ${t.replay} top ${JSON.stringify(t.replayTop)}${flag}`);
    if (t.ai !== undefined) console.log(`      AI ${t.ai} (model p=${t.aiModelP}; model's likely ${JSON.stringify(t.aiModelTop)})${aiFlag}  score B ${t.score.black} W ${t.score.white}`);
    if (t.error) console.log(`      !! ${t.error}`);
  }
  if (out.final) console.log(`  final (reconstructed) B ${out.final.black} W ${out.final.white}`);
  if (out.play) console.log(`PLAY: ${out.play.wins}/${out.play.games} won from this deal, mean black ${out.play.meanBlack}`);
}
process.exit(0);
