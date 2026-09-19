// [CT] the coding-contract solvers, checked against the game's own generator
// and the game's own validator.
//
//   node tools/staging/contracts/ctsolvers.test.mjs          # standalone
//   CT_N=2000 node tools/staging/contracts/ctsolvers.test.mjs
//   node tools/test/run.mjs                                  # once deployed
//
// ---------------------------------------------------------------------------
// WHY THIS TEST IS WORTH TRUSTING, AND THE ONE REASON IT MIGHT NOT BE
//
// A coding contract is destroyed by too many wrong answers — Contract.ts:63
// counts `tries` against getMaxNumTries() (Contract.ts:106), and
// NetscriptFunctions/CodingContract.ts:63-70 removes the file and prints the
// solution when they run out. At ~$25m a contract plus faction reputation that
// cannot be bought, a solver that is *usually* right is worse than no solver:
// ctauto.js:95-99 skips an unknown type and leaves the contract standing for
// later, while a wrong answer spends it.
//
// So the acceptance criterion cannot be "does it match what I think the problem
// is". It has to be the game's. Every check below runs the REAL
// `CodingContractTypes[type].generate()` to build an instance and the REAL
// `CodingContract.isSolution()` — which is the same isValid/convertAnswer/
// validateAnswer/solver path ns.codingcontract.attempt() takes
// (NetscriptFunctions/CodingContract.ts:33-38) — to judge the answer. Nothing
// here encodes this author's reading of a problem statement.
//
// CALIBRATION: not applicable in the usual sense — there is no live quantity to
// reproduce, because the whole point is that we must NOT attempt a live
// contract to find out. What stands in for it is that both sides of every
// comparison come from ~/Repos/bitburner at the version actually being played
// (the bundle is rebuilt whenever src/CodingContract is newer, and CT0 prints
// the game version it bundled). The residual risk, stated plainly: if the
// installed game's contract code differs from the checkout at ~/Repos/bitburner,
// this suite is measuring the wrong game. CT0 prints the version so that is
// visible rather than assumed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Check } from "../../test/harness.mjs";
import { buildIfStale, GAME, OUT } from "./build-contracts.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../..");

/**
 * The module under test. Deliberately an explicit path and deliberately
 * printed: this file is staged, and "the file that was tested is not the file
 * that ships" is a failure this repo has already paid for (see the header of
 * tools/test/gameresolve.mjs). Override with CTSOLVERS=<path> to point the same
 * checks at the deployed copy after it lands at the repo root.
 */
const TARGET = process.env.CTSOLVERS ?? path.join(HERE, "ctsolvers.js");

/**
 * Instances generated per contract type. "Hundreds, not five" is the point —
 * several of these contracts have branches that only a minority of random
 * instances reach (an unreachable grid, a non-bipartite graph, a Hamming block
 * with no flipped bit), and CT4 fails if the sample did not actually reach them.
 *
 * Two types are given smaller samples purely because they are slow, and the
 * number is printed next to their pass rate so a thin sample can never be
 * mistaken for a thick one:
 *   Find All Valid Math Expressions  ~53ms/instance (exponential enumeration)
 *   Total Number of Primes           ~13ms/instance (1e6-wide segmented sieve)
 */
const N = Number(process.env.CT_N ?? 500);
const SAMPLE = {
  "Find All Valid Math Expressions": Math.max(25, Math.round(N * 0.3)),
  "Total Number of Primes": Math.max(25, Math.round(N * 0.4)),
};
const sampleFor = (type) => SAMPLE[type] ?? N;

/** The 13 added on 2026-09-13. Reported separately so the new work is visible. */
const NEW_IN_THIS_CHANGE = [
  "Array Jumping Game II",
  "Compression I: RLE Compression",
  "Compression II: LZ Decompression",
  "Compression III: LZ Compression",
  "Encryption II: Vigenère Cipher",
  "HammingCodes: Encoded Binary to Integer",
  "HammingCodes: Integer to Encoded Binary",
  "Largest Rectangle in a Matrix",
  "Proper 2-Coloring of a Graph",
  "Shortest Path in a Grid",
  "Square Root",
  "Total Number of Primes",
  "Total Ways to Sum II",
];

export async function run() {
  const checks = [];

  /* ---------------------------------------------------------------- CT0 --- */
  const c0 = new Check("CT0", "the game source under test is present, current, and named");
  let game, solvers, gameVersion;
  {
    c0.examined(1);
    const { rebuilt } = await buildIfStale({ quiet: true });
    game = await import(`${OUT}?t=${fs.statSync(OUT).mtimeMs}`);
    gameVersion = JSON.parse(fs.readFileSync(path.join(GAME, "package.json"), "utf8")).version;
    c0.note(`bundled bitburner v${gameVersion} from ${GAME}${rebuilt ? " (rebuilt: game source was newer)" : ""}`);

    c0.examined(1);
    solvers = await import(`${TARGET}?t=${fs.statSync(TARGET).mtimeMs}`);
    const bytes = fs.statSync(TARGET).size;
    c0.note(`module under test: ${TARGET} (${bytes} bytes)`);

    // Say out loud whether the deployed copy is the copy that was tested.
    // Silence here would read as "checked and fine".
    const deployed = path.join(REPO, "ctsolvers.js");
    c0.examined(1);
    if (!fs.existsSync(deployed)) {
      c0.note("repo-root ctsolvers.js: ABSENT");
    } else if (fs.readFileSync(deployed).equals(fs.readFileSync(TARGET))) {
      c0.note("repo-root ctsolvers.js: byte-identical to the file under test (deployed)");
    } else {
      c0.note("repo-root ctsolvers.js: DIFFERENT from the file under test (not yet deployed — expected while staged)");
    }

    c0.examined(1);
    if (typeof solvers.findAnswer !== "function") {
      c0.fail("ctsolvers.js exports no findAnswer()", "ctauto.js:20 imports exactly this; a rename makes every contract skip");
    }
    c0.examined(1);
    if (!Array.isArray(solvers.codingContractTypesMetadata)) {
      c0.fail("ctsolvers.js exports no codingContractTypesMetadata array");
    }
  }
  checks.push(c0);
  if (c0.fails.length) return checks; // nothing below can run

  const { findAnswer, codingContractTypesMetadata: META } = solvers;
  const gameNames = Object.values(game.CodingContractName);
  const ourNames = META.map((m) => m.name);

  /* ---------------------------------------------------------------- CT1 --- */
  // The `è` check, permanently, in BOTH directions. Dispatch in findAnswer() is
  // an exact string match on contract.type, so a name that is merely *nearly*
  // right produces a solver that never fires — indistinguishable from having no
  // solver at all, which is exactly what it looks like from telemetry. A stale
  // name is the same bug pointing the other way: upstream renames a contract and
  // our entry silently stops matching while the suite stays green.
  const c1 = new Check("CT1", "the solver name set is EXACTLY the game's 30 (Enums.ts) — no missing, no stale");
  {
    c1.examined(gameNames.length + ourNames.length);
    const have = new Set(ourNames);
    const missing = gameNames.filter((n) => !have.has(n));
    const stale = ourNames.filter((n) => !gameNames.includes(n));
    const dupes = ourNames.filter((n, i) => ourNames.indexOf(n) !== i);

    if (missing.length) {
      c1.fail(`${missing.length} game contract type(s) have no solver`, missing.join("\n"));
    }
    if (stale.length) {
      // Not merely cosmetic: a stale name means the type it USED to answer is
      // now unanswered, and the entry can never fire to say so.
      c1.fail(`${stale.length} solver name(s) match no game contract type`, stale.join("\n"));
    }
    if (dupes.length) {
      // findAnswer uses Array.prototype.find, so a duplicate silently shadows
      // whichever entry comes second.
      c1.fail(`duplicate solver name(s) — the later entry is dead code`, [...new Set(dupes)].join("\n"));
    }
    c1.note(`${ourNames.length} solvers vs ${gameNames.length} game types; ${missing.length} missing, ${stale.length} stale, ${dupes.length} duplicated`);

    // Byte-level, because a name can compare unequal while LOOKING identical:
    // 'è' has a precomposed form (U+00E8, what Enums.ts:27 uses) and a
    // decomposed one ('e' + U+0300) that renders the same in every editor.
    c1.examined(1);
    const vig = gameNames.find((n) => n.startsWith("Encryption II"));
    const ours = ourNames.find((n) => n.startsWith("Encryption II"));
    const hex = (s) => [...(s ?? "")].map((ch) => ch.codePointAt(0).toString(16)).join(" ");
    if (ours !== vig) {
      c1.fail("the Vigenère solver's name is not byte-identical to the game's", `game: ${hex(vig)}\nours: ${hex(ours)}`);
    }
    c1.note(`Vigenère name matches byte-for-byte (U+00E8 precomposed, NFC): ${JSON.stringify(vig)}`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- CT2 --- */
  // THE decisive check. Generate real instances with the game's generator,
  // answer them with our solver, and let the game's own isSolution() judge.
  const c2 = new Check("CT2", `round-trip against the game's generator and validator (${N} instances/type default)`);
  const stats = new Map();
  const compressionIIIExcess = [];
  {
    for (const type of gameNames) {
      const n = sampleFor(type);
      const st = {
        type,
        n,
        pass: 0,
        fail: 0,
        threw: 0,
        invalidFormat: 0,
        noAnswer: 0,
        // branch tallies, consumed by CT4
        emptyString: 0,
        emptyArray: 0,
        zero: 0,
        ms: 0,
      };
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        // A real CodingContract: its constructor calls the real generate()
        // (Contract.ts:84) and it carries the real isValid/isSolution.
        const contract = new game.CodingContract("ctsolvers-test.cct", type);
        const data = contract.getData();

        let answer;
        try {
          answer = findAnswer({ type, data });
        } catch (err) {
          // ctauto.js:90-94 counts a throw as skipped, which is SAFE (the
          // contract survives) but still means no money. Tallied, not ignored.
          st.threw++;
          if (st.threw === 1) st.firstThrow = String(err?.message ?? err);
          continue;
        }

        if (answer === undefined || answer === null) {
          // The exact predicate ctauto.js:95 uses. `0` and `""` and `[]` are
          // legitimate answers and must NOT land here — see CT4.
          st.noAnswer++;
          continue;
        }

        if (answer === "") st.emptyString++;
        if (Array.isArray(answer) && answer.length === 0) st.emptyArray++;
        if (answer === 0) st.zero++;

        if (type === "Compression III: LZ Compression") {
          const optimal = game.CodingContractTypes[type].getAnswer(data);
          compressionIIIExcess.push(answer.length - optimal.length);
        }

        const result = contract.isSolution(answer);
        // CodingContractResult: 0 Success, 1 Failure, 3 InvalidFormat (Contract.ts:22-27)
        if (result.result === 0) st.pass++;
        else if (result.result === 3) {
          st.invalidFormat++;
          if (!st.firstInvalid) st.firstInvalid = `${result.message} | answer was ${JSON.stringify(String(answer)).slice(0, 120)}`;
        } else {
          st.fail++;
          if (!st.firstWrong) {
            st.firstWrong = `data=${JSON.stringify(String(data)).slice(0, 200)} answer=${JSON.stringify(String(answer)).slice(0, 200)}`;
          }
        }
      }
      st.ms = Date.now() - t0;
      stats.set(type, st);
      c2.examined(n);
    }

    // Every type gets a printed line, pass or fail. A check that reports only
    // its failures cannot be distinguished from a check that examined nothing.
    const width = Math.max(...gameNames.map((s) => s.length));
    for (const type of gameNames) {
      const s = stats.get(type);
      const rate = ((s.pass / s.n) * 100).toFixed(1);
      const tag = NEW_IN_THIS_CHANGE.includes(type) ? "NEW" : "   ";
      c2.note(
        `${tag} ${type.padEnd(width)}  ${String(s.pass).padStart(5)}/${String(s.n).padEnd(5)} ${rate.padStart(6)}%` +
          `${s.fail ? `  WRONG:${s.fail}` : ""}${s.invalidFormat ? `  BADFORMAT:${s.invalidFormat}` : ""}` +
          `${s.threw ? `  threw:${s.threw}` : ""}${s.noAnswer ? `  noanswer:${s.noAnswer}` : ""}  ${s.ms}ms`,
      );
    }

    for (const type of gameNames) {
      const s = stats.get(type);
      if (s.fail) {
        c2.fail(`${type}: ${s.fail}/${s.n} answers REJECTED by the game's validator`, s.firstWrong);
      }
      if (s.invalidFormat) {
        // A format error never even reaches the solver check — the answer is
        // the wrong JS type or shape for validateAnswer().
        c2.fail(`${type}: ${s.invalidFormat}/${s.n} answers rejected as the wrong FORMAT`, s.firstInvalid);
      }
      if (s.threw) {
        // Safe (contract survives) but it means this type earns nothing, which
        // is the thing the whole change exists to fix.
        c2.fail(`${type}: solver threw on ${s.threw}/${s.n} generated instances`, s.firstThrow);
      }
      if (s.noAnswer) {
        c2.fail(
          `${type}: solver returned undefined/null on ${s.noAnswer}/${s.n} instances`,
          "ctauto.js:95 reads that as 'no solver' and skips — money left on the table with no error anywhere",
        );
      }
    }

    const totalPass = [...stats.values()].reduce((a, s) => a + s.pass, 0);
    const totalN = [...stats.values()].reduce((a, s) => a + s.n, 0);
    c2.note(`OVERALL ${totalPass}/${totalN} accepted (${((totalPass / totalN) * 100).toFixed(2)}%) across ${gameNames.length} types`);
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- CT3 --- */
  // Compression III is the only contract here whose validator does not compare
  // against a fixed answer: Compression.ts:158 accepts anything no longer than
  // the game's optimum that decodes back. That makes it the one type where a
  // subtly-worse solver passes nothing and a subtly-BETTER-looking one could
  // still be accepted by luck on easy instances. Asserting the excess is
  // exactly zero every time is much stronger than asserting acceptance.
  const c3 = new Check("CT3", "Compression III matches the game's optimal length exactly, not merely often");
  {
    c3.examined(compressionIIIExcess.length);
    if (!compressionIIIExcess.length) {
      c3.fail("no Compression III instances were measured", "the sample loop did not run — this check proved nothing");
    } else {
      const worst = Math.max(...compressionIIIExcess);
      const best = Math.min(...compressionIIIExcess);
      const nonZero = compressionIIIExcess.filter((d) => d !== 0).length;
      c3.note(`excess over the game's DP optimum across ${compressionIIIExcess.length} instances: min ${best}, max ${worst}, non-zero ${nonZero}`);
      if (worst > 0) {
        c3.fail(`our encoding is up to ${worst} chars longer than optimal`, "Compression.ts:158 rejects anything longer than the game's own answer");
      }
      if (best < 0) {
        // Would mean the game's DP is not optimal. Accepted by the validator,
        // but it is a claim worth noticing rather than silently enjoying.
        c3.warn(`our encoding is up to ${-best} chars SHORTER than the game's own answer`, "still accepted, but it means the game's DP is not optimal — worth reporting upstream");
      }
    }
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- CT4 --- */
  // The branches where a correct answer is falsy. This repo has been bitten
  // repeatedly by `0 ?? fallback` and by truthiness checks swallowing a real
  // result; here the cost would be a skipped contract at best and, if the
  // shape were wrong, a destroyed one.
  //
  // The check is really about the SAMPLE, not the solver: CT2 can only have
  // tested these paths if random generation actually produced them. Zero
  // observations means CT2 is silent about the case, and silence reads as
  // "checked and fine".
  const c4 = new Check("CT4", "the falsy-but-correct answers were actually exercised by the sample");
  {
    const branches = [
      ["Shortest Path in a Grid", "emptyString", "grids with no path at all — answer is '' (ShortestPathInAGrid.ts:101)"],
      ["Proper 2-Coloring of a Graph", "emptyArray", "non-bipartite graphs — answer is [] (Proper2ColoringOfAGraph.ts:281)"],
      ["Array Jumping Game II", "zero", "unreachable last index — answer is 0 (ArrayJumpingGame.ts:104-106)"],
    ];
    for (const [type, key, why] of branches) {
      c4.examined(1);
      const s = stats.get(type);
      const seen = s?.[key] ?? 0;
      c4.note(`${type}: ${seen}/${s?.n ?? 0} instances took the falsy branch — ${why}`);
      if (seen === 0) {
        c4.fail(`${type}: the falsy-answer branch never occurred in ${s?.n ?? 0} instances`, `CT2 therefore says nothing about it. Raise CT_N, or the generator has changed. ${why}`);
      }
    }

    // Hamming decode must handle both a clean block and a corrupted one
    // (HammingCode.ts:77,83-86 flips a bit ~55% of the time). Detected here by
    // recomputing the syndrome independently of the solver, so this is not the
    // solver marking its own homework.
    c4.examined(1);
    let clean = 0;
    let flipped = 0;
    const HN = Math.min(500, sampleFor("HammingCodes: Encoded Binary to Integer"));
    for (let i = 0; i < HN; i++) {
      const data = new game.CodingContract("h.cct", "HammingCodes: Encoded Binary to Integer").getData();
      let syndrome = 0;
      for (let j = 0; j < data.length; j++) if (data[j] === "1") syndrome ^= j;
      if (syndrome === 0) clean++;
      else flipped++;
    }
    c4.note(`HammingCodes decode: ${flipped}/${HN} sampled blocks carry a flipped bit, ${clean} are clean`);
    if (!flipped || !clean) {
      c4.fail("the Hamming decode sample did not contain both corrupted and clean blocks", "the two are different code paths and only one was exercised");
    }

    // Square Root must round to nearest, not floor: the generator deliberately
    // straddles both sides (SquareRoot.ts:157-163). Read the stored state to
    // see which side each instance fell on — again independent of the solver.
    c4.examined(1);
    let up = 0;
    let down = 0;
    const SN = Math.min(500, sampleFor("Square Root"));
    for (let i = 0; i < SN; i++) {
      const contract = new game.CodingContract("s.cct", "Square Root");
      // state is [root, offset] as decimal strings (SquareRoot.ts:150-166)
      if (BigInt(contract.state[1]) > BigInt(0)) up++;
      else down++;
    }
    c4.note(`Square Root: ${up}/${SN} instances round DOWN to the root (offset > 0), ${down} round UP (offset <= 0)`);
    if (!up || !down) {
      c4.fail("the Square Root sample fell on only one side of the rounding boundary", "a floor-only solver would have passed CT2 — this is the check that makes CT2 mean something");
    }
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- CT5 --- */
  // ctsolvers.js is imported by ctauto.js, which runs resident. The module has
  // always been free — no ns reference anywhere in it — and that is a property
  // of the SOURCE TEXT, not of intent: the game prices every bare identifier by
  // name (RamCalculations.ts findFunc), so a local variable called `attempt` or
  // `weaken` in a new solver would quietly add 10GB to every importer.
  const c5 = new Check("CT5", "the module still contributes 0GB — a stray identifier name cannot tax ctauto.js");
  {
    const ram = await import("../../test/ram.mjs");
    await ram.load();
    ram.asSave({ bitNode: 4, sf: {} });
    const staged = fs.readFileSync(TARGET, "utf8");
    const base = ram.ramBase();

    c5.examined(1);
    const alone = ram.priceOverlay({ "ctsolvers.js": staged }, "ctsolvers.js");
    if (alone.error) c5.fail(`could not price ctsolvers.js: ${alone.error}`);
    else {
      c5.note(`ctsolvers.js alone: ${alone.cost}GB (script base cost is ${base}GB, so its contribution to an importer is ${(alone.cost - base).toFixed(2)}GB)`);
      if (alone.cost !== base) {
        c5.fail(
          `ctsolvers.js prices at ${alone.cost}GB, ${(alone.cost - base).toFixed(2)}GB above base`,
          `entries: ${JSON.stringify(alone.entries)}\nSome identifier in the file matches an ns function name. ctauto.js pays this, resident.`,
        );
      }
    }

    c5.examined(1);
    const before = ram.ramOf("ctauto.js");
    const after = ram.priceOverlay({ "ctsolvers.js": staged }, "ctauto.js");
    if (after.error) c5.fail(`could not price ctauto.js with the staged module: ${after.error}`);
    else {
      c5.note(`ctauto.js: ${before.cost ?? "?"}GB deployed -> ${after.cost}GB with the staged ctsolvers.js`);
      if (before.cost !== undefined && after.cost > before.cost) {
        c5.fail(`the staged ctsolvers.js raises ctauto.js from ${before.cost}GB to ${after.cost}GB`, JSON.stringify(after.entries));
      }
    }
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- CT6 --- */
  // findAnswer's contract with its one caller.
  const c6 = new Check("CT6", "findAnswer still returns undefined (not a throw) for a type it does not know");
  {
    c6.examined(1);
    let got;
    try {
      got = findAnswer({ type: "No Such Contract Type", data: null });
    } catch (err) {
      c6.fail("findAnswer threw on an unknown type", `ctauto.js:90-94 survives this, but counts it as a solver error rather than 'no solver': ${err}`);
    }
    if (got !== undefined) c6.fail(`findAnswer returned ${JSON.stringify(got)} for an unknown type, expected undefined`);
    c6.note("an unknown contract type yields undefined, which ctauto.js:95 turns into a skip — the contract survives");
  }
  checks.push(c6);

  return checks;
}

// Standalone entry point, so this can be run without the suite while staged.
if (import.meta.url === `file://${process.argv[1]}`) {
  const checks = await run();
  for (const c of checks) c.print();
  const fails = checks.reduce((s, c) => s + c.fails.length, 0);
  const examined = checks.reduce((s, c) => s + c.counted, 0);
  console.log(`\n${checks.length} checks, ${examined} things examined, ${fails} FAIL`);
  process.exit(fails ? 1 : 0);
}
