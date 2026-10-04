// Model cost per call, on positions from self-play (random black, model white).
//   node tools/goai/bench.mjs [--size 9] [--games 4] [--opponent Illuminati]
// Run under --cpu-prof to find the next hot spot.
import { loadModel } from "./model.mjs";

const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const N = Number(arg("size", 9));
const opponent = arg("opponent", "Illuminati");
const model = await loadModel({ quiet: false });
const golib = await import("../../golib.js");

let s = 99;
const rand = () => {
  s ^= s << 13; s >>>= 0;
  s ^= s >> 17;
  s ^= s << 5; s >>>= 0;
  return s / 4294967296;
};
const nbrs = golib.makeGeometry(N);
const scratch = golib.makeScratch(N);
const CH = [".", "X", "O", "#"];
const simple = (b) => Array.from({ length: N }, (_, x) => Array.from({ length: N }, (_, y) => CH[b[x * N + y]]).join(""));
let calls = 0, ms = 0;
for (let gi = 0; gi < Number(arg("games", 4)); gi++) {
  const b = new Uint8Array(N * N);
  const hist = [];
  for (let t = 0; t < N * N; t++) {
    const before = simple(b).join("");
    const mv = golib.lightMove(b, nbrs, N, golib.US, -1, scratch, rand);
    if (mv >= 0) hist.unshift(before);
    const t0 = performance.now();
    const r = await model.reply(simple(b), { opponent, history: hist, passCount: mv < 0 ? 1 : 0, rng: 1 + ((rand() * 3e7) | 0) });
    ms += performance.now() - t0;
    calls++;
    if (!r) break;
    hist.unshift(simple(b).join(""));
    golib.play(b, nbrs, r.x * N + r.y, golib.THEM, scratch);
  }
}
console.log(`${N}x${N} ${opponent}: ${calls} calls, ${(ms / calls).toFixed(3)} ms/call`);
