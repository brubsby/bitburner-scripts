// [B2] RAM budget by stage.
//
// The collection was written and measured on one save: BitNode 1, Source-File
// 1, home grown to terabytes. None of those are properties of the collection —
// they are properties of that afternoon. This check prices every root script
// with the game's own calculator and asserts the stack is viable at each home
// RAM a BitNode can actually START at, and under each Source-File 4 pricing
// regime.
//
// Home RAM at BitNode entry is not one number (Prestige.ts:242-248):
//     SF9 >= 2 -> 128GB     SF1 >= 1 -> 32GB     otherwise -> 8GB
// The 8GB case has never been run here, because this save has always had SF1.
//
// Singularity RAM is not one number either (RamCostGenerator.ts:82-96): inside
// BitNode 4 it is base price, elsewhere SF4.1 costs 16x and SF4.2 costs 4x. The
// whole autonomous stack in docs/autonomy.md is designed against the BN4 price,
// so every one of those scripts has an untested 16x version of itself.

import { Check, fmt } from "./harness.mjs";
import { load, asSave, ramOf, rootScripts, priceAll, priceCode, source, codeOnly, importsOf, calibrate, pricedNames, declaredNames, singularityNames } from "./ram.mjs";

/** Prestige.ts:242-248. Verified against game source by check B. */
export const ENTRY_TIERS = [
  { ram: 8, why: "no SF1 and no SF9.2 — a virgin BitNode entry" },
  { ram: 32, why: "SF1 owned (this save)" },
  { ram: 128, why: "SF9 level 2+ owned" },
];
/** Home doublings that cost money but arrive early. Not entry conditions. */
const GROWTH_TIERS = [64, 256, 1024];

/**
 * What "bootstrap and earn" actually requires, as roles rather than filenames,
 * so the check measures the capability and not one particular script.
 *
 * Justification for each, because a budget test is only as good as its budget:
 *  - launch:  something has to start the stack after an install. The autoexec
 *             does NOT fire after a prestige (NetscriptWorker.ts:247), so this
 *             is typed by hand and must be runnable at the entry tier.
 *  - earn:    a hacking driver. Without one nothing ever generates money or
 *             hacking experience and the life cannot progress at all.
 *  - workers: the driver needs free RAM to place operations in. A driver with
 *             zero headroom is a process watching an idle machine.
 *
 * MIN_OPS = 4 is not a taste judgement. One HGW batch is four concurrent
 * operations — hack, weaken, grow, weaken (batch.js:365-366 sizes exactly two
 * weakens per batch, one against the hack's +0.002 and one against the grow's
 * +0.004). Fewer than four concurrent op slots cannot hold a single complete
 * batch, so the pipeline the whole collection is built around does not exist.
 * For a self-threaded loop like early.js the same number is four parallel
 * threads of whichever op the loop is currently in.
 */
const ROLES = {
  launch: ["boot.js"],
  // `threaded: true` = the script IS the worker and is run with -t N.
  // `threaded: false` = a controller that stays resident and execs h/g/w.
  earn: [
    // Candidate implementations of the role, cheapest-viable-first at run time.
    // A script that is not deployed yet prices as Infinity and simply sorts
    // last, so listing one here can never make this check easier.
    //
    // hgw.js is the 8GB answer and exists for one reason: 1.60 base + hack 0.10
    // + grow 0.15 + weaken 0.15 = 2.00GB is the floor for ANY self-threaded HGW
    // loop, and 4 x 2.00 is exactly 8GB. early.js reads four server-state
    // functions at 0.10 each, which is why four threads of it need 9.60GB and
    // cannot bootstrap a virgin BitNode.
    { script: "hgw.js", threaded: true },
    { script: "early.js", threaded: true },
    { script: "auto.js", threaded: false },
    { script: "batch.js", threaded: false },
    { script: "hack.js", threaded: false },
  ],
  worker: ["h.js", "g.js", "w.js"],
};
const MIN_OPS = 4;

/** SF4 pricing regimes. Each is a real save state someone can be in. */
const REGIMES = [
  { id: "BN4/noSF", bitNode: 4, sf: {}, why: "inside BitNode 4 — singularity at base price, no Source-File (docs/autonomy.md)" },
  { id: "SF4.1", bitNode: 1, sf: { 4: 1 }, why: "SF4 level 1 outside BN4 — singularity costs 16x" },
  { id: "SF4.2", bitNode: 1, sf: { 4: 2 }, why: "SF4 level 2 — 4x" },
  { id: "SF4.3", bitNode: 1, sf: { 4: 3 }, why: "SF4 level 3 — 1x" },
  { id: "noSF4", bitNode: 1, sf: {}, why: "no SF4 at all — calls throw, but RAM is still charged statically at 16x" },
];

/**
 * Scripts boot.js starts, parsed out of boot.js rather than duplicated.
 *
 * Entries may carry a `tier` (smallest home RAM at which boot.js considers the
 * entry worth its RAM) and an `until` (home RAM at which it is retired). An
 * entry with NO tier is treated as "wanted at every home size", which is what a
 * flat list means and keeps this identical for a boot.js that has not been
 * tiered. Pass `tier` to get the set boot.js would actually pin at that home
 * size — asking a tiered launcher for "the whole list" and then testing it
 * against an 8GB home is asking the wrong question.
 */
export function bootStack(where, tier) {
  const src = source("boot.js");
  const start = src.indexOf("const STACK = [");
  if (start < 0) return [];
  const block = src.slice(start, src.indexOf("\n]", start));
  const out = [];
  // Split on entry boundaries so per-entry fields cannot bleed across entries.
  for (const chunk of block.split(/\{\s*(?=script:)/).slice(1)) {
    const script = /^script:\s*'([^']+)'/.exec(chunk)?.[1];
    const w = /where:\s*'([^']+)'/.exec(chunk)?.[1];
    if (!script || !w) continue;
    const t = /(?:^|\n)\s*tier:\s*(\d+)/.exec(chunk);
    const u = /(?:^|\n)\s*until:\s*(\d+)/.exec(chunk);
    const role = /(?:^|\n)\s*role:\s*'([^']+)'/.exec(chunk)?.[1] ?? null;
    const kind = /(?:^|\n)\s*kind:\s*'([^']+)'/.exec(chunk)?.[1] ?? null;
    const entry = { script, where: w, role, kind, tier: t ? Number(t[1]) : null, until: u ? Number(u[1]) : null };
    if (where && entry.where !== where) continue;
    if (tier != null && entry.tier != null && tier < entry.tier) continue;
    if (tier != null && entry.until != null && tier >= entry.until) continue;
    out.push(entry);
  }
  return out;
}

export async function run() {
  await load();
  return [await budgetCheck(), phantomCheck()];
}

/**
 * B1 — no identifier collides with a priced name in the ns cost tree.
 *
 * Netscript does not price `ns.codingcontract.attempt`; it prices the *name*
 * `attempt`, wherever it appears, including as a local variable
 * (RamCalculations.ts:407 adds every Identifier node; findFunc at :225-243
 * matches by bare name against the whole RamCosts tree). A local called
 * `attempt` therefore costs 10GB, and a local called `probe` costs 0.2GB via
 * `dnet.probe`. Both have happened in this repo, which makes this systemic
 * rather than a curiosity.
 *
 * This does NOT re-derive the rule — it intersects the declarations acorn finds
 * with the cost tree the game itself exports, so it cannot disagree with the
 * game about what a name costs.
 */
function phantomCheck() {
  const c = new Check("B1", "no local identifier collides with a priced ns name (invariant B1)");
  asSave(REGIMES[0]);
  const priced = pricedNames();

  // SELF-TEST. A detector that has never fired is indistinguishable from a
  // detector that cannot fire, and "0 collisions found" is exactly what a
  // broken one prints. Feed it the two cases this repo has actually hit.
  for (const [ident, expect] of [["attempt", 10], ["probe", 0.2]]) {
    const withIt = priceCode(`export async function main(ns) { const ${ident} = 1; ns.tprint(${ident}) }`);
    const without = priceCode(`export async function main(ns) { const zz_${ident} = 1; ns.tprint(zz_${ident}) }`);
    const delta = Math.round((withIt.cost - without.cost) * 100) / 100;
    c.note(`self-test: a local named \`${ident}\` costs ${fmt.gb(delta)} (expected ${fmt.gb(expect)})`);
    if (Math.abs(delta - expect) > 1e-9) {
      c.fail(`B1 self-test failed: local \`${ident}\` priced at ${delta}GB, expected ${expect}GB`, "the collision detector cannot be trusted this run");
    }
    if (!priced.has(ident) || Math.abs(priced.get(ident) - expect) > 1e-9) {
      c.fail(`B1 self-test failed: \`${ident}\` not in the flattened cost tree at ${expect}GB`, `got ${priced.get(ident)}`);
    }
  }
  // "Stacked" = something boot.js or watchdog.js actually runs, plus everything
  // those scripts import. golib.js is never run directly but every byte of it
  // is billed to go.js, which the watchdog restarts every 30s.
  const roots = [...bootStack().map((e) => e.script), ...watchdogStack(), ...ROLES.worker, ...ROLES.earn.map((e) => e.script)];
  const stacked = new Set();
  for (const r of roots) for (const dep of importsOf(r)) stacked.add(dep);
  c.note(`ns cost tree flattened to ${priced.size} priced bare names (the hazard list for a variable name)`);

  let hits = 0;
  for (const name of rootScripts()) {
    const d = declaredNames(name);
    c.examined(1);
    if (!d || d.error) continue;
    // Price the source with any ramOverride STRIPPED.
    //
    // An override replaces the computed cost outright, so `ramOf()` on a file
    // that declares one reports the declared number and an entry list that no
    // longer mentions the collision — B1 would go quietly blind on exactly the
    // scripts most likely to have one. Measured: a local named `grow` in a
    // script declaring 1.6GB prices at 1.60GB with the override and 11.75GB
    // without it.
    //
    // The collision is genuinely free while the override stands, so this is not
    // a cost we are failing to see. It matters because the RAISE ceiling is the
    // full static price: a collision inflates what the script must ask the host
    // for at runtime, and a denied raise is a dead script (ramOverride returns
    // the old allocation silently rather than throwing).
    const rawSrc = source(name) ?? "";
    const hasOverride = /ramOverride\s*\(/.test(rawSrc);
    const entries = hasOverride
      ? (priceCode(rawSrc.replace(/^\s*ns\s*\.\s*ramOverride\s*\([^)]*\)\s*;?\s*$/m, ""), name).entries ?? [])
      : (ramOf(name).entries ?? []);
    // Entry names are dotted paths ("codingcontract.attempt"); the collision is
    // on the LAST segment, because that is the bare name findFunc matched.
    const pricedHere = new Set(entries.map((e) => e.name.split(".").pop()));
    const code = codeOnly(name);
    for (const [ident, kind] of d.found) {
      const cost = priced.get(ident);
      if (!cost || !pricedHere.has(ident)) continue;
      hits++;
      // Is it also reached as a real ns member somewhere in this file? If so the
      // cost is paid regardless and the collision is latent rather than live —
      // but it still means deleting the real call will not recover the RAM.
      // Rooted at `ns.` deliberately: `scratch.probe` is NOT a call to
      // ns.dnet.probe, and matching any `.name` made golib.js's phantom 0.2GB
      // look already-paid.
      const real = new RegExp(`\\bns\\s*\\.[\\w.\\s]*\\b${ident}\\b`).test(code);
      const what = `${name}: ${kind} \`${ident}\` is priced at ${fmt.gb(cost)}`;
      const detail = real
        ? `also used as a real member call here, so the RAM is already paid — but the name now pins that cost even if the call is removed.`
        : `PHANTOM: nothing in ${name} calls this API. ${fmt.gb(cost)} of its ${fmt.gb(ramOf(name).cost)} is this name alone. Rename the identifier.`;
      if (!real && stacked.has(name)) c.fail(what, detail);
      else c.warn(what, detail);
    }
  }
  c.note(`${hits} identifier/ns-name collisions across ${rootScripts().length} root scripts`);
  return c;
}

async function budgetCheck() {
  const c = new Check("B2", "RAM budget by stage — every home size a BitNode can start at (invariants B2, B3, B6)");

  /* -- calibration first. An uncalibrated calculator is a fabricated result. */
  const sample = ["boot.js", "batch.js", "go.js", "cmd.js", "watchdog.js", "status.js", "lock.js", "upkeep.js", "nfg.js", "buyserv.js"];
  const cal = await calibrate(sample);
  if (!cal.calibrated) {
    c.note(`CALIBRATION: *** UNCALIBRATED *** — ${cal.reason}`);
    c.note("            offline RAM figures below are UNVERIFIED against the running game.");
    c.warn("RAM calculator not checked against the live game this run", cal.reason);
  } else {
    let worst = 0;
    const bad = [];
    for (const r of cal.rows) {
      if (r.live == null) { bad.push(`${r.name}: live calculateRam failed (${r.note})`); continue; }
      worst = Math.max(worst, r.err);
      if (r.err > 1e-9) bad.push(`${r.name}: offline ${r.mine} vs live ${r.live} (${fmt.pct(r.err)})`);
    }
    c.note(
      `CALIBRATION: ${cal.rows.length} scripts vs live game (BN${cal.state.bitNode}, SF ${JSON.stringify(cal.state.sourceFiles?.data ?? [])}) — max error ${fmt.pct(worst)}`,
    );
    for (const r of cal.rows) if (r.live != null) c.note(`   ${r.name.padEnd(14)} offline ${String(r.mine).padStart(7)}  live ${String(r.live).padStart(7)}`);
    if (bad.length) c.fail("offline RAM calculator disagrees with the running game", bad.join("\n"));
  }

  /* -- price everything under every regime ------------------------------- */
  // Only singularity costs vary with SF4 level, so price the whole collection
  // once and reprice just the singularity-touching scripts per regime. Same
  // answer, ~5x less work, which is what keeps this runnable on every save.
  asSave(REGIMES[0]);
  const base = priceAll();
  const singNames = singularityNames();
  const varies = [...base].filter(([, r]) => (r.entries ?? []).some((e) => singNames.has(e.name.split(".").pop()) && e.name.startsWith("singularity."))).map(([n]) => n);
  const byRegime = new Map([["BN4/noSF", base]]);
  for (const reg of REGIMES.slice(1)) {
    asSave(reg);
    byRegime.set(reg.id, priceAll(varies));
  }
  asSave(REGIMES[0]);
  c.examined(rootScripts().length + varies.length * (REGIMES.length - 1));

  // Parse errors are a hard failure at any RAM: the script cannot be run at all.
  for (const [name, r] of base) if (r.error) c.fail(`${name} does not price at all`, r.error);

  /* -- B2.1..B2.4: viability at each entry tier ------------------------------ */
  // Priced in the regime that makes the collection look BEST (BN4 base
  // pricing). If it does not fit there it fits nowhere.
  const ram = (n) => base.get(n)?.cost ?? Infinity;
  const launcher = "boot.js";
  const launchRam = ram(launcher);
  const workerRam = Math.max(...ROLES.worker.map(ram));

  /** RAM for a complete minimal earning configuration built on `e`. */
  const earnCost = (e) => (e.threaded ? ram(e.script) * MIN_OPS : ram(e.script) + workerRam * MIN_OPS);
  const earners = ROLES.earn.map((e) => ({ ...e, ram: ram(e.script), total: earnCost(e) })).sort((a, b) => a.total - b.total);
  const best = earners[0];

  c.note(`launcher ${launcher} ${fmt.gb(launchRam)}; worker (max of h/g/w) ${fmt.gb(workerRam)}; MIN_OPS ${MIN_OPS} (one complete HGW batch)`);
  for (const e of earners) {
    if (!Number.isFinite(e.ram)) {
      c.note(`  earner ${e.script.padEnd(10)}    (not deployed — no root ${e.script}, so this role has no such candidate today)`);
      continue;
    }
    c.note(
      `  earner ${e.script.padEnd(10)} ${fmt.gb(e.ram).padStart(9)} ` +
        (e.threaded ? `x${MIN_OPS} threads` : `+ ${MIN_OPS} workers`) +
        ` = ${fmt.gb(e.total)}`,
    );
  }

  const fullHomeStack = bootStack("home");
  const homeSum = fullHomeStack.reduce((s, e) => s + ram(e.script), 0);
  const tiered = fullHomeStack.some((e) => e.tier != null);
  c.note(
    tiered
      ? `boot.js's STACK is TIERED: ${fullHomeStack.length} home-pinned entries carry a tier, so B2.2/B2.4 below are asked of the set boot.js would actually pin at each home size`
      : `boot.js's STACK is a FLAT LIST: all ${fullHomeStack.length} home-pinned entries are wanted at every home size, including 8GB`,
  );

  // Does the launcher LEAVE before its worker starts?
  //
  // This is not a detail — it decides whether the launcher's own RAM is part of
  // the worker's budget. ns.exec launches into a home that still contains the
  // launcher; ns.spawn kills the caller and then launches
  // (NetscriptFunctions.ts:644-650, killWorkerScript then spawnCb, immediately
  // when spawnDelay is 0). On an 8GB home that is 3.80GB free versus 8.00GB,
  // one worker thread versus four.
  //
  // Read out of boot.js's own source rather than assumed, so a boot.js that
  // goes back to ns.exec is measured as the resident launcher it then is.
  const bootSrc = source("boot.js") ?? "";
  const spawnsWorker = /\bns\.spawn\(/.test(bootSrc) && fullHomeStack.some((e) => e.role === "worker");
  c.note(
    spawnsWorker
      ? "boot.js SPAWNS its worker (ns.spawn kills the caller first), so the launcher is not co-resident with it — B2.4 below is the transient peak while boot exec's the daemons, and B2.4b is the steady state after it is gone"
      : "boot.js is RESIDENT for its whole launch loop, so every exec happens with (home - boot.js) free",
  );

  for (const tier of ENTRY_TIERS) {
    const T = tier.ram;
    const tag = `${T}GB (${tier.why})`;
    // What boot.js would pin to home AT THIS HOME SIZE. For an untiered list
    // this is the whole list, so nothing about the check changes until boot.js
    // actually starts declaring tiers.
    const homeStack = bootStack("home", T);
    // Split by HOW it is started, because that decides what it competes with.
    const spawnSet = spawnsWorker ? homeStack.filter((e) => e.role === "worker") : [];
    const execSet = homeStack.filter((e) => !spawnSet.includes(e));

    // B2.1 — can the launcher even be run?
    if (launchRam > T) {
      c.fail(`${tag}: nothing can start the stack`, `${launcher} is ${fmt.gb(launchRam)}, over budget by ${fmt.gb(launchRam - T)}`);
    } else {
      c.note(`${tag}: A1 ${launcher} runs, ${fmt.gb(T - launchRam)} left free while it does`);
    }

    // B2.2 — can the launcher actually start anything on home?
    //
    // An exec'd entry competes with the launcher and has to fit in T - boot.
    // A SPAWNED entry does not, because the spawn kills the launcher first, so
    // it only has to fit in T. Both are checked; what is not tolerated is a
    // launcher that runs and can start nothing, which is precisely what 7.90GB
    // of boot.js on an 8GB home did — it logged ten "no host with NGB free"
    // lines and exited zero.
    const startable = [
      ...execSet.map((e) => ({ script: e.script, need: ram(e.script), budget: T - launchRam, how: "exec'd with boot.js resident" })),
      ...spawnSet.map((e) => ({ script: e.script, need: ram(e.script), budget: T, how: "spawned, which terminates boot.js first" })),
    ];
    const fits = startable.filter((s) => s.need <= s.budget);
    if (!homeStack.length) {
      c.fail(
        `${tag}: B2.2 boot.js pins NOTHING to home at this tier`,
        `an empty plan is not a passing plan — at ${T}GB the launcher would run and start no home-pinned script at all. ` +
          `If the intent is "everything useful here lives off home", say so with an 'anywhere' entry; an empty home set means ` +
          `the manifest or its tier fields could not be read.`,
      );
    } else if (launchRam <= T && !fits.length) {
      c.fail(
        `${tag}: B2.2 ${launcher} runs but cannot launch anything`,
        `${launcher} is ${fmt.gb(launchRam)}, leaving ${fmt.gb(T - launchRam)} free while it runs. Every home-pinned entry ` +
          `at this tier is out of reach:\n` +
          startable
            .sort((a, b) => a.need - b.need)
            .map((s) => `  ${s.script.padEnd(14)} ${fmt.gb(s.need).padStart(9)} vs ${fmt.gb(s.budget)} available (${s.how})`)
            .join("\n"),
      );
    }

    // B2.3 — a minimal earning configuration, with room for one whole batch.
    if (best.total > T) {
      const maxThreads = best.threaded ? Math.floor(T / best.ram) : Math.floor((T - best.ram) / workerRam);
      c.fail(
        `${tag}: B2.3 no earning configuration fits`,
        `cheapest is ${best.script} ${fmt.gb(best.ram)} ` +
          (best.threaded ? `x${MIN_OPS} threads` : `+ ${MIN_OPS}x${fmt.gb(workerRam)} workers`) +
          ` = ${fmt.gb(best.total)}, over ${T}GB by ${fmt.gb(best.total - T)}.\n` +
          `The most ${best.script} can get here is ${Math.max(0, maxThreads)} concurrent op(s) — a partial batch, and only if nothing else runs.`,
      );
    } else {
      c.note(`${tag}: B2.3 earning config ${best.script} = ${fmt.gb(best.total)}, ${fmt.gb(T - best.total)} spare`);
    }

    // B2.4 — TRANSIENT PEAK. Everything boot.js exec's onto home at this tier,
    // plus boot.js itself, which is resident for the whole exec loop. For a
    // flat, non-spawning boot.js this is the original check unchanged; for a
    // tiered one it is the same question asked of the set that tier admits.
    const tierSum = Math.round(execSet.reduce((s, e) => s + ram(e.script), 0) * 100) / 100;
    const peak = tierSum + launchRam;
    if (peak > T) {
      const ledger = execSet
        .map((e) => [e.script, ram(e.script)])
        .sort((a, b) => b[1] - a[1])
        .map(([n, r]) => `  ${n.padEnd(14)} ${fmt.gb(r).padStart(9)}${r > T ? "   <- exceeds the whole machine on its own" : ""}`)
        .join("\n");
      c.fail(
        `${tag}: B2.4 boot.js's own home-pinned stack does not fit`,
        `${homeStack.length} scripts pinned to home total ${fmt.gb(tierSum)}, plus ${launcher} ${fmt.gb(launchRam)} resident ` +
          `= ${fmt.gb(peak)}, over ${T}GB by ${fmt.gb(peak - T)}:\n${ledger}\n` +
          `boot.js logs each shortfall and carries on, so this is a TODO line in /tel/todo.txt, not a crash.`,
      );
    } else {
      c.note(`${tag}: B2.4 boot.js home-pinned stack + boot.js = ${fmt.gb(peak)} of ${T}GB`);
    }

    // B2.4b — STEADY STATE, with a whole batch still runnable.
    //
    // New, and stricter than B2.4 on purpose: B2.4 only asks whether the
    // launcher can get the daemons started. This asks whether, once it is gone,
    // the machine can still hold MIN_OPS concurrent operations — a daemon set
    // that fits but leaves no room to hack is a machine watching itself.
    //
    // Priced against the tier's own worker where the manifest names one
    // (`role: 'worker'`, cheapest at this tier), and against h/g/w otherwise,
    // because a controller like batch.js places those rather than threading
    // itself.
    const tierWorker = spawnSet.length ? Math.min(...spawnSet.map((e) => ram(e.script))) : workerRam;
    const steady = Math.round((tierSum + tierWorker * MIN_OPS) * 100) / 100;
    if (steady > T) {
      c.fail(
        `${tag}: B2.4b the daemons fit but leave no room for a batch`,
        `${execSet.length} resident script(s) total ${fmt.gb(tierSum)} and ${MIN_OPS} worker slots at ` +
          `${fmt.gb(tierWorker)} each need ${fmt.gb(tierWorker * MIN_OPS)} — ${fmt.gb(steady)} of ${T}GB, ` +
          `over by ${fmt.gb(steady - T)}. One HGW batch is ${MIN_OPS} concurrent operations (batch.js:365-366).`,
      );
    } else {
      c.note(
        `${tag}: B2.4b steady state ${fmt.gb(tierSum)} resident + ${MIN_OPS}x${fmt.gb(tierWorker)} workers ` +
          `= ${fmt.gb(steady)} of ${T}GB`,
      );
    }
  }

  /* -- growth tiers: where does the full stack become viable? ------------ */
  const tiers = [...ENTRY_TIERS.map((t) => t.ram), ...GROWTH_TIERS].sort((a, b) => a - b);
  const firstOk = tiers.find((t) => t >= homeSum + launchRam);
  c.note(`boot.js's home-pinned stack (${fmt.gb(homeSum)}) + boot.js (${fmt.gb(launchRam)}) first fits at ${firstOk ?? ">" + tiers.at(-1)}GB home`);

  /* -- B2.5: Source-File regimes change the price of the stack ------------- */
  // Everything in docs/autonomy.md is sized against BN4 base pricing. The same
  // file costs 16x on a save that leaves BN4 carrying SF4.1.
  const swings = [];
  for (const name of varies) {
    const costs = REGIMES.map((r) => (byRegime.get(r.id).get(name) ?? base.get(name))?.cost).filter((x) => typeof x === "number");
    const lo = Math.min(...costs);
    const hi = Math.max(...costs);
    if (hi - lo > 0.01) swings.push({ name, lo, hi, ratio: hi / lo });
  }
  swings.sort((a, b) => b.hi - a.hi);
  if (swings.length) {
    c.note(`${swings.length} root scripts change RAM with Source-File 4 level (RamCostGenerator.ts:82-96):`);
    for (const s of swings) c.note(`   ${s.name.padEnd(18)} ${fmt.gb(s.lo).padStart(10)} .. ${fmt.gb(s.hi).padStart(10)}  (x${s.ratio.toFixed(1)})`);
  }
  // Anything in the boot/watchdog stack must fit under its WORST regime, not
  // its best — the stack is not allowed to work only on today's save.
  //
  // "In the stack at home size T" is tier-aware: an entry boot.js does not
  // consider until 64GB cannot strand an 8GB entry. Anything the watchdog
  // watches but the manifest does not declare gets tier 8, i.e. it has to fit
  // everywhere — the watchdog restarts on a 30s timer with no budget of its
  // own, so an entry it knows about and boot.js does not is exactly the
  // "no host with NGB free" loop this row is about. [B7] asserts the two lists
  // agree, which is what makes this tier lookup sound.
  const bootTier = new Map(bootStack().map((e) => [e.script, e.tier ?? 0]));
  const stacked = new Map(watchdogStack().map((n) => [n, bootTier.has(n) ? bootTier.get(n) : 0]));
  for (const [n, t] of bootTier) stacked.set(n, t);
  for (const s of swings) {
    if (!stacked.has(s.name)) continue;
    for (const tier of ENTRY_TIERS) {
      if (tier.ram < stacked.get(s.name)) continue;
      if (s.lo <= tier.ram && s.hi > tier.ram) {
        c.fail(
          `B2.5 ${s.name} is in the boot/watchdog stack and fits at ${tier.ram}GB only in some Source-File regimes`,
          `${fmt.gb(s.lo)} at best (inside BN4), ${fmt.gb(s.hi)} at worst (SF4.1 outside BN4) — over ${tier.ram}GB by ${fmt.gb(s.hi - tier.ram)}.\n` +
            `The watchdog will try to restart it every 30s and log "no host with NGB free" forever.`,
        );
        break;
      }
    }
  }

  /* -- B2.6: worker purity ------------------------------------------------- */
  // h/g/w are multiplied by thread count in the hundreds; one stray priced
  // identifier costs tens of GB. Their cost must be base + the single op.
  asSave(REGIMES[0]);
  for (const w of ROLES.worker) {
    const r = ramOf(w);
    const priced = (r.entries ?? []).filter((e) => e.type !== "misc" && e.cost > 0);
    const extra = priced.filter((e) => !["hack", "grow", "weaken"].includes(e.name.split(".").pop()));
    if (extra.length) {
      c.fail(`worker ${w} references ns functions beyond its single op`, extra.map((e) => `${e.name} ${e.cost}GB`).join(", "));
    }
  }
  c.examined(ROLES.worker.length);

  return c;
}

/** watchdog.js's WATCHED list, parsed rather than duplicated. */
export function watchdogStack() {
  const src = source("watchdog.js");
  const block = src.slice(src.indexOf("const WATCHED = ["));
  const out = [];
  const re = /script:\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(block))) out.push(m[1]);
  return [...new Set(out)];
}
