// Can the RAM gate actually fail?
//
//   node tools/compile/gate-selftest.mjs
//
// CLAUDE.md: "when a tool returns nothing, establish that it looked", and
// invariant B3's sibling problem — a checker that has never been shown a
// known-bad input has not been shown to detect anything. This repo has shipped
// two calculators that were never adversarially tested and an allow-list that
// can never match.
//
// So: compile a good build, damage it in four specific ways, and assert the
// gate rejects exactly the three damaged ones and accepts the control.
//
// This is not hypothetical rigour. The FIRST version of the gate compared only
// against the handwritten baseline, and this file is what proved it blind:
// injecting a live `ns.singularity.purchaseTor()` into the compiled go.js added
// 2GB and the gate PASSED, because 17.80 + 2.00 is still under the handwritten
// 20.30. Since the entire point of the build is to sit well below the original,
// that gap is where most possible regressions live. The fix was the ratchet in
// build.mjs — never worse than handwritten AND never worse than the last build
// of the same profile.
//
// Read-only: compiles in memory, prices in memory, writes nothing.

import { compile, gate } from "./build.mjs";
import { liveProfile, makeProfile } from "./profile.mjs";

// The live save if the daemon is up, otherwise a regime that still exercises
// both seams. Either is fine — the point is the gate's reaction, not the RAM.
let profile;
try {
  profile = await liveProfile();
} catch (e) {
  profile = makeProfile({ bitNode: 4, sf: { 1: 1 }, source: `gate self-test (live save unavailable: ${e.message})` });
}

const good = await compile(profile);

const CASES = [
  {
    label: "control: the untouched build",
    expect: "accept",
    mutate: () => {},
    why: "a gate that rejects a correct build is just as broken",
  },
  {
    label: "inject a live ns.singularity reference (+2GB)",
    expect: "reject",
    mutate: (a) => a.set("go.js", a.get("go.js") + "\nfunction extra(ns){ ns.singularity.purchaseTor() }\nglobalThis.x = extra\n"),
    why: "still cheaper than the handwritten baseline — only the ratchet sees it",
  },
  {
    label: "declare a local named `cat`",
    expect: "reject",
    mutate: (a) => a.set("autobuy.js", a.get("autobuy.js") + "\nfunction z(){ const cat = 1; return cat }\nglobalThis.z = z\n"),
    why: "invariant B1: the checker prices bare identifiers by name, any object",
  },
  {
    label: "rename main -> main2 (as a bundler would)",
    expect: "reject",
    mutate: (a) =>
      a.set(
        "autobuy.js",
        a.get("autobuy.js").replace("async function main(ns)", "async function main2(ns)").replace(/export \{\s*main\s*\}/, "export { main2 as main }"),
      ),
    why: "ns.ramOverride is honoured only on a FunctionDeclaration named `main` (RamCalculations.ts:484-487)",
  },
];

console.log(`\n  RAM gate self-test — profile ${profile.stamp}\n`);

let wrong = 0;
for (const c of CASES) {
  const artifacts = new Map(good);
  c.mutate(artifacts);
  const result = await gate(profile, artifacts);
  const got = result.failed ? "reject" : "accept";
  const ok = got === c.expect;
  if (!ok) wrong++;
  console.log(`  ${ok ? " ok " : "FAIL"}  ${c.label.padEnd(46)} expected ${c.expect}, got ${got}`);
  console.log(`        ${c.why}`);
  for (const r of result.rows.filter((x) => x.bad)) {
    for (const f of r.structural ?? []) console.log(`        -> ${r.out}: ${f}`);
    if (r.collisions?.length) console.log(`        -> ${r.out}: collides with priced names ${r.collisions.join(", ")}`);
  }
  console.log("");
}

console.log(
  wrong
    ? `  ${wrong} case(s) behaved wrongly — THE GATE IS NOT TRUSTWORTHY.\n`
    : `  All ${CASES.length} cases behaved as specified: the gate detects what it claims to detect.\n`,
);
process.exit(wrong ? 1 : 0);
