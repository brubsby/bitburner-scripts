// How the AI's reply to one position varies over CONSECUTIVE engine ticks of
// its seed (T + 200k) — what seed steering can choose from by waiting.
//   node tools/sim/go-seedseq.mjs BOARD(25 chars, column-major) [--opponent Tetrads] [--ticks 60] [--starts 5]
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const { loadModel } = await import(pathToFileURL(path.join(REPO, "tools/goai/model.mjs")).href);
const model = await loadModel({ quiet: false });
const argv = process.argv.slice(2);
const str = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const s = argv[0];
const N = Math.round(Math.sqrt(s.length));
const simple = Array.from({ length: N }, (_, x) => s.slice(x * N, (x + 1) * N));
const TICKS = Number(str("ticks", 60));
for (let j = 0; j < Number(str("starts", 5)); j++) {
  const T0 = 200 * Math.floor(5e6 + Math.random() * 5e6);
  const seq = [];
  for (let k = 0; k < TICKS; k++) {
    const r = await model.reply(simple, { opponent: str("opponent", "Tetrads"), history: [], passCount: 0, rng: T0 + 200 * k });
    seq.push(r ? `${r.x}${r.y}` : "PP");
  }
  console.log(T0, seq.join(" "));
}
process.exit(0);
