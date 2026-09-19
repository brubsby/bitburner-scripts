// [BU] the money controller.
//
// The property that matters is the one the old scattered constants violated:
// a LOW-priority spender must never be able to empty an account that a
// HIGH-priority one has already claimed. buyserv.js spending every surplus
// dollar every 15 seconds is what pinned homeup.js below its trigger for an
// entire life, while home is the only purchase that survives an install.

import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { rootScripts, source, codeOnly } from "./ram.mjs";

const b = await import("../../budget.js");
const { reserveFor, spendable, augClaim, joinClaim, PRIORITY } = b;

export function run() {
  const checks = [];

  /* ---------------------------------------------------------------- BU1 --- */
  const c1 = new Check("BU1", "priority is the SURVIVAL order, and higher claims are held back in full");
  {
    c1.examined(1);
    // The order encodes what survives an install — augmentations and home do,
    // cloud servers and cash do not — with ONE thing above all of them.
    //
    // `join` is money that must be HELD to buy a faction INVITATION. It
    // outranks augmentations because it is the END rather than a means to it:
    // Daedalus admits on $100b in hand, it sells the augmentation that leaves
    // the BitNode, and no quantity of other augmentations substitutes. Live in
    // BitNode 1, with Daedalus's other two gates already met and income at
    // $477b/h, the balance FELL from $6.02b to $5.10b — buyserv.js converting
    // it into cloud servers as fast as it arrived, because nothing in this
    // file knew the join existed. The gate was not distant, it was unreachable.
    if (PRIORITY.join(",") !== "join,augmentations,home,servers,neuroflux,hacknet,gang") {
      c1.fail(`PRIORITY is ${PRIORITY.join(",")}`, "the order encodes what survives an install — changing it is a model change, not a tweak");
    }

    const claims = { join: 0, augmentations: 100e6, home: 40e6 };
    c1.examined(1);
    if (reserveFor("join", claims) !== 0) c1.fail("the top priority must reserve nothing");
    c1.examined(1);
    if (reserveFor("augmentations", claims) !== 0) c1.fail("a zero join claim holds nothing back from augmentations");
    c1.examined(1);
    if (reserveFor("home", claims) !== 100e6) c1.fail(`home must hold back the augmentation claim, got ${reserveFor("home", claims)}`);
    c1.examined(1);
    if (reserveFor("servers", claims) !== 140e6) c1.fail(`servers must hold back augmentations AND home, got ${reserveFor("servers", claims)}`);
    c1.examined(1);
    if (reserveFor("neuroflux", claims) !== 140e6) c1.fail("neuroflux sits below servers and holds back everything above it");
    // And a real join claim is held back by EVERYTHING below it.
    c1.examined(1);
    const withJoin = { join: 100e9, augmentations: 100e6, home: 40e6 };
    if (reserveFor("augmentations", withJoin) !== 100e9) c1.fail(`augmentations must hold back the join, got ${reserveFor("augmentations", withJoin)}`);
    if (reserveFor("servers", withJoin) !== 100e9 + 140e6) c1.fail(`servers must hold back join + augmentations + home, got ${reserveFor("servers", withJoin)}`);
  }
  checks.push(c1);

  /* ---------------------------------------------------------------- BU2 --- */
  const c2 = new Check("BU2", "an UNREADABLE claim holds back everything — it is never treated as zero");
  {
    // This is the whole safety property. "I could not tell what is promised"
    // must not become "nothing is promised", or the lowest-priority spender
    // drains the account the highest-priority one was about to use.
    for (const [name, claims] of [
      ["missing", {}],
      ["null", { augmentations: null }],
      ["undefined", { augmentations: undefined }],
      ["NaN", { augmentations: NaN }],
      ["Infinity", { augmentations: Infinity }],
      ["negative", { augmentations: -1 }],
      ["string", { augmentations: "100" }],
    ]) {
      c2.examined(1);
      if (isFinite(reserveFor("servers", claims))) c2.fail(`an ${name} augmentation claim did not block spending`);
      c2.examined(1);
      if (spendable("servers", 1e12, claims) !== 0) c2.fail(`an ${name} claim still allowed spending`);
    }
    // A caller may opt into guessing, but must do it explicitly.
    c2.examined(1);
    if (reserveFor("servers", {}, { fallback: 0 }) !== 0) c2.fail("an explicit finite fallback must be honoured");
  }
  checks.push(c2);

  /* ---------------------------------------------------------------- BU3 --- */
  const c3 = new Check("BU3", "spendable never goes negative and never exceeds the balance");
  {
    const claims = { join: 0, augmentations: 100e6, home: 40e6 };
    c3.examined(1);
    if (spendable("servers", 50e6, claims) !== 0) c3.fail("a balance below the reserve must yield 0, not a negative");
    c3.examined(1);
    if (spendable("servers", 200e6, claims) !== 60e6) c3.fail(`expected 60e6 spendable, got ${spendable("servers", 200e6, claims)}`);
    c3.examined(1);
    if (spendable("join", 200e6, claims) !== 200e6) c3.fail("the top priority may spend the whole balance");
    for (const bad of [0, -5, NaN, Infinity, undefined, null, "x"]) {
      c3.examined(1);
      if (spendable("servers", bad, claims) !== 0) c3.fail(`an unreadable balance (${String(bad)}) must yield 0`);
    }
  }
  checks.push(c3);

  /* ---------------------------------------------------------------- BU4 --- */
  const c4 = new Check("BU4", "augClaim rejects a plan from a PREVIOUS life rather than honouring it");
  {
    const good = JSON.stringify({ lastAugReset: 1000, plan: { totalCost: 250e6 } });
    c4.examined(1);
    if (augClaim(good, 1000) !== 250e6) c4.fail("a current-life plan must be read");
    c4.examined(1);
    // lastAugReset moves on every install; a plan priced against a fleet and a
    // reputation that no longer exist is worse than no plan at all.
    if (augClaim(good, 2000) !== null) c4.fail("a plan from a previous life must be rejected");
    c4.examined(1);
    if (augClaim(good, undefined) !== 250e6) c4.fail("with no life stamp to compare, the plan is usable");
    for (const [name, text] of [
      ["empty", ""],
      ["null", null],
      ["not json", "{oops"],
      ["no plan and no `planned` flag", JSON.stringify({ lastAugReset: 1000 })],
      ["plan without cost", JSON.stringify({ lastAugReset: 1000, plan: {} })],
      ["negative cost", JSON.stringify({ lastAugReset: 1000, plan: { totalCost: -1 } })],
      ["array", "[]"],
    ]) {
      c4.examined(1);
      if (augClaim(text, 1000) !== null) c4.fail(`${name} must read as UNKNOWN (null), not as a number`,
        "an unknown claim blocks spending; a numeric claim licenses it — collapsing them is the bug this file exists to prevent");
    }

    // ...but an EXPLICIT "nothing planned" is a known claim of zero, and must
    // not block. This is the case that makes absence meaningful: progress.js
    // publishes `planned: false` every pass, so a missing file can only mean
    // the publisher is dead.
    c4.examined(1);
    const none = JSON.stringify({ lastAugReset: 1000, planned: false, plan: null });
    if (augClaim(none, 1000) !== 0) c4.fail(`an explicit "nothing planned" read as ${augClaim(none, 1000)}, expected 0`,
      "otherwise every spender halts whenever there is simply nothing to buy");
    c4.examined(1);
    // And a stale-life "nothing planned" is still unknown — the fleet and
    // reputation it was computed against no longer exist.
    if (augClaim(none, 2000) !== null) c4.fail("a previous life's 'nothing planned' must still read as unknown");
  }
  checks.push(c4);

  /* ---------------------------------------------------------------- BU5 --- */
  const c5 = new Check("BU5", "the live regression: servers cannot starve home");
  {
    // What actually happened: buyserv spent every surplus dollar every 15s, so
    // the balance never reached homeup's trigger, and home — which SURVIVES an
    // install — was never upgraded while cloud servers, which do not, ate 77%
    // of gross income.
    const money = 500e6;
    const claims = { join: 0, augmentations: 0, home: 320e6 }; // home upgrade pending
    c5.examined(1);
    const serversMay = spendable("servers", money, claims);
    if (serversMay !== 180e6) c5.fail(`servers could spend ${serversMay}, leaving home short`);
    c5.examined(1);
    if (spendable("home", money, claims) !== 500e6) c5.fail("home outranks servers and may use the balance");
    c5.examined(1);
    // And with an augmentation plan outstanding, servers yield to that too.
    const withAugs = spendable("servers", money, { augmentations: 400e6, home: 320e6 });
    if (withAugs !== 0) c5.fail(`servers spent ${withAugs} while augmentations and home were both claimed`);
  }
  checks.push(c5);

  /* ---------------------------------------------------------------- BU6 --- */
  const c6 = new Check("BU6", "no caller coerces an UNKNOWN claim into a number — the guard cannot be bypassed");
  {
    // BU2 proves budget.js blocks on an unreadable claim. It cannot prove the
    // callers let it: `augClaim(...) ?? 0` turns the infinite hold into no hold
    // at all, entirely outside this module. That coercion was written at TWO
    // call sites within minutes of the module being added, and the unit tests
    // stayed green throughout — a property asserted only inside the thing it
    // protects is not asserted at all.
    //
    // So this checks the SHIPPED call sites. Comments and strings are stripped
    // first (ram.mjs's codeOnly), so a comment explaining the rule cannot trip it.
    // A BALANCED-PAREN SCAN, not a regex. The obvious
    // /augClaim\s*\([^)]*\)\s*(\?\?|\|\|)/ cannot see the real call site,
    // because `[^)]*` stops at the first `)` — which is inside the nested
    // `ns.read(GATE_FILE)` argument. That version reported PASS against a
    // deliberately reintroduced `?? 0`, i.e. it was a check that could not
    // fail. Verified by putting the bug back and watching it stay green.
    const coercionAfter = (code) => {
      for (let i = code.indexOf("augClaim("); i >= 0; i = code.indexOf("augClaim(", i + 1)) {
        let depth = 0;
        let j = i + "augClaim".length;
        for (; j < code.length; j++) {
          if (code[j] === "(") depth++;
          else if (code[j] === ")" && --depth === 0) break;
        }
        const tail = code.slice(j + 1, j + 12);
        if (/^\s*(\?\?|\|\|)/.test(tail)) return code.slice(i, j + 1 + 8);
      }
      return null;
    };
    let seen = 0;
    for (const name of rootScripts()) {
      const code = codeOnly(name);
      if (!code.includes("augClaim(")) continue;
      seen++;
      c6.examined(1);
      const hit = coercionAfter(code);
      if (hit) {
        c6.fail(
          `${name} coerces an unknown augmentation claim: \`${hit.replace(/\s+/g, " ").slice(0, 70)}\``,
          "null means 'could not determine' and must reach budget.js so the fallback decides. " +
            "Coercing it to a number converts every failure into permission to spend — the exact bug this module exists to prevent.",
        );
      } else {
        c6.note(`${name} passes the claim through unchanged`);
      }
    }
    c6.examined(1);
    if (seen === 0) {
      c6.fail("no root script calls augClaim at all", "this check has no subject, which is indistinguishable from passing");
    }
  }
  checks.push(c6);

  /* ---------------------------------------------------------------- BU7 --- */
  const c7 = new Check("BU7", "income-discounted claims: the NET hold is honoured, and a bad discount widens, never narrows");
  {
    // The live failure: a $33.7b gross plan against $19.8b cash held every
    // dollar and starved the fleet to zero servers, while $7.3M/s income
    // covered the plan within a window. budgetClaim is the publisher's own
    // net figure; augClaim must prefer it — and must fall back to the GROSS
    // cost on any unreadable discount, because a broken discount that
    // narrowed the hold would be the ?? 0 bug wearing a new coat.
    const mk = (budgetClaim) => JSON.stringify({ lastAugReset: 1000, plan: { totalCost: 33.7e9 }, budgetClaim });
    c7.examined(1);
    if (augClaim(mk(5e9), 1000) !== 5e9) c7.fail("a readable net claim must be honoured");
    c7.examined(1);
    if (augClaim(mk(0), 1000) !== 0) c7.fail("a fully income-covered plan is a claim of ZERO — spenders run free");
    c7.examined(1);
    for (const bad of [NaN, -1, Infinity, "5e9", null]) {
      const got = augClaim(mk(bad), 1000);
      if (got !== 33.7e9) c7.fail(`unreadable discount ${String(bad)} must widen to the gross cost, got ${got}`);
    }
    c7.examined(1);
    // Staleness still dominates: a previous life's net claim is as dead as
    // its gross one.
    if (augClaim(mk(5e9), 2000) !== null) c7.fail("a stale life's net claim must read as unknown");
  }
  checks.push(c7);

  /* ---------------------------------------------------------------- BU8 --- */
  const c8 = new Check("BU8", "the payback exception fails CLOSED: home yields to fleet only on a full, measured inequality");
  {
    // Live shape: home 4TB->8TB is $31.7b for 4096GB (~$7.7M/GB effective on
    // the delta); fleet ~$0.2M/GB; income $7.3M/s; horizon half a 1.72h window.
    const home = { amount: 31.7e9, deltaGB: 4096 };
    const pb = { fleetDollarPerGB: 0.2e6, incomePerSec: 7.3e6, horizonSec: 0.86 * 3600 };
    const claims = { join: 0, augmentations: 0, home };

    c8.examined(1);
    // The inequality holds (0.2M < 7.3M*3096/4096 ~ 5.5M): fleet spends through.
    if (reserveFor("servers", claims, { payback: pb }) !== 0) {
      c8.fail("cheap fleet with measured payback must waive the home hold");
    }
    c8.examined(1);
    // Expensive fleet (past the softcap knee): the hold comes back. This is
    // the SELF-LIMIT — the exception shuts itself off as fleet $/GB rises.
    if (reserveFor("servers", claims, { payback: { ...pb, fleetDollarPerGB: 6e6 } }) !== 31.7e9) {
      c8.fail("fleet past the economic knee must be held again");
    }
    c8.examined(1);
    // EVERY missing or unreadable input restores the full hold — the
    // exception must be impossible to enable by accident or by breakage.
    for (const [name, opts, cl] of [
      ["no payback at all", {}, claims],
      ["payback missing income", { payback: { fleetDollarPerGB: 0.2e6, horizonSec: 3000 } }, claims],
      ["NaN fleet price", { payback: { ...pb, fleetDollarPerGB: NaN } }, claims],
      ["zero horizon", { payback: { ...pb, horizonSec: 0 } }, claims],
      ["object claim missing deltaGB", { payback: pb }, { join: 0, augmentations: 0, home: { amount: 31.7e9 } }],
      ["legacy numeric home claim", { payback: pb }, { join: 0, augmentations: 0, home: 31.7e9 }],
    ]) {
      if (reserveFor("servers", cl, opts) !== 31.7e9) c8.fail(`${name} must keep the full home hold`);
    }
    c8.examined(1);
    // An unreadable AMOUNT inside the object is unknown, not zero — infinite
    // hold, exactly as a plain unreadable claim would be.
    if (isFinite(reserveFor("servers", { join: 0, augmentations: 0, home: { amount: NaN, deltaGB: 4096 } }, { payback: pb }))) {
      c8.fail("an unreadable object amount must block everything");
    }
    c8.examined(1);
    // The exception NEVER touches the augmentations claim, and home itself
    // still reads its own claim as zero-held (it is the claimant).
    if (reserveFor("servers", { join: 0, augmentations: 5e9, home }, { payback: pb }) !== 5e9) {
      c8.fail("augmentations stay held even while home is waived");
    }
    if (reserveFor("home", { join: 0, augmentations: 5e9, home }, { payback: pb }) !== 5e9) {
      c8.fail("home's own reserve is unchanged by the exception");
    }
  }
  checks.push(c8);

  /* ---------------------------------------------------------------- BU9 --- */
  const c12 = new Check("BU12", "the money-return exception: a spend that repays itself before the horizon passes the home hold, and nothing else does");
  {
    const claims = { join: 0, augmentations: 0, home: { amount: 31.7e9, deltaGB: 2048 } };
    const ok = { moneyReturn: { cost: 134, gainPerSec: 2.39, horizonSec: 1700 } }; // 4063 > 134
    c12.examined(1);
    if (reserveFor("hacknet", claims, { payback: ok }) !== 0) c12.fail("a purchase repaid 30x over before the horizon must waive the home hold");
    c12.examined(1);
    if (reserveFor("hacknet", claims, { payback: { moneyReturn: { cost: 134, gainPerSec: 2.39, horizonSec: 50 } } }) !== 31.7e9) c12.fail("a purchase NOT repaid before the horizon keeps the full hold");
    for (const [label, mr] of [
      ["no cost", { gainPerSec: 2.39, horizonSec: 1700 }],
      ["zero gain", { cost: 134, gainPerSec: 0, horizonSec: 1700 }],
      ["no horizon", { cost: 134, gainPerSec: 2.39 }],
      ["negative horizon", { cost: 134, gainPerSec: 2.39, horizonSec: -1 }],
    ]) {
      c12.examined(1);
      if (reserveFor("hacknet", claims, { payback: { moneyReturn: mr } }) !== 31.7e9) c12.fail(`${label}: an unreadable input must keep the hold`);
    }
    c12.examined(1);
    // The join and augmentation claims are never waived by this form.
    if (reserveFor("hacknet", { join: 100e9, augmentations: 5e9, home: { amount: 31.7e9, deltaGB: 2048 } }, { payback: ok }) !== 105e9) {
      c12.fail("join and augmentation claims must still be held in full");
    }
  }
  checks.push(c12);

  // ---------------------------------------------------------------------
  const c13 = new Check("BU13", "the ln(M) competition: join and augmentation claims yield to a spend with strictly more ln per dollar; unreadable rivals and the home claim hold");
  {
    const { marginalLnPerDollar } = b;
    const claims = { join: 100e9, augmentations: 5e9, home: { amount: 1e9, deltaGB: 512 } };
    c13.examined(1);
    if (reserveFor("gang", claims) !== 106e9) c13.fail("no competition: every claim held");
    const win = { lnPerDollar: 1e-9, rivals: { join: 1e-10, augmentations: 5e-10 } };
    if (reserveFor("gang", claims, { lnCompete: win }) !== 1e9) c13.fail("beating both rivals leaves only the home claim");
    if (reserveFor("gang", claims, { lnCompete: { lnPerDollar: 3e-10, rivals: { join: 1e-10, augmentations: 5e-10 } } }) !== 6e9) c13.fail("beating only the join rival waives only the join claim");
    if (reserveFor("gang", claims, { lnCompete: { lnPerDollar: 1e-10, rivals: { join: 1e-10, augmentations: 5e-10 } } }) !== 106e9) c13.fail("equal is not strictly better: hold");
    for (const [label, lc] of [
      ["no own figure", { rivals: { join: 0, augmentations: 0 } }],
      ["zero own figure", { lnPerDollar: 0, rivals: { join: 0, augmentations: 0 } }],
      ["null rivals", { lnPerDollar: 1, rivals: { join: null, augmentations: null } }],
      ["no rivals", { lnPerDollar: 1 }],
    ]) {
      c13.examined(1);
      if (reserveFor("gang", claims, { lnCompete: lc }) !== 106e9) c13.fail(`${label}: an unreadable side must keep both claims`);
    }
    c13.examined(1);
    if (reserveFor("gang", claims, { lnCompete: { lnPerDollar: Infinity, rivals: { join: 0, augmentations: 0 } } }) !== 1e9) c13.fail("the home claim is never waived by the competition");
    // marginalLnPerDollar reads the gate file.
    c13.examined(1);
    const gate = JSON.stringify({ lastAugReset: 7, planned: true, plan: { buy: [{ price: 1e6, m: 1.1 }, { price: 4e6, m: 1.05 }] }, joinClaim: 100e9, joinValueLn: 12.5 });
    const r = marginalLnPerDollar(gate, 7);
    if (Math.abs(r.augmentations - Math.log(1.05) / 4e6) > 1e-20) c13.fail("augmentations rival is the plan's least ln per dollar");
    if (Math.abs(r.join - 12.5 / 100e9) > 1e-20) c13.fail("join rival is value over requirement");
    const stale = marginalLnPerDollar(gate, 8);
    if (stale.augmentations !== null || stale.join !== null) c13.fail("a stale-life gate reads as unreadable");
    const empty = marginalLnPerDollar(JSON.stringify({ lastAugReset: 7, planned: false, plan: null, joinClaim: 0 }), 7);
    if (empty.augmentations !== 0 || empty.join !== 0) c13.fail("an explicit empty plan and a zero join claim displace nothing: 0");
    const noVal = marginalLnPerDollar(JSON.stringify({ lastAugReset: 7, planned: false, plan: null, joinClaim: 100e9 }), 7);
    if (noVal.join !== null) c13.fail("a join claim without a value is unreadable, never 0");
    if (marginalLnPerDollar("not json", 7).join !== null) c13.fail("garbage is unreadable");
    c13.note("waivers per claim, strictness, unreadable sides, home never, gate parsing");
  }
  checks.push(c13);

  /* ---------------------------------------------------------------- BU9 --- */
  const c9 = new Check("BU9", "joinClaim: money held for an INVITATION, refused when unreadable or from another life");
  {
    const life = 12345;
    const doc = (o) => JSON.stringify({ lastAugReset: life, ...o });
    c9.examined(1);
    if (joinClaim(doc({ joinClaim: 100e9 }), life) !== 100e9) c9.fail("a real claim must be held in full");
    if (joinClaim(doc({ joinClaim: 0 }), life) !== 0) c9.fail("an explicit zero is a KNOWN claim of nothing, not an unknown");

    // STALE LIFE IS UNKNOWN, not zero — the same rule augClaim enforces. A
    // claim from a previous install describes a balance that no longer exists.
    c9.examined(1);
    if (joinClaim(doc({ joinClaim: 100e9 }), 999) !== null) c9.fail("a claim from another life must refuse, not read as its old value");

    // Unreadable is null, and null BLOCKS — reserveFor turns it into the
    // fallback. A spender that reads a missing claim as zero is the spender
    // that empties the account: live, the balance fell from $6.02b to $5.10b
    // at $477b/h income because nothing knew the Daedalus join existed.
    c9.examined(1);
    for (const bad of ["", "not json", "[]", "null", doc({}), doc({ joinClaim: null }), doc({ joinClaim: -1 }), doc({ joinClaim: NaN }), doc({ joinClaim: "100" })]) {
      if (joinClaim(bad, life) !== null) c9.fail(`unreadable claim must be null: ${String(bad).slice(0, 40)}`);
    }
    c9.examined(1);
    if (isFinite(reserveFor("servers", { join: null, augmentations: 0, home: 0 }))) {
      c9.fail("an unreadable join claim must BLOCK the fleet, not license it");
    }
    c9.note("held in full, zero is known, stale life and garbage both refuse, refusal blocks spending");
  }
  checks.push(c9);

  return checks;
}
