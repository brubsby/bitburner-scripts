// [LP] NOTHING THE PLANNER RUNS CAN SPIN THE PAGE.
//
// Netscript shares the browser's main thread with the whole game. A loop that
// never ends freezes the page at 100% CPU with no error, no telemetry and no
// open trace section to say where (2026-09-27, 11:17 UTC, right after a
// planner deploy; the prime suspect was bayes.gammaOf's unbounded rejection
// loop). So:
//
//   LP1  every open-ended loop — `for (;;)`, a `for` with no condition,
//        `while (true)`, `do { } while` — in any module in progress.js's
//        import graph is either awaited inside (it gives the page back) or
//        visibly capped: a counter it increments is compared against a bound
//        on a path that breaks, returns or throws. Anything else fails, named
//        by file and line.
//   LP2  the check itself: a synthetic unbounded loop is flagged, a capped
//        one and an awaited one are not (a check never seen failing is not
//        evidence).
//   LP3  the samplers under a broken uniform source (NaN, constant, stuck at
//        0, not a function) throw SamplingError within their caps — never
//        spin; the generator drivers throw LoopCapError on an endless
//        generator.

import fs from "node:fs";
import path from "node:path";
import "./gameresolve.mjs";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

/** Comments out (block and line comments that start a line or follow whitespace/code punctuation). */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/(^|[\s;{}(),])\/\/[^\n]*/g, (m, a) => a + " ".repeat(m.length - a.length));
}

/** The text from `start` through the loop body's closing brace (and a do-while's condition). */
function loopText(code, start, isDo) {
  const open = code.indexOf("{", start);
  if (open < 0) return code.slice(start, start + 200);
  let depth = 0;
  let i = open;
  for (; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) break;
  }
  let end = i + 1;
  if (isDo) {
    const m = /^\s*while\s*\(([^)]*)\)/.exec(code.slice(end));
    if (m) end += m[0].length;
  }
  return code.slice(start, end);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Bounded: awaited, or a counter incremented in the loop is compared to a bound on a break/return/throw path. */
export function loopVerdict(text) {
  if (/\bawait\b/.test(text)) return { ok: true, why: "awaits (gives the page back)" };
  const counters = new Set();
  for (const m of text.matchAll(/(?:\+\+\s*([A-Za-z_$][\w$]*)|([A-Za-z_$][\w$]*)\s*\+\+|([A-Za-z_$][\w$]*)\s*\+=)/g)) counters.add(m[1] ?? m[2] ?? m[3]);
  for (const x of counters) {
    const cmp = new RegExp(`(?:\\+\\+\\s*${esc(x)}|\\b${esc(x)}\\s*\\+\\+|\\b${esc(x)})\\s*(?:>=?)\\s*[\\w.$]+`);
    const m = cmp.exec(text);
    if (!m) continue;
    // The comparison must sit on a path that leaves the loop.
    const after = text.slice(m.index, m.index + 240);
    if (/\b(break|return|throw)\b/.test(after)) return { ok: true, why: `capped by '${x}'` };
  }
  return { ok: false, why: "no await, and no incremented counter compared to a bound on a break/return/throw path" };
}

export function scanLoops(src) {
  const code = stripComments(src);
  const out = [];
  const forms = [
    { re: /\bfor\s*\(\s*;\s*;\s*\)/g, kind: "for(;;)" },
    { re: /\bfor\s*\((?:let|var|const)?[^;()]*;\s*;[^)]*\)/g, kind: "for without a condition" },
    { re: /\bwhile\s*\(\s*true\s*\)/g, kind: "while(true)" },
    { re: /\bdo\s*\{/g, kind: "do-while", isDo: true },
  ];
  const seen = new Set();
  for (const f of forms) {
    for (const m of code.matchAll(f.re)) {
      if (seen.has(m.index)) continue;
      seen.add(m.index);
      const line = code.slice(0, m.index).split("\n").length;
      const v = loopVerdict(loopText(code, m.index, f.isDo));
      out.push({ line, kind: f.kind, ...v });
    }
  }
  return out;
}

function importGraph(root) {
  const seen = new Set();
  const order = [];
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const p = path.join(REPO_ROOT, file);
    if (!fs.existsSync(p)) return;
    order.push(file);
    const src = fs.readFileSync(p, "utf8");
    for (const m of stripComments(src).matchAll(/from\s+'([^']+\.js)'/g)) visit(m[1].replace(/^\//, ""));
  };
  visit(root);
  return order;
}

export async function run() {
  const checks = [];

  const c1 = new Check("LP1", "every open-ended loop in progress.js's import graph awaits or is visibly capped");
  {
    const files = importGraph("progress.js");
    let n = 0;
    const bad = [];
    for (const f of files) {
      for (const l of scanLoops(fs.readFileSync(path.join(REPO_ROOT, f), "utf8"))) {
        n++;
        if (!l.ok) bad.push(`${f}:${l.line} ${l.kind} — ${l.why}`);
        else c1.note(`${f}:${l.line} ${l.kind}: ${l.why}`);
      }
    }
    c1.examined(n);
    c1.note(`${files.length} modules in the graph, ${n} open-ended loop(s)`);
    if (files.length < 20) c1.fail(`the import graph read only ${files.length} modules — the scan did not look`);
    for (const b of bad) c1.fail(`unbounded loop: ${b}`, "cap it (a counter compared to a bound that throws) or await inside it — a spin here freezes the game page");
  }
  checks.push(c1);

  const c2 = new Check("LP2", "the loop check flags an unbounded loop and passes capped and awaited ones");
  {
    c2.examined(6);
    const cases = [
      ["function f(r){ for (;;) { const u = r(); if (u < 0.5) return u } }", false],
      ["function f(r){ while (true) { x = r() } }", false],
      ["function f(r){ let v; do { v = r() } while (v <= 0) }", false],
      ["function f(r){ for (let it = 0; ; it++) { if (it >= 100) throw new Error('cap'); if (r() < 0.5) return 1 } }", true],
      ["async function f(ns){ for (;;) { await ns.sleep(1000) } }", true],
      ["function f(r){ let n = 0; for (;;) { if (++n > 50) break; r() } }", true],
    ];
    for (const [src, want] of cases) {
      const got = scanLoops(src);
      if (got.length !== 1 || got[0].ok !== want) c2.fail(`${want ? "bounded" : "unbounded"} loop misjudged`, `${src} -> ${JSON.stringify(got)}`);
    }
  }
  checks.push(c2);

  const c3 = new Check("LP3", "samplers and generator drivers under a broken source throw within their caps (never spin)");
  {
    c3.examined(11);
    const B = await import("../../bayes.js");
    const CO = await import("../../coop.js");
    const throwsSampling = (fn, what) => {
      const t0 = performance.now();
      let e = null;
      try {
        fn();
      } catch (err) {
        e = err;
      }
      const ms = performance.now() - t0;
      if (!(e && (e.name === "SamplingError" || e.name === "LoopCapError"))) c3.fail(`${what}: must throw a SamplingError/LoopCapError, got ${e ? `${e.name}: ${e.message}` : "a value"}`);
      else if (ms > 1000) c3.fail(`${what}: threw only after ${ms.toFixed(0)}ms`);
      else c3.note(`${what}: ${e.name} in ${ms.toFixed(1)}ms — ${e.message}`);
    };
    const nan = () => NaN;
    const zero = () => 0;
    const half = () => 0.5;
    const nearOne = () => 0.999999999;
    throwsSampling(() => B.normalOf(nan), "normalOf(NaN source)");
    throwsSampling(() => B.normalOf(zero), "normalOf(source stuck at 0)");
    throwsSampling(() => B.gammaOf(2, nan), "gammaOf(2, NaN source)");
    throwsSampling(() => B.gammaOf(2, zero), "gammaOf(2, source stuck at 0)");
    throwsSampling(() => B.gammaOf(NaN, B.rngOf(1)), "gammaOf(NaN shape)");
    throwsSampling(() => B.igDraw({ a: 2, b: 0.01 }, "not a function"), "igDraw(no source)");
    throwsSampling(() => B.rngOf(undefined), "rngOf(undefined seed)");
    // A constant source is a legal uniform: gammaOf either accepts or hits its cap — in bounded time.
    for (const [src, what] of [[half, "0.5"], [nearOne, "0.999999999"]]) {
      const t0 = performance.now();
      let out = null;
      try {
        out = B.gammaOf(2, src);
      } catch (e) {
        out = e.name;
      }
      c3.note(`gammaOf(2, constant ${what}): ${out} in ${(performance.now() - t0).toFixed(1)}ms`);
    }
    // "Endless" = past the cap; finite (2e5 steps) so that a mutant without
    // the cap returns (and is caught) instead of hanging the suite.
    throwsSampling(() => CO.drain((function* () { for (let i = 0; i < 2e5; i++) yield; })(), 1e5), "drain(a generator past its step cap)");
    // The plan: a broken posterior throws out of makeDraws (never spins),
    // and progress.js builds the draws inside planCtxOf's try, which
    // publishes the error as health 'error'.
    const P = await import("../../plan.js");
    throwsSampling(() => P.makeDraws({ drift: { a: NaN, b: 0.01, nu: 4 }, trader: null, cadence: null, exp: null, rep: null, gymSdLn: 0.1, jitter: null }, 4, 1), "makeDraws(a NaN drift posterior)");
    const prog = fs.readFileSync(path.join(REPO_ROOT, "progress.js"), "utf8");
    const ctx = prog.slice(prog.indexOf("function planCtxOf("), prog.indexOf("function planInstallOf("));
    if (!/try \{[\s\S]*const draws = makeDraws\([\s\S]*\} catch \(e\) \{\s*\n\s*planCtx = \{[^\n]*error: `plan context threw/.test(ctx)) c3.fail("planCtxOf must build the draws inside its try and publish a throw as the plan's error (source guard)");
    // REPRO ATTEMPT (2026-09-27 11:17 freeze): the 11:16 plan context as the
    // re-applied code builds it — the exit samples of that life (all untagged,
    // all excluded), no rate observations, the stock history — and its 24
    // draws with that life's seed. They finish, finite, in milliseconds: the
    // deterministic draws the live pass made could not have spun.
    {
      const L = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-exitcal-0927.json"), "utf8"));
      const rows = fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn8-stockhist.txt"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
      const t0 = performance.now();
      const post = P.posteriorsOf({ stockRows: rows, warmupH: 0.07, exitSamples: L.samples, obs: {} });
      const draws = P.makeDraws(post, 24, P.seedOf(1790466762031, 8));
      const ms = performance.now() - t0;
      const finite = draws.every((d) => Number.isFinite(d.s2) && Number.isFinite(d.zc) && Number.isFinite(d.si2));
      c3.note(`the 11:16 context: s ${(100 * post.drift.s).toFixed(1)}% (excluded ${JSON.stringify(post.drift.excluded)}), 24 draws in ${ms.toFixed(1)}ms, all finite: ${finite}`);
      if (!finite || ms > 500) c3.fail("the live-state draws must finish, finite, quickly");
    }
    // A valid source is unaffected: draws match their moments.
    const r = B.rngOf(9);
    let s = 0;
    for (let i = 0; i < 5000; i++) s += B.gammaOf(2, r);
    c3.note(`gammaOf(2) mean over 5000 valid draws: ${(s / 5000).toFixed(3)} (2)`);
    if (Math.abs(s / 5000 - 2) > 0.1) c3.fail("a valid source must still sample correctly");
  }
  checks.push(c3);

  return checks;
}
