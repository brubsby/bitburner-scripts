// [BN] the per-BitNode override table must match game source.
//
// WHY THIS CHECK EXISTS. `readBitNodeMults()` reads localStorage, and the only
// writer is bitNodeMultipliers.js's own main(), which needs SF5 to read real
// values. We do not have SF5 in BitNode 4 — so the call returned BitNode 1
// values for every key, silently, for the whole node. Measured live on
// 2026-09-14: FactionWorkRepGain read back as 1 where the true value is 0.75.
//
// The replacement reads overrides out of game source instead, which needs no
// SF5 because getBitNodeMultipliers is a pure function of the node number. But
// a hand-copied table goes stale the moment the fork is fast-forwarded, and a
// stale table fails in exactly the silent way the original did. So this diffs
// it against ~/Repos/bitburner, key by key, every run.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import "./gameresolve.mjs";

const REPO = path.resolve(import.meta.dirname, "../..");
const GAME = path.resolve(REPO, "../bitburner/src/BitNode/BitNode.tsx");

/** Parse `case N: { return new BitNodeMultipliers({ ... }) }` out of game source. */
function overridesFromSource(src) {
  const out = {};
  const re = /case (\d+): \{\s*return new BitNodeMultipliers\(\{([\s\S]*?)\}\);/g;
  for (let m; (m = re.exec(src)); ) {
    const node = Number(m[1]);
    const body = {};
    for (const [, k, v] of m[2].matchAll(/(\w+):\s*([0-9.]+)\s*,/g)) body[k] = Number(v);
    // Symbolic entries (BitNode 12's `dec`/`inc`, which scale with the level)
    // are recorded as present-but-unvalued so a node that HAS them is not
    // mistaken for one that has none.
    const symbolic = [...m[2].matchAll(/(\w+):\s*(dec|inc)\s*,/g)].map(([, k]) => k);
    out[node] = { body, symbolic };
  }
  return out;
}

export async function run() {
  const checks = [];
  const c = new Check("BN1", "the BitNode override table matches the game's own source, key for key");

  let src;
  try {
    src = fs.readFileSync(GAME, "utf8");
  } catch (e) {
    // Cannot check is NOT the same as fine — say so and stop, rather than
    // passing on the strength of having looked nowhere.
    c.warn(`could not read ${GAME}: ${e.message}`,
      "without game source this table is unverified — it is a hand-copy, and hand-copies go stale");
    checks.push(c);
    return checks;
  }

  const { bitNodeMults } = await import("../../bitNodeMultipliers.js");
  const truth = overridesFromSource(src);

  c.examined(1);
  if (Object.keys(truth).length < 5) {
    c.fail(`only parsed ${Object.keys(truth).length} BitNodes out of game source`,
      "the `case N:` shape changed upstream, so this check is no longer looking at anything");
    checks.push(c);
    return checks;
  }
  c.note(`parsed ${Object.keys(truth).length} BitNodes out of BitNode.tsx`);

  for (const node of Object.keys(truth).map(Number).sort((a, b) => a - b)) {
    const { body, symbolic } = truth[node];
    const mine = bitNodeMults(node);
    c.examined(1);
    if (!mine) {
      c.fail(`BitNode ${node} is in game source but missing from the table`,
        "a missing node returns null, which is safe — but it means this BitNode cannot be reasoned about at all");
      continue;
    }
    for (const [k, v] of Object.entries(body)) {
      c.examined(1);
      if (mine[k] !== v) c.fail(`BitNode ${node} ${k}: table says ${mine[k]}, game source says ${v}`);
    }
    if (symbolic.length) {
      c.note(`BitNode ${node} has level-dependent multipliers this table cannot hold: ${symbolic.join(", ")}`);
    }
  }

  // THE DEFAULT TABLE must carry every field the game's class declares.
  // This is not hypothetical: CompanyWorkRepGain was missing on 2026-09-15,
  // so bitNodeMults(4).CompanyWorkRepGain read undefined and every megacorp
  // faction priced as unknown — the refusal machinery worked, but the hole
  // was here. A missing default is exactly as silent as a missing override.
  {
    let cls;
    try {
      cls = fs.readFileSync(path.resolve(REPO, "../bitburner/src/BitNode/BitNodeMultipliers.ts"), "utf8");
    } catch {
      c.warn("could not read BitNodeMultipliers.ts — the default table is unverified against the class fields");
    }
    if (cls) {
      const fields = [...cls.matchAll(/^  (\w+) = ([\d.]+);/gm)];
      c.examined(1);
      if (fields.length < 40) c.fail(`only parsed ${fields.length} class fields — the class shape changed upstream`);
      const bn1 = bitNodeMults(1);
      for (const [, name, value] of fields) {
        c.examined(1);
        if (bn1[name] === undefined) c.fail(`default table is missing ${name} (game default ${value})`);
        else if (bn1[name] !== Number(value)) c.fail(`default ${name}: table ${bn1[name]}, game class ${value}`);
      }
      c.note(`default table verified against all ${fields.length} class fields of BitNodeMultipliers.ts`);
    }
  }

  // The live node, stated explicitly — this is the value that was wrong.
  c.examined(1);
  const bn4 = bitNodeMults(4);
  if (bn4?.FactionWorkRepGain !== 0.75) {
    c.fail(`BitNode 4 FactionWorkRepGain is ${bn4?.FactionWorkRepGain}, expected 0.75`,
      "this is the key that read back as 1 from localStorage for an entire BitNode");
  }
  c.note("BitNode 4 FactionWorkRepGain = 0.75 (localStorage answered 1 until 2026-09-14)");

  // An unknown node must refuse, not default. This is the whole property.
  c.examined(1);
  if (bitNodeMults(99) !== null) c.fail("an unknown BitNode must return null, never the BitNode 1 defaults");
  c.examined(1);
  for (const bad of [undefined, null, NaN, "4", {}]) {
    if (bitNodeMults(bad) !== null) c.fail(`bitNodeMults(${String(bad)}) did not refuse`);
  }

  checks.push(c);
  return checks;
}
