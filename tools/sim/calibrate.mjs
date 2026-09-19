// Live measurements, and the CHECK reporter every decision-driving model runs
// before its conclusions.
//
//   node tools/sim/calibrate.mjs        run every live calibration, print errors
//
// Why this module exists. `build.mjs` bundles the game's real source, so a
// formula in `tools/sim/` cannot drift from the game any more. That closes one
// of the two ways an offline model lies. The other is still wide open: the
// INPUTS can be stale and the overall SCALE can be wrong while every formula is
// exactly right. Both of this project's fabricated-validation incidents were
// that second kind —
//
//   * the hand-written Go opponent that reported a 100% win rate for a solver
//     that then lost ten straight games in the real game: the formulas were
//     irrelevant, the opponent was a strawman;
//   * the 5-target synthetic server list that "failed" a target-count
//     validation: real data from the live save gave a different and correct
//     answer.
//
// So: a model that drives a decision has to reproduce a quantity the running
// game already displays, and print the error, before anybody reads its
// conclusions. `daedalus-plan.mjs` found a ~2.7x scale bug in itself that way.
//
// Everything here is READ-ONLY against the game: `.telemetry/` on disk plus
// getSaveFile/calculateRam over the daemon's control port.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, "../..");
export const TELEMETRY = path.join(REPO, ".telemetry");
export const CTL_PORT = 12526;

// --- the reporter ------------------------------------------------------------
//
// Same shape as verify-alloc-shipped.mjs / verify-batch.mjs: one line per
// check, a failure count, a non-zero exit. The difference is that a calibration
// check ALWAYS prints its error, pass or fail — an error of 0.4% and an error
// of 42% both need to be in front of the reader, and only one of them is
// visible if failures alone are printed.

let failures = 0;
let checks = 0;

export function check(ok, msg) {
  checks++;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`);
  return ok;
}

/** Signed relative error of a modelled value against a live measured one. */
export const relErr = (model, live) => (live === 0 ? (model === 0 ? 0 : Infinity) : model / live - 1);

/**
 * The core primitive. Prints `model vs live, err ±x% (tol y%)` whatever the
 * outcome, and records a failure when the error exceeds the tolerance.
 *
 * `tol` is a judgement about what would change the decision, not a hope. State
 * it in the caller next to the decision it protects.
 */
export function checkWithin(name, model, live, tol, fmt = (x) => String(x)) {
  const e = relErr(model, live);
  const ok = Number.isFinite(e) && Math.abs(e) <= tol;
  return check(
    ok,
    `${name}: model ${fmt(model)} vs live ${fmt(live)}  ` +
      `err ${e >= 0 ? "+" : ""}${(e * 100).toFixed(1)}%  (tol ${(tol * 100).toFixed(0)}%)`,
  );
}

/**
 * A model that cannot be calibrated must say so, out loud, every time it runs.
 * Silence reads as "checked and fine", which is exactly the state that produced
 * both fabricated validations.
 */
export function uncheckable(name, reason) {
  console.log(`  ----  ${name}: NOT CALIBRATED — ${reason}`);
}

export function report(what = "calibration") {
  // ZERO CHECKS IS NOT A PASS. "all 0 checks passed" reads as success and is
  // the exact opposite: nothing was compared against the live game, so every
  // number downstream is unverified. This is the "a check that stops testing
  // and still reports green" shape — and it appeared the moment a real check
  // was correctly downgraded to "could not cross-check", which is precisely
  // when a reader most needs to be told.
  //
  // Returns 0 either way: nothing FAILED, so callers that gate on failures are
  // right not to treat this as a failure. The obligation is to say so loudly,
  // not to invent one.
  if (!checks) {
    console.log(`\n!! ${what}: NOTHING WAS CHECKED — 0 comparisons ran against the live game.`);
    console.log(`   Every figure below is UNVERIFIED. Fix the inputs the NOT CALIBRATED lines name, then re-run.`);
    return failures;
  }
  console.log(`\n${failures ? `${failures}/${checks} ${what} CHECKS FAILED` : `all ${checks} ${what} checks passed`}`);
  return failures;
}

export const failureCount = () => failures;

// --- live measurements -------------------------------------------------------

export function telemetry(file) {
  const p = path.join(TELEMETRY, file);
  if (!fs.existsSync(p)) throw new Error(`no live measurement: ${p} missing (is the daemon connected and tel.js running?)`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Every save-derived sample the daemon has appended, oldest first. */
export function history() {
  const p = path.join(TELEMETRY, "history.jsonl");
  if (!fs.existsSync(p)) throw new Error(`no live measurement: ${p} missing`);
  const out = [];
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a partially flushed last line */
    }
  }
  return out;
}

/**
 * Measured reputation gain at a faction, in rep per second of GAME time.
 *
 * `totalPlaytime` is the clock the game's own `process(cycles)` runs on
 * (Work/FactionWork.tsx:49), so it is the right denominator: wall-clock
 * includes time the tab was throttled or the game was closed, and using it
 * silently understates the rate.
 *
 * Only consecutive samples where the player was working for `faction` count —
 * a window that spans a job change measures a mixture.
 */
/**
 * The faction the player is ACTUALLY working, newest sample first.
 *
 * Callers used to name the faction they cared about — daedalus-plan.mjs asked
 * for "Daedalus" or "BitRunners" — which makes the calibration unreachable
 * whenever the run is grinding anything else. Live in BitNode 5 the player was
 * working CyberSec with zero reputation at either hardcoded name, so the check
 * reported NOT CALIBRATED for ever and no amount of waiting could fix it: a
 * guard that cannot fire. The rate model is generic in level and favor, so the
 * faction it is measured against does not have to be the one being planned.
 */
export function workedFaction() {
  const rows = history();
  for (let i = rows.length - 1; i >= 0; i--) {
    const w = rows[i]?.currentWork;
    if (w?.type === "FactionWork" && w.faction) return w.faction;
  }
  return null;
}

export function measuredRepRate(faction, { minSeconds = 300, maxSamples = 60 } = {}) {
  const rows = [];
  for (const d of history()) {
    const f = d.factionRep?.[faction];
    if (!f) continue;
    rows.push({
      t: d.totalPlaytime,
      rep: f.rep,
      favor: f.favor,
      level: d.skills?.hacking ?? 1,
      working: d.currentWork?.faction === faction && d.currentWork?.type === "FactionWork",
      focused: d.focused !== false,
    });
  }
  // Walk back from the newest sample for as long as the player kept working
  // for this faction and reputation kept rising (an install would zero it).
  const seg = [];
  for (let i = rows.length - 1; i >= 0 && seg.length < maxSamples; i--) {
    if (!rows[i].working) break;
    if (seg.length && rows[i].rep > seg[seg.length - 1].rep) break;
    seg.push(rows[i]);
  }
  seg.reverse();
  if (seg.length < 2) return null;
  const a = seg[0];
  const b = seg[seg.length - 1];
  const seconds = (b.t - a.t) / 1000;
  if (seconds < minSeconds) return null;
  return { faction, seconds, samples: seg, rep0: a.rep, rep1: b.rep, repPerSec: (b.rep - a.rep) / seconds };
}

/**
 * Measured hacking experience per second of game time, from the level curve.
 *
 * `.telemetry/status.txt` also carries `ns.getTotalScriptExpGain()`, which is
 * the instantaneous rate from *scripts only*. The level curve is the one to
 * calibrate against because it includes every source (faction work pays hacking
 * exp too) and because it is what a model that projects levels forward is
 * actually predicting.
 */
export function measuredExpRate(hackMult, { minSeconds = 300, maxSamples = 60 } = {}) {
  const rows = history()
    .filter((d) => d.skills?.hacking)
    .slice(-maxSamples);
  if (rows.length < 2) return null;
  const a = rows[0];
  const b = rows[rows.length - 1];
  const seconds = (b.totalPlaytime - a.totalPlaytime) / 1000;
  if (seconds < minSeconds) return null;
  // src/PersonObjects/formulas/skill.ts:21 — inverse of calculateSkill.
  const expFor = (L) => Math.exp((L / hackMult + 200) / 32) - 534.6;
  return {
    seconds,
    level0: a.skills.hacking,
    level1: b.skills.hacking,
    expPerSec: (expFor(b.skills.hacking) - expFor(a.skills.hacking)) / seconds,
  };
}

/**
 * What `batch.js` is actually doing right now, per target.
 *
 * This is the strongest live measurement in the repo for anything about the
 * batcher, because the controller reports its OWN plan (`plan.gb`, `plan.h`,
 * `plan.g`) alongside what that plan actually earned. A model that reproduces
 * the plan but not the earnings has its formulas right and its throughput
 * wrong, which is a distinction no amount of source-reading can make.
 */
export function measuredBatch() {
  const bt = telemetry("batch.txt");
  const targets = bt.targets.map((t) => ({
    ...t,
    // Lifetime averages over `uptimeSec`: $/batch is stable, batchesPerMin
    // includes the prep phase before the first batch landed.
    moneyPerBatch: t.batches > 0 ? t.earned / t.batches : 0,
    dollarsPerSec: t.batches > 0 ? (t.earned / t.batches) * (t.batchesPerMin / 60) : 0,
    periodSecMeasured: t.batchesPerMin > 0 ? 60 / t.batchesPerMin : Infinity,
  }));
  return {
    ...bt,
    targets,
    dollarsPerSec: targets.reduce((a, t) => a + t.dollarsPerSec, 0),
    fleetGb: bt.ram.total,
  };
}

/**
 * The live PlayerSave, decoded.
 *
 * `world.mjs`'s snapshot deliberately carries only what the engine needs, so it
 * drops augmentation LEVELS — and NeuroFlux is priced off its level. Anything
 * that reasons about augmentations has to come here instead of remembering a
 * number. Read-only: getSaveFile does not consume the 24h export-favor bonus.
 */
export async function livePlayer() {
  const res = await fetch(`http://localhost:${CTL_PORT}/rpc`, {
    method: "POST",
    body: JSON.stringify({ method: "getSaveFile" }),
  });
  const { result, error } = await res.json();
  if (error) throw new Error(`getSaveFile: ${error}`);
  const zlib = await import("node:zlib");
  const raw = result.binary
    ? zlib.gunzipSync(Buffer.from(result.save, "latin1")).toString("utf8")
    : Buffer.from(result.save, "base64").toString("utf8");
  return JSON.parse(JSON.parse(raw).data.PlayerSave).data;
}

/** How many NeuroFlux levels are owned plus queued — the exponent of its cost. */
export const nfgLevel = (player) =>
  [...(player.augmentations ?? []), ...(player.queuedAugmentations ?? [])]
    .filter((a) => a.name === "NeuroFlux Governor")
    .reduce((m, a) => Math.max(m, a.level ?? 0), 0);

/** Worker RAM as the GAME prices it, not as a constant we remember. */
export async function liveWorkerRam(files = { hack: "h.js", grow: "g.js", weaken: "w.js" }) {
  const out = {};
  for (const [op, filename] of Object.entries(files)) {
    const res = await fetch(`http://localhost:${CTL_PORT}/rpc`, {
      method: "POST",
      body: JSON.stringify({ method: "calculateRam", params: { filename, server: "home" } }),
    });
    const { result, error } = await res.json();
    if (error) throw new Error(`calculateRam ${filename}: ${error}`);
    out[op] = result;
  }
  return out;
}

// --- runnable: every live calibration in the repo, in one place ---------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const { fetchSnapshot } = await import("./world.mjs");
  const w = await fetchSnapshot();
  const st = telemetry("status.txt");
  console.log(`live: BN${w.bitNode}, hacking ${w.player.hacking}, faction_rep x${w.player.mults.faction_rep.toFixed(4)}, home ${w.player.homeRam}GB/${w.player.homeCores} cores`);

  console.log("\n1. worker RAM (the constant the simulator priced 30% too cheap once)");
  const ram = await liveWorkerRam();
  console.log(`  h.js ${ram.hack}GB  g.js ${ram.grow}GB  w.js ${ram.weaken}GB   (game's own calculateRam)`);

  console.log("\n2. batcher throughput");
  const b = measuredBatch();
  console.log(`  ${b.targets.length} targets, fleet ${(b.fleetGb / 1e6).toFixed(2)}PB, uptime ${(b.uptimeSec / 3600).toFixed(2)}h`);
  console.log(`  measured $${(b.dollarsPerSec / 1e9).toFixed(1)}b/s  (batch.txt earnedPerSec $${(b.totals.earnedPerSec / 1e9).toFixed(1)}b/s)`);
  console.log(`  measured period per target: ${Math.min(...b.targets.map((t) => t.periodSecMeasured)).toFixed(2)}s .. ${Math.max(...b.targets.map((t) => t.periodSecMeasured)).toFixed(2)}s`);

  console.log("\n3. reputation");
  const rep = measuredRepRate("Daedalus") ?? measuredRepRate("BitRunners");
  if (rep) console.log(`  ${rep.faction}: ${rep.repPerSec.toFixed(2)} rep/s over ${rep.seconds.toFixed(0)}s of game time`);
  else console.log("  no faction-work window in history.jsonl");

  console.log("\n4. experience");
  const exp = measuredExpRate(w.player.mults.hacking);
  if (exp) console.log(`  ${exp.expPerSec.toExponential(3)} exp/s from the level curve (${exp.level0} -> ${exp.level1} over ${exp.seconds.toFixed(0)}s)`);
  console.log(`  ${st.expPerSec.toExponential(3)} exp/s from ns.getTotalScriptExpGain() (scripts only)`);

  console.log("\nThese are the measurements the models must reproduce. Run the models themselves for the CHECK lines:");
  console.log("  node tools/sim/daedalus-plan.mjs");
  console.log("  node tools/sim/target-count.mjs");
  console.log("  node tools/sim/verify-alloc-shipped.mjs");
  process.exit(0);
}
