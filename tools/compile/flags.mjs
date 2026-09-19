// Which esbuild flags actually move the RAM, and which are dangerous — measured
// on the real prototype sources rather than asserted.
//
//   node tools/compile/flags.mjs
//
// Three claims decide the shape of tools/compile/build.mjs, and all three are
// the sort of thing that is easy to believe and be wrong about:
//
//   A. module substitution needs no minify flags at all
//   B. --minify-syntax buys nothing once the capability seam is a module
//   C. --minify-identifiers can make a script MORE expensive, silently
//
// CLAUDE.md: a model states its calibration or states that it has none, and an
// error of 1% and an error of 40% must both be visible. So they get measured
// with the game's own calculator and printed whether they support the claim or
// not. Claim B in particular came out differently from the first guess.

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeProfile, REPO } from "./profile.mjs";
import * as ram from "../test/ram.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, "src");
const EXTERNAL = ["golib.js", "status.js", "sfgate.js"];

// The regime that makes the difference visible: nothing Source-File-gated is
// reachable, so both seams select their "off" arm and there is dead capability
// for the flags to remove (or fail to remove).
const PROFILE = makeProfile({ bitNode: 1, sf: {}, source: "flags experiment" });
const SEAMS = { "caps/go-cheat.js": "caps/go-cheat-off.js", "caps/buy.js": "caps/buy-terminal.js" };

const resolver = {
  name: "seams",
  setup(b) {
    b.onResolve({ filter: /^caps\// }, (args) => ({ path: path.join(SRC, SEAMS[args.path]) }));
    b.onResolve({ filter: /^[^./]/ }, (args) => {
      if (EXTERNAL.includes(args.path)) return { path: args.path, external: true };
      for (const dir of [SRC, REPO]) {
        const p = path.join(dir, args.path);
        if (fs.existsSync(p)) return { path: p };
      }
      return null;
    });
  },
};

const VARIANTS = [
  { label: "bundle, no tree-shaking", treeShaking: false, minifySyntax: false, minifyIdentifiers: false },
  { label: "+ tree-shaking  (SHIPPED)", treeShaking: true, minifySyntax: false, minifyIdentifiers: false },
  { label: "+ minify-syntax", treeShaking: true, minifySyntax: true, minifyIdentifiers: false },
  { label: "+ minify-identifiers", treeShaking: true, minifySyntax: true, minifyIdentifiers: true },
];

const CASES = ["go.js", "autobuy.js"];

async function build(entry, v) {
  const res = await esbuild.build({
    entryPoints: [path.join(SRC, entry)],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    treeShaking: v.treeShaking,
    minifySyntax: v.minifySyntax,
    minifyIdentifiers: v.minifyIdentifiers,
    minifyWhitespace: false,
    plugins: [resolver],
    logLevel: "error",
  });
  return res.outputFiles[0].text;
}

await ram.load();
ram.asSave({ bitNode: PROFILE.bitNode, sf: PROFILE.sf });
const priced = ram.pricedNames();

console.log(`\n  esbuild flag sweep — profile ${PROFILE.stamp} (nothing Source-File-gated is reachable)`);
console.log(`  priced with the game's own Script/RamCalculations.ts\n`);

for (const name of CASES) {
  const handwritten = ram.ramOf(name).cost;
  console.log(`  ${name}   handwritten ${handwritten.toFixed(2)}GB`);
  for (const v of VARIANTS) {
    const t0 = performance.now();
    const code = await build(name, v);
    const ms = performance.now() - t0;
    const cost = ram.priceOverlay({ [name]: code }, name);
    const decl = ram.declaredInCode(code);
    const hits = decl?.found ? [...decl.found.keys()].filter((n) => priced.has(n)) : [];
    const d = cost.cost - handwritten;
    const lines = code.split("\n").length;
    console.log(
      `    ${v.label.padEnd(26)} ${String(cost.cost ?? cost.error).padStart(7)}GB  ${(d > 0 ? "+" : "") + d.toFixed(2)} vs handwritten` +
        `   ${String(lines).padStart(4)} lines   ${ms.toFixed(0)}ms` +
        (hits.length ? `\n        !!!!! declared names the checker prices: ${hits.map((n) => `${n}=${priced.get(n)}GB`).join(", ")}` : ""),
    );
  }
  console.log("");
}

console.log(`  Row 2 is what build.mjs ships. Rows 3 and 4 buy nothing here, because the`);
console.log(`  capability difference is a module boundary and tree-shaking already removed it.\n`);

/* ------------------------------------------------------------------------ */
/* Claim C, which the sweep above does NOT demonstrate, because these two     */
/* files are too small for the minifier to exhaust its single-character name  */
/* pool. Absence of evidence is not evidence of absence, and "it did not      */
/* happen on my two files" is exactly how a latent hazard gets called safe.   */
/* ------------------------------------------------------------------------ */

console.log(`  --minify-identifiers, forced past the single-character name pool:\n`);

const HAZARD = (() => {
  let s = "export function main(ns){\n  let t = 0;\n";
  for (let i = 0; i < 5000; i++) s += `  let v${i} = ns.args[${i}];\n`;
  for (let i = 0; i < 5000; i++) s += `  t += v${i};\n`;
  return s + "  return t;\n}\n";
})();

const hazardOut = (
  await esbuild.build({
    stdin: { contents: HAZARD, loader: "js", resolveDir: SRC },
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    minifyIdentifiers: true,
    minifySyntax: true,
    logLevel: "error",
  })
).outputFiles[0].text;

const emitted = new Set(hazardOut.match(/\b[A-Za-z_$][A-Za-z0-9_$]*\b/g) ?? []);
const collided = [...priced].filter(([n]) => emitted.has(n)).sort((a, b) => b[1] - a[1]);

console.log(`    5,000 locals in one scope -> esbuild emits ${[...emitted].filter((n) => n.length <= 2).length} names of <=2 characters.`);
console.log(
  collided.length
    ? `    ${collided.length} of them are names the RAM checker PRICES: ${collided.map(([n, c]) => `${n}=${c}GB`).join(", ")}`
    : `    none of them collide with a priced ns name (on this esbuild version, on this input)`,
);
console.log(
  `\n    Every priced name the minifier emits is RAM added to a script for no reason,\n` +
    `    and nothing reports it. That is why build.mjs prices its own output and fails\n` +
    `    on any increase — and why --minify-identifiers is not merely unused here but\n` +
    `    named as forbidden in the build's header.\n`,
);
