// Audits live pass-forcing play: over every game in a /tel/go-games.txt since
// --since, each of our moves that matches a candidate (move AND position) is
// classed by the AI's actual reply — HIT (the reply the candidate expects) or
// WRONG (another reply: the clock prediction failed) — and each game by how it
// went after the last candidate step.
//
//   node tools/sim/go-oracle-audit.mjs GAMES.txt --since 2026-10-06T20:41 [--oracle F]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const golib = await import(pathToFileURL(path.join(REPO, "golib.js")).href);
const oracle = JSON.parse(fs.readFileSync(str("oracle", path.join(REPO, "tools/goai/oracle-Tetrads.json")), "utf8"));
const since = str("since", "2026-10-06T20:41");
const games = fs.readFileSync(argv[0], "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l)).filter((g) => g.opponent === "Tetrads" && g.size === 5 && g.at >= since);
const N = 5, nbrs = golib.makeGeometry(N), sc = golib.makeScratch(N);
const toSimple = (s) => Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const CH = ".XO#";
let hit = 0, wrong = 0, gamesWith = 0, lost = 0;
const wrongs = [];
const byGame = [];
for (const g of games) {
  const b = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) b[i] = g.start[i] === "#" ? 3 : 0;
  let passed = false, n = 0, w = 0;
  for (const mv of g.moves) {
    if (mv.m === "P" || mv.m.includes("+")) break;
    const s = Array.from(b, (v) => CH[v]).join("");
    const [x, y] = mv.m.split(",").map(Number);
    const c = golib.oracleCandidates(oracle, toSimple(s), { passed }).filter((c) => c.x === x && c.y === y);
    const fast = mv.s === "req" && mv.a < 120;
    golib.play(b, nbrs, x * N + y, 1, sc);
    if (c.length && fast) {
      n++;
      const ok = c.some((cc) => (cc.reply ? `${cc.reply.x},${cc.reply.y}` : "P") === mv.r);
      if (ok) hit++;
      else { wrong++; w++; wrongs.push({ at: g.at, move: mv.m, expected: c.map((cc) => (cc.reply ? `${cc.reply.x},${cc.reply.y}` : "P")).join("|"), got: mv.r, won: g.won }); }
    }
    if (mv.r && mv.r !== "P" && mv.r !== "G") { const [rx, ry] = mv.r.split(",").map(Number); golib.play(b, nbrs, rx * N + ry, 2, sc); }
    passed = mv.r === "P";
  }
  if (n) gamesWith++;
  if (!g.won) lost++;
  byGame.push({ at: g.at, n, w, won: g.won, black: g.black });
}
console.log(`${games.length} Tetrads 5x5 games since ${since}: ${gamesWith} played candidates; candidate steps ${hit + wrong}: HIT ${hit}, WRONG reply ${wrong}; lost ${lost}`);
for (const e of wrongs) console.log(`  wrong: ${e.at} move ${e.move} expected ${e.expected} got ${e.got} won ${e.won}`);
for (const e of byGame.filter((e) => !e.won)) console.log(`  LOST ${e.at}: candidate steps ${e.n}, wrong ${e.w}, black ${e.black}`);
process.exit(0);
