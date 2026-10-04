// The IPvGO board-size / opponent / solver study, run as ONE harness process at
// a time (this box runs the live game in Chrome; memory is the constraint).
//
//   node tools/sim/go-study.mjs --out /tmp/study [--games5 30 --games7 12 --games9 12 --games13 6]
//        [--only 5x5] [--solvers model,model+p,uct,katago100,katago200gpup] [--opponents Illuminati,...] [--maxms 800] [--seed 2]
//   node tools/sim/go-study-report.mjs /tmp/study/*.jsonl
//
// Each arm is one tools/sim/go-w0.mjs run (the harness that plays like go.js:
// mirror pass, the solver told when the AI passed, a fresh paired layout per
// game via --layoutseed, the AI's waitCycles and pattern rows counted for the
// live clock), written to <out>/<opponent>-<size>-<solver>-<maxms>.jsonl. An
// arm whose file already holds `games` games is skipped, so the study resumes
// where it stopped. Arms run smallest board first, so the decisive ones land
// first.
//
// NOT CALIBRATED live — see go-study-report.mjs.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const OUT = arg("out", "/tmp/go-study");
const SEED = arg("seed", "2");
const MAXMS = arg("maxms", "800");
const SOLVERS = arg("solvers", "model,uct").split(",");
const OPPONENTS = arg("opponents", "Illuminati,Daedalus,Tetrads,TheBlackHand,SlumSnakes,Netburners").split(",");
const SIZES = arg("sizes", "5,7,9,13").split(",").map(Number);
const GAMES = { 5: Number(arg("games5", 30)), 7: Number(arg("games7", 12)), 9: Number(arg("games9", 12)), 13: Number(arg("games13", 6)), 19: Number(arg("games19", 3)) };
const EXTRA = arg("extra", "");
fs.mkdirSync(OUT, { recursive: true });

const gamesIn = (f) => {
  if (!fs.existsSync(f)) return 0;
  return fs.readFileSync(f, "utf8").split("\n").filter((l) => l.includes('"kind":"game"')).length;
};

for (const size of SIZES) {
  for (const opp of OPPONENTS) {
    for (const solver of SOLVERS) {
      const want = GAMES[size];
      const file = path.join(OUT, `${opp}-${size}-${solver.replace("+", "_")}-${MAXMS}${EXTRA ? "-" + EXTRA.replace(/[^a-z0-9]+/gi, "_") : ""}.jsonl`);
      const have = gamesIn(file);
      if (have >= want) continue;
      // A partial file is restarted, not appended: streak replay needs one
      // run's records, and a resumed run would re-deal games 0..have-1.
      if (have) fs.rmSync(file);
      const args = [
        "--max-old-space-size=1024",
        path.join(HERE, "go-w0.mjs"),
        "--size", String(size),
        "--opponent", opp,
        "--games", String(want),
        "--maxms", MAXMS,
        "--layoutseed", SEED,
        "--out", file,
        // model | model+p (pondered) | uct | katagoV[gpu][p]: KataGo at V
        // visits a move (maxms ignored), on the GPU host (KATAGO_REMOTE,
        // default bubtop; no CPU fallback inside a GPU arm), pondered.
        // model+reuse / model+sponder: golib.modelSession (go-w0 --session).
        ...(/^model(\+p|\+reuse|\+sponder|\+sdeep)?$/.test(solver) ? ["--model"] : []),
        ...(solver === "model+reuse" ? ["--session", "reuse"] : solver === "model+sponder" ? ["--session", "ponder"] : solver === "model+sdeep" ? ["--session", "deep"] : []),
        ...(/^(model\+p|katago\d+(gpu)?p)$/.test(solver) ? ["--ponder"] : []),
        ...(/^katago\d+/.test(solver) ? ["--katago", solver.match(/^katago(\d+)/)[1]] : []),
        ...(/^katago\d+gpu/.test(solver) ? ["--katago-remote", process.env.KATAGO_REMOTE ?? "bubtop", "--katago-no-local"] : []),
        ...(EXTRA ? EXTRA.split(" ") : []),
      ];
      const t0 = Date.now();
      console.log(`${new Date().toISOString()} ${opp} ${size}x${size} ${solver} x${want} -> ${file}`);
      const r = spawnSync(process.execPath, args, { stdio: ["ignore", "ignore", "inherit"] });
      console.log(`  exit ${r.status} after ${((Date.now() - t0) / 60000).toFixed(1)} min, ${gamesIn(file)} games`);
    }
  }
}
