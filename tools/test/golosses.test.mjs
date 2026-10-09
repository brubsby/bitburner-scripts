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
// A check may carry `pre` {x, y, wr}: the check ply's single as live had it
// (a pre-sent answer and its win rate), so the cheat policy decides on live's
// own inputs; and `pondered`: work the check ply's root already held.
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
  const c3 = new Check("GL3", "the corpus replays with the solver's nets as go-solver.mjs configures them (go-regress mirrors its defaults)");
  checks.push(c1, c2, c3);
  let R;
  try {
    R = await import("../sim/go-regress.mjs");
    // GL3: go-solver.mjs is a running process, not a module to import, so its
    // defaults are read off its source; a drift replays the corpus under a
    // configuration live never plays (a case green here, red live).
    const src = fs.readFileSync(path.join(REPO, "tools", "go-solver.mjs"), "utf8");
    const dflt = (flag) => {
      const m = src.match(new RegExp(`str\\("${flag}", "([^"]*)"\\)`));
      if (!m) c3.fail(`go-solver.mjs: no default found for --${flag}`);
      return m ? m[1] : "";
    };
    const list = (v) => v.split(",").map((s) => s.trim().replace(/\s+/g, "")).filter(Boolean).sort().join(",");
    const same = (name, solver, mirror) => {
      c3.examined(1);
      if (solver !== mirror) c3.fail(`${name}: go-solver.mjs default "${solver}" but go-regress.mjs mirrors "${mirror}"`);
      else c3.note(`${name}: ${solver || "(none)"}`);
    };
    same("smallnet-on", list(dflt("smallnet-on")), [...R.SMALLNET_ON].sort().join(","));
    same("smallnet-outcome-on", list(dflt("smallnet-outcome-on")), [...R.OUTCOME_ON].sort().join(","));
    const floors = (v) => list(v).split(",").filter((s) => s && s !== "none").map((s) => s.split(":")).map(([o, e]) => `${o}:${Number(e)}`).sort().join(",");
    same("prior-floor-on", floors(dflt("prior-floor-on")), [...R.PRIOR_FLOOR_ON].map(([o, e]) => `${o}:${e}`).sort().join(","));
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
        res = await R.playCheck(fx, { from: ch.from, work: ch.work ?? 1600, seed: ch.seed ?? 1, ...(ch.pre ? { pre: ch.pre } : {}), ...(ch.pondered ? { pondered: ch.pondered } : {}) });
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
  // GL4: the prior floor (golib nn.priorFloor, measured negative as a default
  // and off) still does what it was built for: the 14:56:31Z Daedalus case,
  // lost by the live solver at ply 2, is won with the floor at 0.1.
  const c4 = new Check("GL4", "golib nn.priorFloor 0.1 wins the 2026-10-09 14:56:31Z Daedalus case from ply 2 (the live solver, floor off, loses it)");
  checks.push(c4);
  const fl = fixture.cases.find((c) => c.id === "live-2026-10-09T14:56:31.081Z-Daedalus");
  if (!fl) c4.fail("the case is not in the corpus");
  else
    for (const seed of [1, 2]) {
      c4.examined(1);
      const off = await R.playCheck(fl, { from: 2, work: 800, seed, nnOver: { priorFloor: 0 } });
      const on = await R.playCheck(fl, { from: 2, work: 800, seed, nnOver: { priorFloor: 0.1 } });
      if (off.won) c4.warn(`seed ${seed}: the floor-off replay now WINS ${off.black}-${off.white} — promote the case to fixed`);
      if (!on.won) c4.fail(`seed ${seed}: floor 0.1 LOST ${on.black}-${on.white}`, `line ${on.line.map((l) => `${l.m}/${l.r}`).join(" ")}`);
      else c4.note(`seed ${seed}: floor off ${off.won ? "WON" : "LOST"} ${off.black}-${off.white}, floor 0.1 WON ${on.black}-${on.white}`);
    }
  return checks;
}
