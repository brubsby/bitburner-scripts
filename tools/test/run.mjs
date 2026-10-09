// The suite. `npm test`.
//
//   node tools/test/run.mjs              everything
//   node tools/test/run.mjs ram sfgate   only the named modules
//   node tools/test/run.mjs --warn-fatal treat WARN as failure too
//   node tools/test/run.mjs --quick      the dev loop: skip the SLOW TIER (expensive
//                                        replays a check marks with Check.skip, e.g. the
//                                        Go loss corpus's extra seeds); every skip is
//                                        printed and totalled. `npm test` runs it all.
//   node tools/test/run.mjs --times      per-module wall / CPU / child CPU, slowest first
//                                        (--times-json <path> also writes them)
//
// DISCOVERY IS A GLOB: every `tools/test/*.test.mjs` is imported and its
// exported `run()` is awaited. A new check file needs no registration anywhere —
// drop it in, name it `<something>.test.mjs`, and it runs. Support modules that
// are not themselves checks must NOT match `*.test.mjs` (that is why the RAM
// calculator lives in `ram.mjs` and its checks in `ram.test.mjs`).
//
// CONTRACT for a check module:
//
//   import { Check } from './harness.mjs'
//   export async function run() {
//     const c = new Check('X1', 'what this asserts')
//     c.examined(n)                 // how many things were actually looked at
//     c.note('measurement, printed pass or fail')
//     c.fail('what is wrong', 'detail')   // sets exit code 1
//     c.warn('what is wrong', 'detail')   // printed, does not set exit code
//     return c                      // or an array of Checks
//   }
//
// FAIL vs WARN: FAIL means a playthrough is broken somewhere the stack actually
// reaches. WARN means a real defect in code no boot path runs. Both print in
// full; only FAIL is fatal. That split exists so the suite can report the long
// tail of dormant-script problems without becoming permanently red, which is
// how a suite gets deleted.
//
// Exit codes: 0 all pass, 1 at least one FAIL, 2 a check module itself threw
// (which is deliberately NOT the same as "the collection is fine").

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { colour as C, QUICK } from "./harness.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const warnFatal = argv.includes("--warn-fatal");
const timesJson = (() => {
  const i = argv.indexOf("--times-json");
  return i >= 0 ? argv[i + 1] : null;
})();
const showTimes = argv.includes("--times") || !!timesJson;
const only = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--times-json");

const modules = fs
  .readdirSync(HERE)
  .filter((f) => f.endsWith(".test.mjs"))
  .filter((f) => !only.length || only.some((o) => f.startsWith(o)))
  .sort();

if (!modules.length) {
  console.error(`no *.test.mjs in ${HERE}${only.length ? ` matching ${only.join(", ")}` : ""}`);
  process.exit(2);
}

const t0 = Date.now();
console.log(`${C.bold}bitburner-scripts test suite${C.off}  ${C.dim}${modules.length} module(s): ${modules.join(", ")}${C.off}`);

// Per-module cost (--times, or --times-json <path>): wall ms, this process's
// CPU ms, and reaped children's CPU ms (/proc/self/stat cutime+cstime, for the
// modules that spawn node or esbuild). Modules run one at a time, so each
// delta is that module's own.
const childCpu = () => {
  try {
    const f = fs.readFileSync("/proc/self/stat", "utf8").split(") ")[1].split(" ");
    return (Number(f[13]) + Number(f[14])) * 10; // cutime+cstime in 100Hz ticks
  } catch {
    return NaN;
  }
};
const times = [];
const checks = [];
let threw = 0;
for (const f of modules) {
  const w0 = performance.now(), u0 = process.cpuUsage(), k0 = childCpu();
  try {
    const mod = await import(path.join(HERE, f));
    if (typeof mod.run !== "function") {
      console.error(`${C.red}${f}: no exported run()${C.off}`);
      threw++;
      continue;
    }
    const got = await mod.run();
    for (const c of Array.isArray(got) ? got : [got]) checks.push(await c);
  } catch (e) {
    threw++;
    console.error(`\n${C.red}${f} threw${C.off}\n${e?.stack ?? e}`);
  } finally {
    const u = process.cpuUsage(u0);
    times.push({ module: f, wallMs: Math.round(performance.now() - w0), cpuMs: Math.round((u.user + u.system) / 1000), childCpuMs: Math.round(childCpu() - k0) });
  }
}

for (const c of checks) c.print();
if (showTimes) {
  console.log(`\n${C.bold}per-module time${C.off} ${C.dim}(wall / cpu / child cpu, ms; slowest first)${C.off}`);
  for (const t of [...times].sort((a, b) => b.wallMs - a.wallMs)) console.log(`  ${String(t.wallMs).padStart(7)} ${String(t.cpuMs).padStart(7)} ${String(t.childCpuMs).padStart(7)}  ${t.module}`);
}
if (timesJson) fs.writeFileSync(timesJson, JSON.stringify(times, null, 1));

const fails = checks.reduce((s, c) => s + c.fails.length, 0);
const warns = checks.reduce((s, c) => s + c.warns.length, 0);
const examined = checks.reduce((s, c) => s + c.counted, 0);
const skipped = checks.reduce((s, c) => s + (c.skips ?? []).reduce((a, k) => a + k.n, 0), 0);
const failedChecks = checks.filter((c) => c.fails.length).map((c) => c.id);

console.log(
  `\n${C.bold}────${C.off} ${checks.length} checks, ${examined} things examined, ` +
    `${fails ? C.red : C.grn}${fails} FAIL${C.off}, ${warns ? C.yel : C.dim}${warns} WARN${C.off}` +
    `${threw ? `, ${C.red}${threw} module(s) threw${C.off}` : ""}` +
    `${QUICK ? `, ${C.yel}--quick: ${skipped} slow-tier item(s) SKIPPED${C.off} (npm test runs them)` : ""} in ${Date.now() - t0}ms`,
);
if (failedChecks.length) console.log(`     failing checks: ${failedChecks.join(", ")}`);

process.exit(threw ? 2 : fails || (warnFatal && warns) ? 1 : 0);
