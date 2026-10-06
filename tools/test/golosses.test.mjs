// [GL] The lost-game corpus: every Go game we have lost (live, or in the
// harness) is replayed against the game's own AI with the CURRENT solver.
//
// WHY. A 5x5 loss is rare (~0.5% live on Tetrads) and costs a streak ramp, so
// win-rate measurements need thousands of games and cannot gate a commit. The
// corpus can: each lost game is kept with everything needed to replay it —
// start layout, komi, opponent, every ply, and the AI's RNG seed (the playtime
// T go.js logs per move; goAI.ts:184 seeds getMove with it) — and each check
// replays the logged line to its CRITICAL PLY, then lets the solver play the
// rest (tools/sim/go-regress.mjs playCheck: live per-opponent config, fixed
// search stream and work budget, the AI off the logged line seeded from the
// clock). Deterministic on any machine.
//
//   GL1 every case marked `fixed` is still WON from each of its checks (FAIL
//       if not: a regression); every `open` case is reported (WARN while
//       lost, a note when it starts winning — promote it to fixed).
//   GL2 the corpus is well-formed: each case replays legally from its start
//       layout, and a live case logged with playtimes resolves its seeds.
//
// Adding a live loss:  node tools/sim/go-fixture.mjs --at <its `at`>
// (or --loss 1 for the latest; --harness f.jsonl for a go-w0 --trace loss).

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO } from "./ram.mjs";

const FIXTURE = path.join(REPO, "tools", "test", "fixture-go-losses.json");

export async function run() {
  const checks = [];
  const c1 = new Check("GL1", "the lost-game corpus: every fixed case is still won from its critical ply by the current solver");
  const c2 = new Check("GL2", "the corpus replays legally and its live cases carry the AI's seed where the record had a playtime");
  checks.push(c1, c2);
  let R;
  try {
    R = await import("../sim/go-regress.mjs");
    await R.regressEnv();
  } catch (e) {
    c1.warn("the opponent model could not load — the corpus did NOT run", String(e?.message ?? e).slice(0, 200));
    return checks;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  if (!Array.isArray(fixture.cases) || !fixture.cases.length) c2.fail("the corpus is empty", FIXTURE);
  let won = 0, lost = 0, open = 0;
  for (const fx of fixture.cases) {
    c2.examined(1);
    for (const k of ["id", "opponent", "size", "komi", "start", "moves", "checks", "status"]) if (fx[k] === undefined) c2.fail(`${fx.id ?? "?"}: missing ${k}`);
    if (fx.start?.length !== fx.size * fx.size) c2.fail(`${fx.id}: start layout is not ${fx.size}x${fx.size}`);
    const withT = fx.moves.filter((m) => m.T > 0 && m.r !== "G");
    const resolved = withT.filter((m) => Array.isArray(m.ks) && m.ks.length);
    if (withT.length && resolved.length < withT.length * 0.5) c2.fail(`${fx.id}: only ${resolved.length}/${withT.length} AI replies reproduce from T + 200k — the seed model or the record is wrong`);
    for (const ch of fx.checks ?? []) {
      c1.examined(1);
      const t0 = Date.now();
      let res;
      try {
        res = await R.playCheck(fx, { from: ch.from, work: ch.work ?? 1600, seed: ch.seed ?? 1 });
      } catch (e) {
        c2.fail(`${fx.id} from ply ${ch.from}: the replay threw`, String(e?.stack ?? e).slice(0, 300));
        continue;
      }
      const ms = Date.now() - t0;
      const line = res.line.map((l) => `${l.m}/${l.r}`).join(" ");
      const desc = `${fx.id} [${fx.status}] from ply ${ch.from}: ${res.won ? "WON" : "LOST"} ${res.black}-${res.white} (${ms}ms)`;
      if (res.won) won++;
      else lost++;
      if (fx.status === "fixed") {
        if (!res.won) c1.fail(`REGRESSION ${desc}`, `line ${line}${ch.why ? `\n      check: ${ch.why}` : ""}`);
        else c1.note(desc);
      } else {
        open++;
        if (res.won) c1.note(`${desc} — an OPEN case now wins: set its status to "fixed"`);
        else c1.warn(`open (known) loss: ${desc}`, `line ${line}`);
      }
    }
  }
  c1.note(`${fixture.cases.length} cases: ${won} checks won, ${lost} lost (${open} checks on open cases)`);
  return checks;
}
