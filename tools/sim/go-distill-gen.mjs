// THE DISTILLATION DATA: IPvGO positions (offline nodes included) labelled by
// the walls-KataGo b18 net — the teacher a small in-process net learns from
// (tools/katago/distill-train.py, tools/katago/smallnet.mjs). Runs on the GPU host.
//
//   node tools/sim/go-distill-gen.mjs --size 5 --games 4000 --out d5.jsonl [--remote self] [--temp 1]
//
// POSITIONS: games on the board the game deals (getNewBoardState(size, opp,
// true): its offline nodes, its handicap), white = the game's own AI
// (tools/goai, every opponent in turn, random seeds), black = a sample from
// the teacher's own policy (temperature --temp) with prob 0.85, else a random
// legal stone — the positions a search reaches, on and off the good line.
// Every black-to-move position is written with the teacher's raw output:
//   { N, b: board string (column-major, the game's simple board), komi,
//     p: policy over x*N+y then pass (sums to ~1 over legal), w: black's win
//     probability, o: ownership per x*N+y (black +1) }
// NOT CALIBRATED: the teacher's targets are KataGo's (real Go, area rules),
// not the outcome against the game's AI.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
await import(path.join(HERE, "env.mjs"));
const g = await import(path.join(HERE, "game.bundle.mjs"));
const golib = await import(path.join(HERE, "../../golib.js"));
const { loadModel } = await import(path.join(HERE, "../goai/model.mjs"));
const { startKataGo } = await import(path.join(HERE, "../katago/katago.mjs"));
const { evalQuery } = await import(path.join(HERE, "../katago/evaluator.mjs"));

const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const N = Number(str("size", 5));
const GAMES = Number(str("games", 1000));
const OUT = str("out", `d${N}.jsonl`);
const TEMP = Number(str("temp", 1));
const CONC = Number(str("conc", 32));
const OPPS = ["Netburners", "SlumSnakes", "TheBlackHand", "Tetrads", "Daedalus", "Illuminati"];

const model = await loadModel({ quiet: true });
const kg = await startKataGo({ remote: str("remote", "self"), walls: true, visits: 1, size: N, override: `numAnalysisThreads=${CONC},numSearchThreadsPerAnalysisThread=1,nnMaxBatchSize=${CONC}` });
if (!kg || !kg.walls) throw new Error("gen: the walls engine did not start");
const out = fs.createWriteStream(OUT, { flags: "a" });
let seq = 0;

async function teacher(board, komi) {
  const r = await kg.raw(evalQuery(board, komi, `g${++seq}`));
  const p = new Array(N * N + 1).fill(0);
  const o = new Array(N * N).fill(0);
  for (let x = 0; x < N; x++)
    for (let y = 0; y < N; y++) {
      const k = (N - 1 - y) * N + x;
      p[x * N + y] = r.policy[k] > 0 ? +r.policy[k].toFixed(5) : 0;
      o[x * N + y] = board[x][y] === "#" ? 0 : +(r.ownership[k] ?? 0).toFixed(3);
    }
  p[N * N] = r.policy[N * N] > 0 ? +r.policy[N * N].toFixed(5) : 0;
  return { p, w: +r.rootInfo.winrate.toFixed(4), o };
}

const put = (board, x, y, who) => {
  const b = golib.parseBoard(board);
  if (golib.play(b, golib.makeGeometry(N), x * N + y, who, golib.makeScratch(N)) < 0) return null;
  const ch = [".", "X", "O", "#"];
  return Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => ch[b[i * N + j]]).join(""));
};

async function game(gi) {
  const opp = OPPS[gi % OPPS.length];
  const ai = g.GoOpponent[opp];
  const komi = g.opponentDetails[ai].komi;
  let board = g.simpleBoardFromBoard(g.getNewBoardState(N, ai, true).board);
  const hist = [];
  let passes = 0;
  let written = 0;
  for (let turn = 0; turn < N * N * 3 && passes < 2; turn++) {
    const t = await teacher(board, komi);
    out.write(JSON.stringify({ N, b: board.join(""), komi, opp, ...t }) + "\n");
    written++;
    // Black: the teacher's policy at temperature TEMP over the game's legal moves, or a random one.
    const legal = model.validMoves(board, hist);
    let mv = null;
    if (legal.length) {
      if (Math.random() < 0.85) {
        const ws = legal.map(([x, y]) => Math.pow(t.p[x * N + y] + 1e-6, 1 / TEMP));
        const pw = Math.pow(t.p[N * N] + 1e-6, 1 / TEMP);
        let r = Math.random() * (ws.reduce((a, b) => a + b, 0) + pw);
        for (let i = 0; i < legal.length && mv === null; i++) if ((r -= ws[i]) < 0) mv = legal[i];
      } else mv = legal[Math.floor(Math.random() * legal.length)];
    }
    if (mv) {
      const nb = put(board, mv[0], mv[1], golib.US);
      if (nb) {
        hist.unshift(board.join(""));
        board = nb;
        passes = 0;
      } else passes++;
    } else passes++;
    if (passes >= 2) break;
    const r = await model.reply(board, { opponent: ai, history: hist, passCount: passes, rng: 1 + Math.floor(Math.random() * 3e7) });
    if (r) {
      const nb = put(board, r.x, r.y, golib.THEM);
      if (nb) {
        hist.unshift(board.join(""));
        board = nb;
        passes = 0;
        continue;
      }
    }
    passes++;
  }
  return written;
}

// --from-traces F1,F2,...: OUTCOME LABELS. go-w0.mjs runs at the live config
// with --trace: every black-to-move position of every game, labelled with that
// game's real outcome UNDER OUR POLICY against the game's AI — won, black's
// final area (fraction of the playable points) and our turns left — plus the
// teacher's p/w/o. The value the power objective needs (area, time), not
// generic Go.
const TRACES = str("from-traces", null);
if (TRACES) {
  let n = 0;
  const q = [];
  for (const f of TRACES.split(",")) {
    let start = null;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line) continue;
      const r = JSON.parse(line);
      if (r.kind === "start") start = r;
      if (r.kind !== "game" || !Array.isArray(r.trace)) continue;
      const tr = r.trace;
      const playable = tr[0].board.join("").replace(/#/g, "").length;
      // Black to move: the start board, and every board right after a white entry.
      const pos = [];
      for (let k = 0; k < tr.length; k++) if (tr[k].who === "start" || (tr[k].who === "W" && k + 1 < tr.length)) pos.push(tr[k].board);
      pos.forEach((board, i) => q.push({ board, komi: r.komi, opp: start?.opponent ?? null, won: r.won ? 1 : 0, area: r.black / playable, tl: pos.length - 1 - i }));
    }
  }
  const outF = fs.createWriteStream(OUT, { flags: "a" });
  let idx = 0;
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, async () => {
    while (idx < q.length) {
      const it = q[idx++];
      const t = await teacher(it.board, it.komi);
      outF.write(JSON.stringify({ N, b: it.board.join(""), komi: it.komi, opp: it.opp, ...t, won: it.won, area: +it.area.toFixed(4), tl: it.tl }) + "\n");
      if (++n % 20000 === 0) process.stderr.write(`label: ${n}/${q.length}\n`);
    }
  }));
  outF.end();
  kg.close();
  process.stderr.write(`label done: ${n} positions in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}\n`);
  process.exit(0);
}

let done = 0, positions = 0;
const t0 = Date.now();
const worker = async (w) => {
  for (let gi = w; gi < GAMES; gi += CONC) {
    const n = await game(gi);
    positions += n;
    if (++done % 100 === 0) process.stderr.write(`gen ${N}x${N}: ${done}/${GAMES} games, ${positions} positions, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  }
};
await Promise.all(Array.from({ length: CONC }, (_, w) => worker(w)));
out.end();
kg.close();
process.stderr.write(`gen done: ${positions} positions in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}\n`);
process.exit(0);
