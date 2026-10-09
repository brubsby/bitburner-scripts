// Minimal test harness. No dependency, no framework — the suite has to run in
// under a couple of seconds on every save, and a runner is not the interesting
// part of it.
//
// Three outcomes, and the middle one matters:
//   FAIL  the collection is wrong somewhere that stops a playthrough working
//   WARN  the collection is wrong somewhere that only costs a dormant script
//   PASS  checked and fine
//
// Only FAIL sets the exit code. WARN exists so that the suite can report the
// forty things that are broken in scripts nothing boots, without becoming a
// suite that is permanently red and therefore ignored. Every WARN still prints
// in full; it is not a way of hiding a finding.
//
// Every check also prints what it CHECKED, not only what it found. A check that
// silently examined zero files looks exactly like a check that passed, and that
// is the failure mode CLAUDE.md documents under "fabricated validation".

const C = process.stdout.isTTY
  ? { red: "\x1b[31m", yel: "\x1b[33m", grn: "\x1b[32m", dim: "\x1b[2m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { red: "", yel: "", grn: "", dim: "", bold: "", off: "" };

export class Check {
  constructor(id, title) {
    this.id = id;
    this.title = title;
    this.fails = [];
    this.warns = [];
    this.notes = [];
    this.counted = 0;
    this.skips = [];
  }
  /**
   * THE SLOW TIER: `n` things this check deliberately did NOT run because the
   * suite was started with --quick (QUICK). Printed on the check and totalled
   * by the runner, so a quick run can never read as the whole suite passing.
   * `npm test` (no --quick) runs everything; only the dev loop skips.
   */
  skip(n, what) {
    this.skips.push({ n, what });
  }
  /** Something that must be true for a playthrough to work anywhere. */
  fail(what, detail) {
    this.fails.push({ what, detail });
  }
  /** Something wrong in code no boot path reaches. */
  warn(what, detail) {
    this.warns.push({ what, detail });
  }
  /** Always-printed evidence: the measurement, pass or fail. */
  note(line) {
    this.notes.push(line);
  }
  /** How many things this check actually looked at. */
  examined(n) {
    this.counted += n;
  }
  print() {
    const status = this.fails.length ? `${C.red}FAIL${C.off}` : this.warns.length ? `${C.yel}WARN${C.off}` : `${C.grn}PASS${C.off}`;
    console.log(`\n${C.bold}[${this.id}] ${this.title}${C.off}  ${status}  ${C.dim}(${this.counted} examined)${C.off}`);
    for (const n of this.notes) console.log(`    ${C.dim}${n}${C.off}`);
    for (const k of this.skips) console.log(`  ${C.yel}SKIPPED${C.off} ${k.n} (slow tier, --quick): ${k.what}`);
    for (const f of this.fails) {
      console.log(`  ${C.red}FAIL${C.off} ${f.what}`);
      if (f.detail) for (const l of String(f.detail).split("\n")) console.log(`       ${l}`);
    }
    for (const w of this.warns) {
      console.log(`  ${C.yel}WARN${C.off} ${w.what}`);
      if (w.detail) for (const l of String(w.detail).split("\n")) console.log(`       ${l}`);
    }
  }
}

/** `run.mjs --quick` (or BB_TEST_QUICK=1): skip the slow tier, saying so (Check.skip). */
export const QUICK = process.env.BB_TEST_QUICK === "1" || process.argv.includes("--quick");

export const fmt = {
  gb: (n) => `${n.toFixed(2)}GB`,
  pct: (n) => `${(n * 100).toFixed(2)}%`,
};

export { C as colour };

/**
 * THIS THREAD'S CPU TIME in ms — the clock for a CPU GUARD (a check that a
 * computation fits a millisecond budget). Wall time on the dev machine counts
 * every moment the scheduler gave the core to someone else: with other agents'
 * suites running, PP3/PP5 failed on 25-57ms "steps" that were preemption, not
 * work. Thread CPU time excludes that (and other threads' GC), so the guard
 * measures what the computation costs. Pass it as a pacer's `now`
 * (coop.makePacer) and every budget derived from pacer.cpuNow follows.
 */
export const threadCpuMs = () => {
  const u = process.threadCpuUsage();
  return (u.user + u.system) / 1000;
};

/**
 * RETRY A CPU GUARD ONCE. `make` builds and runs the check from scratch and
 * returns it. A green first attempt is returned as is; a red one is run again
 * and the SECOND attempt is the verdict, carrying a note of what the first
 * reported. A deterministic fault is red twice; only a timing excursion clears
 * (CPU time is not enough on its own: on this 4-core hyperthreaded laptop at
 * load 12, a pass's thread CPU time rose 1.5-1.9x — sibling threads and
 * thermal clocks). Use only for checks whose budgets are timing.
 */
export async function retryOnce(make) {
  const first = await make();
  if (!first.fails.length) return first;
  const second = await make();
  second.note(`RETRIED ONCE: the first attempt failed — ${first.fails.map((f) => f.what).join("; ").slice(0, 400)}`);
  return second;
}
