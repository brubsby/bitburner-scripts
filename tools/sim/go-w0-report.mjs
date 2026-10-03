// NOT CALIBRATED: summarises go-w0.mjs runs, which are harness-only (see there).
// Summarise tools/sim/go-w0.mjs runs: one line per file.
//
//   node tools/sim/go-w0-report.mjs runs/*.jsonl
//
// win rate (Wilson 95%), mean black score (+- se), node power per game at the
// streak the run actually built (scoring.ts:85-88, losses x0.5), modelled live
// seconds per game, and node power per LIVE hour — the gameplan's `w0` unit
// (raw node power per hour, before GoPower and the SF14 doubling).
import fs from "node:fs";

const files = process.argv.slice(2);
const wilson = (k, n) => {
  if (!n) return [NaN, NaN];
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = (p + (z * z) / (2 * n)) / d, h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [c - h, c + h];
};
for (const f of files) {
  const lines = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const start = lines.find((l) => l.kind === "start") ?? {};
  const g = lines.filter((l) => l.kind === "game");
  const n = g.length;
  if (!n) {
    console.log(`${f}: no games yet`);
    continue;
  }
  const wins = g.filter((x) => x.won).length;
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const sd = (a) => Math.sqrt(a.reduce((s, v) => s + (v - mean(a)) ** 2, 0) / Math.max(1, a.length - 1));
  const black = g.map((x) => x.black);
  const power = g.map((x) => x.power);
  // The harness's liveS counts timer hops and our think; the AI's own
  // synchronous compute between hops (oppMs, measured under node — NOT
  // calibrated against Chrome) is main-thread time in the live game too.
  const live = g.map((x) => x.liveS + (x.oppMs ?? 0) / 1000);
  const pph = (mean(power) / mean(live)) * 3600;
  // delta-method se of a ratio of means
  const se = (a) => sd(a) / Math.sqrt(a.length);
  const pphSe = pph * Math.sqrt((se(power) / mean(power)) ** 2 + (se(live) / mean(live)) ** 2);
  const [lo, hi] = wilson(wins, n);
  const cheats = g.some((x) => "cheatOk" in x) ? ` cheats/game ${mean(g.map((x) => x.cheatOk)).toFixed(2)} wait ${mean(g.map((x) => x.cheatWaitS)).toFixed(0)}s ejected ${g.filter((x) => x.ejected).length}` : "";
  console.log(
    `${f.split("/").pop()} [${start.opponent} ${start.size ?? 19}x @${start.maxms}ms ${JSON.stringify(start.opts ?? {})}${start.cheat ? " cheat=" + start.cheat : ""}] ` +
      `n=${n} win ${(wins / n * 100).toFixed(0)}% [${(lo * 100).toFixed(0)}-${(hi * 100).toFixed(0)}] ` +
      `black ${mean(black).toFixed(1)}+-${se(black).toFixed(1)} power/game ${mean(power).toFixed(1)} live ${mean(live).toFixed(0)}s ` +
      `-> ${pph.toFixed(0)}+-${pphSe.toFixed(0)} power/h  moves ${mean(g.map((x) => x.ourTurns)).toFixed(0)} it/mv ${mean(g.map((x) => x.itersPerMove)).toFixed(0)}${cheats}`,
  );
}
