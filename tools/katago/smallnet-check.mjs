// smallnet.mjs vs PyTorch (distill_check.py --ref): the max logit error, and the eval time.
//   node tools/katago/smallnet-check.mjs sn5.json ref5.jsonl
import fs from "node:fs";
import { loadSmallNet } from "./smallnet.mjs";
const [netFile, refFile] = process.argv.slice(2);
const sn = loadSmallNet(netFile);
const N = sn.size;
let maxErr = 0, n = 0;
const rows = fs.readFileSync(refFile, "utf8").trim().split("\n").map((l) => JSON.parse(l));
for (const r of rows) {
  const board = Array.from({ length: N }, (_, x) => r.b.slice(x * N, x * N + N));
  const e = sn.eval(board, r.komi, r.cs ?? null);
  for (let i = 0; i <= N * N; i++) maxErr = Math.max(maxErr, Math.abs(e.logits[i] - r.logits[i]));
  maxErr = Math.max(maxErr, Math.abs(Math.log(e.winB / (1 - e.winB)) - r.v));
  n++;
}
const board = Array.from({ length: N }, (_, x) => rows[0].b.slice(x * N, x * N + N));
const t0 = performance.now();
let k = 0;
while (performance.now() - t0 < 1000) { sn.eval(board, rows[0].komi); k++; }
console.log(`smallnet ${N}x${N} b${sn.heldOut ? "" : ""}: ${n} positions, max |logit error| ${maxErr.toExponential(2)} (${maxErr < 1e-3 ? "PASS" : "FAIL"}); ${(1000 / k).toFixed(3)} ms per eval`);
process.exit(maxErr < 1e-3 ? 0 : 1);
