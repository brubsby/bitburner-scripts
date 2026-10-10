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
// `presend` W: the solver ponders W work under each of our moves (from ply
// from-1) and plays its pre-sent answer to the AI's reply, as live does; `gaps`
// true: the clock seeds replies a turn ahead by the case's own play cadence
// (golib clockSeed gaps, measured negative live: off in go-solver);
// `liveTree` true: the forced plies before `from` grow the tree as live did
// (searched or pre-sent, the ponder from ply 0), so the check ply sees live's
// stale nodes (go-regress playCheck liveTree).
//
//   GL1 every case marked `fixed` is still WON from each of its checks (FAIL
//       if not: a regression); every `open` case is reported (WARN while
//       lost, a note when it starts winning — promote it to fixed).
//   GL2 the corpus is well-formed: each case replays legally from its start
//       layout, and a live case logged with playtimes resolves its seeds.
//
// Adding a live loss:  node tools/sim/go-fixture.mjs --at <its `at`>
// (or --loss 1 for the latest; --harness f.jsonl for a go-w0 --trace loss).
//
// COST (2026-10-09: ~200s of CPU, the suite's second most expensive module).
// The replays run on worker threads (tools/sim/go-regress-pool.mjs, each one
// deterministic and independent; BB_TEST_JOBS=1 runs them in this thread).
// THE SLOW TIER: a check marked `"tier": "slow"` in the fixture, every check
// of an `open` case (a WARN either way), and GL5/GL6/GL7 are skipped by
// `run.mjs --quick` and printed as SKIPPED; `npm test` runs them all. A
// fixed case must keep at least one check outside the slow tier (GL2), and
// that check must be one that goes RED on the bug the case was fixed for —
// the seeds that stayed green under the old behaviour are the slow ones
// (measured 2026-10-09 by replaying every check with each fix turned off).

import fs from "node:fs";
import path from "node:path";
import { Check, QUICK } from "./harness.mjs";
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
    same("open-pass-visits", list(dflt("open-pass-visits")).split(",").filter((s) => s && s !== "none").join(","), [...R.OPEN_PASS_VISITS].sort().join(","));
    same("prior-floor-on", floors(dflt("prior-floor-on")), [...R.PRIOR_FLOOR_ON].map(([o, e]) => `${o}:${e}`).sort().join(","));
    same("late-cap-on", floors(dflt("late-cap-on")), [...R.LATE_CAP_ON].map(([o, e]) => `${o}:${e}`).sort().join(","));
    await R.regressEnv();
  } catch (e) {
    c1.warn("the opponent model could not load — the corpus did NOT run", String(e?.message ?? e).slice(0, 200));
    return checks;
  }
  const fixture = JSON.parse(fs.readFileSync(FIXTURE, "utf8"));
  if (!Array.isArray(fixture.cases) || !fixture.cases.length) c2.fail("the corpus is empty", FIXTURE);
  const { makePool } = await import("../sim/go-regress-pool.mjs");
  const pool = makePool();
  const optsOf = (ch) => ({ from: ch.from, work: ch.work ?? 1600, seed: ch.seed ?? 1, ...(ch.pre ? { pre: ch.pre } : {}), ...(ch.pondered ? { pondered: ch.pondered } : {}), ...(ch.presend ? { presend: ch.presend } : {}), ...(ch.gaps ? { gaps: ch.gaps } : {}), ...(ch.liveTree ? { liveTree: true } : {}) });
  // Every replay is queued first (the pool runs them in parallel), then
  // reported in fixture order, so the output reads the same at any job count.
  const jobs = [];
  let skipped = 0;
  for (const fx of fixture.cases) {
    c2.examined(1);
    for (const k of ["id", "opponent", "size", "komi", "start", "moves", "checks", "status"]) if (fx[k] === undefined) c2.fail(`${fx.id ?? "?"}: missing ${k}`);
    if (fx.start?.length !== fx.size * fx.size) c2.fail(`${fx.id}: start layout is not ${fx.size}x${fx.size}`);
    const withT = fx.moves.filter((m) => m.T > 0 && m.r !== "G");
    const resolved = withT.filter((m) => Array.isArray(m.ks) && m.ks.length);
    if (withT.length && resolved.length < withT.length * 0.5) c2.fail(`${fx.id}: only ${resolved.length}/${withT.length} AI replies reproduce from T + 200k — the seed model or the record is wrong`);
    for (const ch of fx.checks ?? []) if (ch.tier !== undefined && ch.tier !== "slow") c2.fail(`${fx.id} from ply ${ch.from}: unknown tier ${JSON.stringify(ch.tier)} (only "slow")`);
    // The quick dev loop guards a fixed case only through a check outside the slow tier.
    if (fx.status === "fixed" && !(fx.checks ?? []).some((ch) => ch.tier !== "slow")) c2.fail(`${fx.id}: every check is in the slow tier — keep at least one (one that is red on the old behaviour) in the quick tier`);
    for (const ch of fx.checks ?? []) {
      if (QUICK && (ch.tier === "slow" || fx.status !== "fixed")) {
        skipped++;
        continue;
      }
      c1.examined(1);
      jobs.push({ fx, ch, p: pool.run(fx, optsOf(ch)).then((res) => ({ res, ms: res.ms }), (e) => ({ e })) });
    }
  }
  if (skipped) c1.skip(skipped, "corpus checks marked slow, or on open cases");
  // GL5/GL6/GL7 (slow tier): their replays are queued now, beside GL1's.
  const settle = (p) => p.then((res) => ({ res }), (e) => ({ e }));
  const nb = fixture.cases.find((c) => c.id === "live-2026-10-09T17:24:13.315Z-Netburners");
  const gl5 = QUICK || !nb ? [] : nb.checks.filter((x) => x.from === 8).map((ch) => ({ ch, off: settle(pool.run(nb, { from: ch.from, work: ch.work, seed: ch.seed, presend: ch.presend, openPass: "allow" })) }));
  const dl = fixture.cases.find((c) => c.id === "live-2026-10-09T20:52:10.371Z-Daedalus");
  const gl6 = QUICK || !dl ? [] : dl.checks.filter((x) => x.liveTree).map((ch) => ({ ch, off: settle(pool.run(dl, { from: ch.from, work: ch.work, seed: ch.seed, presend: ch.presend, liveTree: true, nnOver: { lateCap: -1 } })), on: settle(pool.run(dl, { from: ch.from, work: ch.work, seed: ch.seed, presend: ch.presend, liveTree: true, nnOver: { lateCap: 16 } })) }));
  const il = fixture.cases.find((c) => c.id === "live-2026-10-09T22:10:40.965Z-Illuminati");
  const GAME_RULE = { secondRule: "game", secondRoot: "game" };
  const gl7 = QUICK || !il ? [] : il.checks.map((ch) => ({ ch, on: settle(pool.run(il, { ...optsOf(ch), cheatPolicy: GAME_RULE })) }));
  let won = 0, lost = 0, open = 0;
  for (const { fx, ch, p } of jobs) {
    const { res, ms, e } = await p;
    if (e) {
      c2.fail(`${fx.id} from ply ${ch.from}: the replay threw`, String(e?.stack ?? e).slice(0, 300));
      continue;
    }
    const line = res.line.map((l) => `${l.m}/${l.r}`).join(" ");
    const desc = `${fx.id} [${fx.status}] from ply ${ch.from}${ch.seed ? ` seed ${ch.seed}` : ""}${ch.tier ? " (slow)" : ""}: ${res.won ? "WON" : "LOST"} ${res.black}-${res.white} (${ms}ms)`;
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
  c1.note(`replayed on ${pool.jobs} worker thread(s)`);
  c1.note(`${fixture.cases.length} cases: ${won} checks won, ${lost} lost (${open} checks on open cases)`);
  // (GL4, golib nn.priorFloor 0.1 winning the 14:56:31Z Daedalus case, was
  // removed 2026-10-09: the floor is off live — go-solver --prior-floor-on
  // "none", GL3 holds go-regress to it — so it guarded code no game runs.
  // Turning the floor on brings that case back under GL1 through the nets.)
  // GL5: the 17:24:13Z Netburners case's ply-8 check, replayed under the
  // OLD open-pass rule (openPass 'allow'): the ponder pre-sends a PASS on an
  // open board and the game is lost 9-13.5 as live. Red before the fix, so
  // GL1's green on this case is the fix's, not the replay's.
  const c5 = new Check("GL5", "the 2026-10-09 17:24:13Z Netburners case: under the old open-pass rule the replayed ponder pre-sends an open-board PASS at ply 8 and loses (openPass 'visits' is what wins it)");
  checks.push(c5);
  if (!nb) c5.fail("the case is not in the corpus");
  else if (QUICK) c5.skip(nb.checks.filter((x) => x.from === 8).length, "the old-rule ('allow') replay of the ply-8 check");
  else
    for (const { ch, off: p } of gl5) {
      c5.examined(1);
      const { res: off, e } = await p;
      if (e) {
        c5.fail(`seed ${ch.seed}: the replay threw`, String(e?.stack ?? e).slice(0, 300));
        continue;
      }
      const d = off.decisions.find((x) => x.ply === ch.from);
      if (off.won || d?.mv !== "P") c5.warn(`seed ${ch.seed} presend ${ch.presend}: under 'allow' the replay no longer pre-sends PASS and loses (${d?.mv}, ${off.won ? "WON" : "LOST"} ${off.black}-${off.white}) — the bug's reproduction drifted`);
      else c5.note(`seed ${ch.seed} presend ${ch.presend}: 'allow' -> ${d.mv}${d.pre ? " (pre-sent)" : ""}, LOST ${off.black}-${off.white}`);
    }
  // GL6: the 20:52:10Z Daedalus case (open): its ply-2 checks still reproduce
  // live — without the late-prior cap the ponder pre-sends the stale 4,3 and
  // the game is lost 0-27.5 — and the cap (golib nn.lateCap 16, measured
  // neutral and off) still wins them, so the option keeps doing what it was
  // built for. (Slow tier. Like the removed GL4 it guards an option that is
  // off live; kept while the late-cap work is current.)
  const c6 = new Check("GL6", "the 2026-10-09 20:52:10Z Daedalus case: without the late-prior cap the replayed ponder pre-sends the stale 4,3 at ply 2 and loses; nn.lateCap 16 wins it");
  checks.push(c6);
  if (!dl) c6.fail("the case is not in the corpus");
  else if (QUICK) c6.skip(2 * dl.checks.filter((x) => x.liveTree).length, "the cap off/on replays of the liveTree checks");
  else
    for (const { ch, off: pOff, on: pOn } of gl6) {
      c6.examined(1);
      const { res: off, e: e1 } = await pOff;
      const { res: on, e: e2 } = await pOn;
      if (e1 || e2) {
        c6.fail(`seed ${ch.seed} presend ${ch.presend}: the replay threw`, String((e1 ?? e2)?.stack ?? e1 ?? e2).slice(0, 300));
        continue;
      }
      const d = off.decisions.find((x) => x.ply === ch.from);
      if (off.won || d?.mv !== "4,3") c6.warn(`seed ${ch.seed} presend ${ch.presend}: with the cap off the replay no longer pre-sends 4,3 and loses (${d?.mv}, ${off.won ? "WON" : "LOST"} ${off.black}-${off.white}) — the bug's reproduction drifted`);
      else c6.note(`seed ${ch.seed} presend ${ch.presend}: cap off -> ${d.mv}${d.pre ? " (pre-sent)" : ""}, LOST ${off.black}-${off.white}`);
      if (!on.won) c6.fail(`seed ${ch.seed} presend ${ch.presend}: lateCap 16 LOST ${on.black}-${on.white}`, `line ${on.line.map((l) => `${l.m}/${l.r}`).join(" ")}`);
      else c6.note(`seed ${ch.seed} presend ${ch.presend}: lateCap 16 WON ${on.black}-${on.white}`);
    }
  // GL7: the 22:10:40Z Illuminati case (open): live's valid-list second
  // stone has no 2,1+1,0 at ply 6 and GL1 loses it as live did; the game's
  // own pair rule (go.js SETTINGS.cheat.secondRule 'game' + secondRoot
  // 'game', measured not paid and off) wins every check. (Slow tier: it
  // guards an option that is off live, kept while the cheat work is current.)
  const c7 = new Check("GL7", "the 2026-10-09 22:10:40Z Illuminati case: the game's second-stone rule (secondRule/secondRoot 'game', off live) plays 2,1+1,0 at ply 6 and wins every check");
  checks.push(c7);
  if (!il) c7.fail("the case is not in the corpus");
  else if (QUICK) c7.skip(il.checks.length, "the game-rule replays of its checks");
  else
    for (const { ch, on: p } of gl7) {
      c7.examined(1);
      const { res, e } = await p;
      if (e) c7.fail(`seed ${ch.seed ?? 1} work ${ch.work}: the replay threw`, String(e?.stack ?? e).slice(0, 300));
      else if (!res.won) c7.fail(`seed ${ch.seed ?? 1} work ${ch.work}: the game's rule LOST ${res.black}-${res.white}`, `line ${res.line.map((l) => `${l.m}/${l.r}`).join(" ")}`);
      else c7.note(`seed ${ch.seed ?? 1} work ${ch.work}: game rule WON ${res.black}-${res.white}`);
    }
  await pool.close();
  return checks;
}
