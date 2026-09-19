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

export const fmt = {
  gb: (n) => `${n.toFixed(2)}GB`,
  pct: (n) => `${(n * 100).toFixed(2)}%`,
};

export { C as colour };
