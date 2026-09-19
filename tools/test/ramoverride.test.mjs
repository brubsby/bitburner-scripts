// [R] ns.ramOverride declarations are ACTUALLY HONOURED.
//
// ------------------------------------------------------------------ why
// `ns.ramOverride(n)` lets a script declare a RAM cost lower than the one the
// static checker computes. It is the sanctioned way to carry a Source-File-gated
// API in a BitNode that cannot call it: referencing `ns.singularity.*` costs
// RAM, only *calling* it throws, so a script may hold the reference, declare a
// small number, never take that branch, and be correct.
//
// The catch is that the override is honoured only in one exact syntactic shape
// (Script/RamCalculations.ts):
//
//   :484-487   checkRamOverride is reached ONLY from the FunctionDeclaration
//              visitor, and only when node.id?.name === "main"
//   :352-360   ...on the FIRST statement of that function's body, which must be
//              an ExpressionStatement wrapping a CallExpression with EXACTLY one
//              argument
//   :363-383   the callee must resolve (through parens / optional chaining /
//              member access) to an Identifier literally named `ramOverride`
//   :386-390   the argument must be a `Literal` whose value is a number
//   :392-395   isFinite(value) && value >= RamCostConstants.Base (1.6)
//   :174-181   only the ENTRY module's override counts; one in an imported
//              module is discarded
//
// Every other shape is **silently ignored**: the script simply costs full price,
// with no error, no log line and nothing in the game to notice. Measured:
//
//   export function main(ns) { ns.ramOverride(1.6); ns.singularity.purchaseTor() }   ->   1.60GB
//   export function main(ns) { ns.disableLog('ALL'); ns.ramOverride(1.6); ... }      -> 113.60GB
//
// and nearly every script in this collection opens with `ns.disableLog('ALL')`.
// That is precisely the shape CLAUDE.md's "Failure must be loud" calls the most
// expensive class of bug here, so it gets a check rather than a convention.
//
// ------------------------------------------------------------------ how
// The AUTHORITY is the game's own calculator (tools/test/ram.mjs, calibrated to
// 0.00% against the live game's calculateRam): price the script and assert the
// number equals the declared literal, under all four Source-File regimes. The
// AST walk below never decides pass/fail — it only names WHICH failure mode was
// hit, so a report says "disableLog is the first statement of main" instead of
// "expected 1.6, got 113.6".
//
// R4 is the negative control. Twelve synthetic scripts, one per known failure
// mode, are priced and fed to the same detector, and the check FAILS if the
// detector does not flag them. A passing check nobody has seen fail is not
// evidence — sfgate.test.mjs shipped an allow-list that could never match
// anything, and placement.test.mjs silently stopped running for two hours.
//
// R2/R3/R5 also cover tools/staging/ramoverride/*.js, because a check whose
// only subject set is empty is indistinguishable from a check that passed. Today
// no root script declares an override; the staged ones are what R1 will inherit
// the moment they are deployed.

import fs from "node:fs";
import path from "node:path";
import { Check, fmt } from "./harness.mjs";
import { load, asSave, ramOf, rootScripts, priceCode, priceOverlay, source, parseModule, ramBase, declaredInCode, pricedNames, codeOnly, REPO } from "./ram.mjs";

/** The four regimes the brief names, each a save someone can actually be in. */
const REGIMES = [
  { id: "BN4", bitNode: 4, sf: {}, why: "inside BitNode 4 — singularity at base price, no Source-File" },
  { id: "BN1/noSF", bitNode: 1, sf: {}, why: "no SF4 at all — the calls throw, RAM is still charged at 16x" },
  { id: "BN1/SF4.1", bitNode: 1, sf: { 4: 1 }, why: "SF4 level 1 outside BN4 — singularity costs 16x" },
  { id: "BN14/SF14.1", bitNode: 14, sf: { 14: 1 }, why: "inside BitNode 14 with SF14.1 — go.cheat live, no SF4" },
];

const STAGING = path.join(REPO, "tools/staging/ramoverride");

/* ------------------------------------------------------------------ the AST */

/** Resolve a CallExpression callee to its final Identifier, as the game does
 *  (RamCalculations.ts:363-381). */
function calleeIdentifier(node) {
  for (;;) {
    switch (node?.type) {
      case "ParenthesizedExpression":
      case "ChainExpression":
        node = node.expression;
        break;
      case "MemberExpression":
        node = node.property;
        break;
      default:
        return node;
    }
  }
}

/** Every `ramOverride(...)` call anywhere in the module, with its line. */
function allOverrideCalls(ast, code) {
  const found = [];
  const lineOf = (pos) => code.slice(0, pos).split("\n").length;
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    if (n.type === "CallExpression") {
      const id = calleeIdentifier(n.callee);
      if (id?.type === "Identifier" && id.name === "ramOverride") found.push({ node: n, line: lineOf(n.start) });
    }
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === "string") visit(v);
    }
  };
  visit(ast);
  return found;
}

/** Find how `main` is declared, and whether the game will look at it at all. */
function mainShape(ast) {
  let decl = null; // FunctionDeclaration named main
  const others = [];
  for (const node of ast.body) {
    const d = node.type === "ExportNamedDeclaration" || node.type === "ExportDefaultDeclaration" ? node.declaration : node;
    if (node.type === "ExportDefaultDeclaration") {
      if (d && (d.type === "FunctionDeclaration" || d.type === "ArrowFunctionExpression" || d.type === "FunctionExpression")) {
        others.push({ kind: "export default", why: "`export default` gives the FunctionDeclaration a null id, so RamCalculations.ts:485's `node.id?.name === 'main'` never matches" });
      }
      continue;
    }
    if (d?.type === "FunctionDeclaration" && d.id?.name === "main") {
      decl = d;
      continue;
    }
    if (d?.type === "VariableDeclaration") {
      for (const v of d.declarations) {
        if (v.id?.type === "Identifier" && v.id.name === "main" && v.init && (v.init.type === "ArrowFunctionExpression" || v.init.type === "FunctionExpression")) {
          others.push({ kind: `\`${d.kind} main = ${v.init.type === "ArrowFunctionExpression" ? "(ns) => …" : "function (ns) {}"}\``, why: "not a FunctionDeclaration, so the FunctionDeclaration visitor (RamCalculations.ts:484) never runs for it" });
        }
      }
    }
    if (node.type === "ExportNamedDeclaration" && !node.declaration) {
      for (const s of node.specifiers ?? []) {
        if (s.exported?.name === "main" && s.local?.name !== "main") {
          others.push({ kind: `\`export { ${s.local?.name} as main }\``, why: "the declaration's own id is not `main`, and RamCalculations.ts:485 keys on the declaration id, not the export name" });
        }
      }
    }
  }
  return { decl, others };
}

/**
 * Why is the override not in the honoured shape? Returns null when it IS.
 *
 * Mirrors RamCalculations.ts:352-395 clause by clause so the message can name
 * the clause. This never decides pass/fail — ramOf() does.
 */
function diagnose(code) {
  let ast;
  try {
    ast = parseModule(code);
  } catch (e) {
    return { calls: [], declared: null, modes: [`the file does not parse: ${e.message}`] };
  }
  const calls = allOverrideCalls(ast, code);
  if (!calls.length) return { calls, declared: null, modes: [] };

  const { decl, others } = mainShape(ast);
  const modes = [];

  if (!decl) {
    for (const o of others) modes.push(`\`main\` is declared as ${o.kind} — ${o.why}`);
    if (!others.length) modes.push("no `FunctionDeclaration` named `main` in this module at all (RamCalculations.ts:484-487 only looks there)");
    return { calls, declared: null, modes };
  }

  const first = decl.body.body[0];
  if (!first) return { calls, declared: null, modes: ["`main` has an empty body"] };
  if (first.type !== "ExpressionStatement") {
    modes.push(`the first statement of \`main\` is a ${first.type}, not an ExpressionStatement (RamCalculations.ts:355)`);
    return { calls, declared: null, modes };
  }
  const expr = first.expression;
  if (expr.type !== "CallExpression") {
    modes.push(`the first statement of \`main\` is a ${expr.type}, not a CallExpression (RamCalculations.ts:357)`);
    return { calls, declared: null, modes };
  }
  const id = calleeIdentifier(expr.callee);
  if (!(id?.type === "Identifier" && id.name === "ramOverride")) {
    const what = code.slice(first.start, first.end).replace(/\s+/g, " ").slice(0, 70);
    modes.push(`the first statement of \`main\` is \`${what}\`, not a ramOverride call — the override at line ${calls[0].line} is therefore never read (RamCalculations.ts:352-354, 383)`);
    return { calls, declared: null, modes };
  }
  if (!expr.arguments || expr.arguments.length !== 1) {
    modes.push(`ramOverride called with ${expr.arguments?.length ?? 0} arguments, must be exactly 1 (RamCalculations.ts:358)`);
    return { calls, declared: null, modes };
  }
  const arg = expr.arguments[0];
  if (arg.type !== "Literal") {
    modes.push(`the argument is a ${arg.type} (\`${code.slice(arg.start, arg.end)}\`), not a numeric Literal — constant folding is not performed (RamCalculations.ts:386-388)`);
    return { calls, declared: null, modes };
  }
  if (typeof arg.value !== "number") {
    modes.push(`the argument literal is a ${typeof arg.value}, not a number (RamCalculations.ts:389)`);
    return { calls, declared: null, modes };
  }
  if (!isFinite(arg.value) || arg.value < ramBase()) {
    modes.push(`the literal ${arg.value} is below RamCostConstants.Base (${ramBase()}) and is discarded (RamCalculations.ts:392-395)`);
    return { calls, declared: null, modes };
  }
  return { calls, declared: Math.round(arg.value * 100) / 100, modes: [] };
}

/* -------------------------------------------------------------- the subjects */

/**
 * Is this file something the game can `run`, i.e. does it export `main` at all?
 *
 * An override only exists in an ENTRY module (RamCalculations.ts:174-181
 * discards an imported module's token), so a shared helper that merely mentions
 * `ns.ramOverride` — ramgrow.js does, that is its whole job — is not a subject.
 * Matching every shape of `main`, including the broken ones, is deliberate: an
 * arrow `main` must still be caught by R1/R2 rather than excused as "not an
 * entry script", since that is one of the silent modes.
 */
function isEntry(code) {
  return /export\s+default|export\s+(?:async\s+)?function\s+main\b|export\s+(?:const|let|var)\s+main\b|export\s*\{[^}]*\bmain\b/.test(code);
}

/** Staged candidates: not deployed (the daemon skips tools/), but about to be. */
function stagedScripts() {
  if (!fs.existsSync(STAGING)) return [];
  return fs
    .readdirSync(STAGING)
    .filter((f) => f.endsWith(".js"))
    .sort()
    .map((f) => ({ name: f, code: fs.readFileSync(path.join(STAGING, f), "utf8"), staged: true }));
}

/** Root scripts that mention ramOverride at all — the real subject set. */
/*
 * Subject selection uses ram.mjs's `codeOnly`, which blanks comments AND string
 * literals, rather than testing the raw source.
 *
 * It used to test the raw text, so any file that merely DISCUSSED
 * ns.ramOverride in a comment was adopted as a subject; the AST walk then
 * correctly found zero calls and the file was reported as "ns.ramOverride is
 * present at line <blank> but is SILENTLY IGNORED". A check that fails on prose
 * is worse than one that stays quiet: it trains the reader to reword comments
 * to appease the tooling, and the next real failure reads like one more false
 * alarm. This fired twice in one session — on watchdog.js and on batch.js —
 * both times against comments explaining this very API.
 *
 * Pricing still uses the untouched source, because the game's calculator parses
 * the real file and anything else would measure a text we do not ship.
 */
function rootSubjects() {
  return rootScripts()
    .map((name) => ({ name, code: source(name) ?? "", staged: false }))
    .filter((s) => /\bramOverride\b/.test(codeOnly(s.name)) && isEntry(s.code));
}

/**
 * Every staged file as an overlay, so a staged script that imports another
 * staged module (ramgrow.js) resolves against the staged copy and not against a
 * root file that does not exist yet. Pricing a staged script against a partial
 * overlay would silently price a DIFFERENT import graph than the one that ships.
 */
function overlayOf(staged, code, name) {
  const o = {};
  for (const s of staged) o[s.name] = s.code;
  o[name] = code;
  return o;
}

/** Price a subject in the current regime: overlaid for staged, tracked for root. */
function priceSubject(s, all) {
  return s.staged ? priceOverlay(overlayOf(all, s.code, s.name), s.name) : ramOf(s.name);
}

export async function run() {
  await load();
  const all = stagedScripts();
  const staged = all.filter((s) => /\bramOverride\b/.test(s.code) && isEntry(s.code)).map((s) => ({ ...s, all }));
  const root = rootSubjects();
  return [honoured("R1", "root", root), honoured("R2", "staged", staged), rationale(root.concat(staged)), selfTest(), raiseCovers(root.concat(staged)), ...runR6()];
}

/* ------------------------------------- R1 / R2: the override is really applied */

function honoured(id, what, subjects) {
  const c = new Check(
    id,
    `every ns.ramOverride in a ${what} script is actually honoured, in all four regimes (invariants B6, "failure must be loud")`,
  );
  c.note(`regimes: ${REGIMES.map((r) => r.id).join(", ")}`);

  if (!subjects.length) {
    // Not silent. An empty subject set is reported as an empty subject set —
    // "0 examined, PASS" is exactly what a check that stopped working prints.
    c.note(
      what === "root"
        ? `NO root script declares an ns.ramOverride today, so this check asserted nothing about deployed code. ` +
            `It is not vacuous by accident: R4 below proves the detector fires, and R2 runs the same assertion over tools/staging/ramoverride/.`
        : `no staged script in ${path.relative(REPO, STAGING)} declares an ns.ramOverride.`,
    );
    return c;
  }

  for (const s of subjects) {
    c.examined(1);
    const d = diagnose(s.code);
    const prices = new Map();
    for (const reg of REGIMES) {
      asSave(reg);
      prices.set(reg.id, priceSubject(s, s.all ?? []));
    }
    asSave(REGIMES[0]);

    const shown = REGIMES.map((r) => {
      const p = prices.get(r.id);
      return `${r.id} ${p.error ? "ERROR" : fmt.gb(p.cost)}`;
    }).join("   ");

    if (d.declared == null) {
      // It has ramOverride calls but no honoured declaration. Full price, silently.
      c.fail(
        `${s.name}: ns.ramOverride is present at line ${d.calls.map((x) => x.line).join(", ")} but is SILENTLY IGNORED`,
        `${d.modes.map((m) => `mode: ${m}`).join("\n")}\n` +
          `priced:  ${shown}\n` +
          `The script pays full price in every regime and nothing in the game reports it.`,
      );
      continue;
    }

    c.note(`${s.name.padEnd(18)} declares ${fmt.gb(d.declared)}   ${shown}`);
    for (const reg of REGIMES) {
      const p = prices.get(reg.id);
      if (p.error) {
        c.fail(`${s.name} does not price at all in ${reg.id}`, p.error);
        continue;
      }
      if (Math.abs(p.cost - d.declared) > 1e-9) {
        c.fail(
          `${s.name}: declared ns.ramOverride(${d.declared}) but the game prices it at ${fmt.gb(p.cost)} in ${reg.id}`,
          `${d.modes.length ? d.modes.map((m) => `mode: ${m}`).join("\n") : "the declaration is in the honoured shape, so the entry-module rule (RamCalculations.ts:174-181) is the remaining suspect — is this file importing another that also declares an override, or is it not the entry module?"}\n` +
            `all regimes: ${shown}`,
        );
      }
    }
    if (d.calls.length > 1) {
      c.note(
        `  ${s.name}: ${d.calls.length} ramOverride calls (lines ${d.calls.map((x) => x.line).join(", ")}). ` +
          `Only the first-statement one is read statically (RamCalculations.ts:174-181 returns on the first token); ` +
          `the rest are RUNTIME raises, which R5 checks.`,
      );
    }
  }
  return c;
}

/* --------------------- R3: the reachability argument has to be written down */

function rationale(subjects) {
  const c = new Check("R3", "every ns.ramOverride carries the reachability argument it depends on, and is registered in bncheck.mjs (invariant C5)");
  if (!subjects.length) {
    c.note("no subject declares an ns.ramOverride; nothing to document yet.");
    return c;
  }
  let bncheck = "";
  try {
    bncheck = fs.readFileSync(path.join(REPO, "tools/sim/bncheck.mjs"), "utf8");
  } catch (e) {
    // "Could not check" must never encode as "fine".
    c.fail("could not read tools/sim/bncheck.mjs to verify registration", String(e));
  }
  for (const s of subjects) {
    c.examined(1);
    const d = diagnose(s.code);
    if (d.declared == null && !d.calls.length) continue;
    // The literal is a hand-computed reachability claim the game will not check.
    // Require it in a fixed, greppable shape naming what it excludes.
    const marker = /^\s*\/\/\s*RAMOVERRIDE\b[^\n]*excludes:[^\n]*/im.exec(s.code);
    if (!marker) {
      c.fail(
        `${s.name}: ns.ramOverride with no rationale comment`,
        "Required shape, on its own line:\n" +
          "  // RAMOVERRIDE <n>GB — excludes: ns.singularity.* (unreachable without SF4), ...\n" +
          "The number is a hand-done reachability argument the RAM checker refuses to do. Getting it wrong is a crash loop, so it has to be auditable.",
      );
    } else {
      c.note(`${s.name}: ${marker[0].trim().slice(0, 120)}`);
    }
    if (bncheck && !new RegExp(`ramOverride[\\s\\S]{0,400}?${s.name.replace(".", "\\.")}|${s.name.replace(".", "\\.")}[\\s\\S]{0,400}?ramOverride`).test(bncheck)) {
      c.fail(
        `${s.name}: its ns.ramOverride floor is not registered in tools/sim/bncheck.mjs`,
        "Invariant C5. The floor is a number in the code whose validity depends on save state the script cannot see at write time (SF4 level, BitNode). " +
          "Add it to ASSUMPTIONS if it depends on a BitNodeMultiplier, or to STRUCTURAL if it depends on a Source-File — arriving in a new node must be a checklist, not a debugging session.",
      );
    }
  }
  return c;
}

/* ------------------------------ R4: the negative control. Can this ever fail? */

const SING = "ns.singularity.purchaseTor(); ns.singularity.purchaseProgram('BruteSSH.exe')";

/** [source, what the detector must say about it]. Each is a real, documented mode. */
const BAD = [
  ["disableLog first", `export async function main(ns) { ns.disableLog('ALL'); ns.ramOverride(1.6); ${SING} }`, /first statement of `main` is/],
  ["arrow main", `export const main = async (ns) => { ns.ramOverride(1.6); ${SING} }`, /main` is declared as/],
  ["function-expression main", `export const main = async function (ns) { ns.ramOverride(1.6); ${SING} }`, /main` is declared as/],
  ["export default", `export default async function (ns) { ns.ramOverride(1.6); ${SING} }`, /export default|no `FunctionDeclaration` named `main`/],
  ["renamed re-export", `async function main2(ns) { ns.ramOverride(1.6); ${SING} }\nexport { main2 as main }`, /as main|no `FunctionDeclaration` named `main`/],
  ["non-literal argument", `const N = 1.6\nexport async function main(ns) { ns.ramOverride(N); ${SING} }`, /not a numeric Literal/],
  ["expression argument", `export async function main(ns) { ns.ramOverride(1.6 + 0); ${SING} }`, /not a numeric Literal/],
  ["literal below Base", `export async function main(ns) { ns.ramOverride(1.5); ${SING} }`, /below RamCostConstants.Base/],
  ["zero", `export async function main(ns) { ns.ramOverride(0); ${SING} }`, /below RamCostConstants.Base/],
  ["two arguments", `export async function main(ns) { ns.ramOverride(1.6, 1); ${SING} }`, /exactly 1/],
  ["in a helper, not main", `function setup(ns) { ns.ramOverride(1.6) }\nexport async function main(ns) { setup(ns); ${SING} }`, /first statement of `main` is/],
  ["inside if(false)", `export async function main(ns) { if (false) { ns.ramOverride(1.6) } ${SING} }`, /first statement of `main` is a IfStatement/],
  ["after a return-guard", `export async function main(ns) { if (ns.args[0]) return; ns.ramOverride(1.6); ${SING} }`, /first statement of `main` is a IfStatement/],
];

const GOOD = `export async function main(ns) { ns.ramOverride(1.6); ns.disableLog('ALL'); ${SING} }`;

function selfTest() {
  const c = new Check("R4", "NEGATIVE CONTROL — the R1/R2 check can actually fail, on every documented silent mode");
  asSave(REGIMES[0]);

  // The positive control first: if this does not pass, every "PASS" above is noise.
  const goodPrice = priceCode(GOOD);
  const goodDiag = diagnose(GOOD);
  c.examined(1);
  c.note(`control (override IS first statement of a FunctionDeclaration main): declared ${goodDiag.declared}, priced ${fmt.gb(goodPrice.cost)}`);
  if (goodDiag.declared !== 1.6 || Math.abs(goodPrice.cost - 1.6) > 1e-9) {
    c.fail(
      "R4 positive control failed: a correctly-shaped ns.ramOverride was NOT honoured",
      `diagnose() said ${JSON.stringify(goodDiag.modes)}, the game priced it at ${goodPrice.cost}GB. ` +
        `Either the game changed the rule or this check is broken; nothing below can be trusted.`,
    );
  }

  // The same code WITHOUT any override, so the gap being closed is visible.
  const naked = priceCode(`export async function main(ns) { ns.disableLog('ALL'); ${SING} }`);
  c.note(`the same script with no override at all prices at ${fmt.gb(naked.cost)} in BN4 — that is what every mode below silently pays`);

  for (const [label, code, expect] of BAD) {
    c.examined(1);
    const d = diagnose(code);
    const p = priceCode(code);
    const ignored = Math.abs(p.cost - 1.6) > 1e-9; // the game did NOT apply it
    const flagged = d.declared == null && d.modes.some((m) => expect.test(m));

    c.note(`  ${label.padEnd(26)} priced ${fmt.gb(p.cost).padStart(9)}  detector: ${flagged ? "FLAGGED" : d.declared != null ? "accepted (!)" : "flagged, wrong reason (!)"}`);

    if (!ignored) {
      c.fail(
        `R4: "${label}" was expected to be a silently-ignored override, but the game HONOURED it (${fmt.gb(p.cost)})`,
        "The game's rule has changed. Re-read Script/RamCalculations.ts:352-395 and :484-487 before trusting R1/R2.",
      );
    }
    if (!flagged) {
      c.fail(
        `R4: the detector does not flag "${label}" — R1/R2 would let this ship`,
        `The game prices it at ${fmt.gb(p.cost)} instead of 1.60GB, so the override is dead.\n` +
          `diagnose() returned declared=${d.declared}, modes=${JSON.stringify(d.modes)}\n` +
          `expected a mode matching ${expect}`,
      );
    }
  }
  return c;
}

/* ---------- R5: the runtime raise must cover the whole file, in every regime */

/**
 * A script that declares a floor and then raises at run time dies the moment
 * `dynamicRamUsage` crosses its allocation. `dynamicRamUsage` can climb to at
 * most the file's full STATIC price, so a raise to the full static price can
 * never be overrun — and anything less is a bet on which branches run.
 *
 * Verified against the real runtime in tools/staging/ramoverride/rt-probe.mjs:
 * a raise before the expensive call lets it through; without one the call is
 * killed; and a raise the HOST cannot afford is silently denied and returns the
 * old allocation (NetscriptFunctions.ts:1210-1214), which is why the staged
 * scripts check the return value.
 *
 * This check strips the declaration and prices what is left — the full price —
 * then asserts the script's own declared raise ceiling reaches it in every
 * regime. The ceiling is read out of the script as `RAISE_CEILING`, a shape the
 * staged scripts adopt precisely so it is checkable from outside.
 *
 * SUBJECTS ARE ROOT **AND** STAGED. It used to be `raiseCovers(staged)`, and
 * that is a check aimed at the wrong file: the staged copies are drafts, while
 * the root files are what the game actually runs. The shipped progress.js had
 * a ceiling of `3.35 + 39.7*mult` against a true static price of 48.05GB in
 * BN4 — 5GB short, which ns.ramOverride denies SILENTLY (it returns the old
 * allocation, NetscriptFunctions.ts:1210-1214) — and this check reported PASS
 * throughout, because it was reading tools/staging/ramoverride/progress.js,
 * a stale draft still at 39.1 whose own (smaller) ns surface that figure
 * happened to cover.
 *
 * A green check against a file nobody runs is worse than no check: it is the
 * silent-failure shape from CLAUDE.md wearing a passing badge. Root first.
 */
function raiseCovers(subjects) {
  const c = new Check("R5", "a runtime ns.ramOverride raise reaches the script's full static price in every regime");
  const withRaise = subjects.filter((s) => /RAISE_CEILING/.test(s.code));
  if (!subjects.length) {
    c.note("no staged subject declares an ns.ramOverride.");
    return c;
  }
  if (!withRaise.length) {
    c.note(`${subjects.length} staged subject(s), none declaring a RAISE_CEILING — none of them raises at run time, so there is nothing to overrun.`);
    return c;
  }
  c.note("full price = the same file with its first-statement ns.ramOverride removed, priced by the game's own calculator");

  for (const s of withRaise) {
    c.examined(1);
    // Strip the declaration, keeping byte offsets sane by replacing in place.
    const stripped = s.code.replace(/ns\.ramOverride\(\s*[\d.]+\s*\)\s*;?/, "");
    // The ceiling the script itself will ask for, per regime. Read as
    //   const RAISE_CEILING = (mult) => <expression in mult>
    const m = /const\s+RAISE_CEILING\s*=\s*\(([A-Za-z_$][\w$]*)\)\s*=>\s*([^\n]+)/.exec(s.code);
    if (!m) {
      c.fail(`${s.name}: RAISE_CEILING is not in the shape this check can evaluate`, "expected `const RAISE_CEILING = (mult) => <expression>` on one line");
      continue;
    }
    let ceilingFn;
    try {
      ceilingFn = new Function(m[1], `return (${m[2].replace(/\s*\/\/.*$/, "").replace(/;\s*$/, "")})`);
    } catch (e) {
      c.fail(`${s.name}: RAISE_CEILING does not evaluate`, String(e));
      continue;
    }
    for (const reg of REGIMES) {
      asSave(reg);
      const full = priceOverlay(overlayOf(s.all ?? [], stripped, s.name), s.name);
      if (full.error) {
        c.fail(`${s.name}: cannot price the un-overridden file in ${reg.id}`, full.error);
        continue;
      }
      // singularityRamMultiplier(resetInfo), sfgate.js:71-77, evaluated for this regime.
      const mult = reg.bitNode === 4 ? 1 : (reg.sf[4] ?? 0) <= 1 ? 16 : reg.sf[4] === 2 ? 4 : 1;
      const ceiling = ceilingFn(mult);
      c.note(`  ${s.name.padEnd(18)} ${reg.id.padEnd(12)} full ${fmt.gb(full.cost).padStart(9)}   raise ceiling ${fmt.gb(ceiling).padStart(9)} (mult ${mult})`);
      if (ceiling + 1e-9 < full.cost) {
        // The usual cause is not a mis-added constant but invariant B1: a local
        // whose NAME is in the ns cost tree. An override hides that statically —
        // the declared number replaces everything — but it still inflates the
        // full price, so name the suspects here rather than let the reader hunt.
        const priced = pricedNames();
        const decl = declaredInCode(s.code);
        const collisions = decl?.found
          ? [...decl.found].filter(([n]) => priced.has(n)).map(([n, kind]) => `  ${kind} \`${n}\` is priced at ${fmt.gb(priced.get(n))} (invariant B1)`)
          : [];
        c.fail(
          `${s.name}: its runtime raise ceiling ${fmt.gb(ceiling)} is BELOW its full static price ${fmt.gb(full.cost)} in ${reg.id}`,
          "dynamicRamUsage can climb to the full static price, so this script can be killed mid-call on a branch nobody tested. " +
            `Raise to the full price or prove the branch is unreachable in this regime.` +
            (collisions.length ? `\nIdentifiers in this file that the cost tree prices by NAME:\n${collisions.join("\n")}` : ""),
        );
      }
    }
    asSave(REGIMES[0]);
  }
  return c;
}

/* ------------------------------------------------------------------ R6 --- */
/**
 * [R6] batch.js's home reserve covers progress.js's raise, IN EVERY REGIME.
 *
 * These two numbers have to agree and live in different files, because the
 * alternative — batch.js importing progress.js — would drag progress.js's whole
 * Singularity import graph into the batcher's own static price. So the
 * duplication is deliberate, and this is the check that makes it safe.
 *
 * It exists because the constant version of this failed in production twice.
 * `homeReserve: 56` was measured against progress.js's 43.05GB ceiling INSIDE
 * BitNode 4. Singularity RAM is 16x at SF4.1, so the same ceiling is 1188.85GB
 * outside it, and the batcher — which sizes batches to whatever home has free —
 * took a 2,097,152GB home down to 62GB free. progress.js could not raise for
 * eight consecutive watchdog cycles, which is the whole orchestrator: no plan,
 * no purchase, no install.
 *
 * Both numbers are read from SOURCE, so editing either one without the other
 * fails here rather than in a BitNode nobody has entered yet.
 */
function runR6() {
  const checks = [];
  const c = new Check("R6", "batch.js's home reserve covers progress.js's RAM raise in every Source-File regime");

  const batchSrc = source("batch.js") ?? "";
  const progSrc = source("progress.js") ?? "";

  const reserveM = batchSrc.match(/homeReserve:\s*\(mult\)\s*=>\s*(.+?),\n/);
  const ceilM = progSrc.match(/const RAISE_CEILING = \(mult\) =>\s*(.+)/);
  c.examined(1);
  if (!reserveM) {
    c.fail("batch.js's homeReserve is not in the shape this check can evaluate",
      "expected `homeReserve: (mult) => <expression>,` — a bare constant CANNOT be right, it moves by 16x across Source-File levels");
    checks.push(c);
    return checks;
  }
  if (!ceilM) {
    c.fail("progress.js's RAISE_CEILING is not in the shape this check can evaluate");
    checks.push(c);
    return checks;
  }
  const reserve = new Function("mult", `return ${reserveM[1]}`);
  const ceiling = new Function("mult", `return ${ceilM[1]}`);

  // 1 inside BN4, 16 at SF4.1, 4 at SF4.2, 1 at SF4.3 (sfgate.js:71-77).
  for (const mult of [1, 4, 16]) {
    c.examined(1);
    const r = reserve(mult), k = ceiling(mult);
    if (!(r >= k)) {
      c.fail(`at Singularity multiplier ${mult}x the batcher reserves ${r}GB but progress.js raises to ${k}GB`,
        "the batcher fills home to exactly this reserve, so a shortfall means the orchestrator can never raise — it is an outage, not a tight fit");
    }
  }
  c.note(`reserve vs ceiling: ${[1, 4, 16].map((m) => `${m}x ${reserve(m)}/${ceiling(m)}GB`).join(", ")}`);
  checks.push(c);
  return checks;
}

