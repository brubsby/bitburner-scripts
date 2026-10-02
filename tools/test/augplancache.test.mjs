// [APC] augplan.js answers a repeated question once, and the cache can never
// hand back a wrong or shared answer.
//
// One progress.js pass asked 107 plans, 57 of them exact repeats (a money
// ladder swept three times) — 25s of planner CPU and a 1GB page-heap jump in
// one pass (headless replica of the live BN6 save, 2026-10-02). planPurchases
// now memoises by the VALUE of its whole input. What must hold:
//
//   APC1  a repeat is a hit and returns the same plan as the first call
//   APC2  a hit is a fresh copy: mutating a returned plan cannot reach the
//         next caller
//   APC3  an offers array mutated IN PLACE is a different question (no stale
//         hit), and the answer is the uncached one
//   APC4  an input carrying a closure is planned uncached

import "./gameresolve.mjs";
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";

const A = await import("../../augplan.js");

function catalogue() {
  const F = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "tools/test/fixture-bn9-catalogue-0541.json"), "utf8"));
  let base = null;
  const find = (o) => {
    if (base || !o || typeof o !== "object") return;
    for (const [k, v] of Object.entries(o)) {
      if (k === "offers" && Array.isArray(v)) base = v;
      else find(v);
    }
  };
  find(F);
  return base.map((o) => ({ ...o, factionRep: Math.max(o.factionRep ?? 0, (o.repReq ?? 0) * 10 + 1) }));
}

export async function run() {
  const c = new Check("APC", "planPurchases memoises by input value: repeats hit, hits are copies, in-place offer edits and closures miss");
  const offers = catalogue();
  const s = A.planCacheStats;
  if (!s) {
    c.fail("augplan.js exports no planCacheStats — the cache cannot be observed");
    return c;
  }
  const money = 5e10 + Math.random(); // a key no earlier module in this process asked
  const h0 = s.hits;
  const first = A.planPurchases({ offers, money });
  const second = A.planPurchases({ offers, money });
  c.examined(4);
  if (s.hits !== h0 + 1) c.fail("APC1: an identical second call must be a cache hit", `hits ${h0} -> ${s.hits}`);
  if (JSON.stringify(first) !== JSON.stringify(second)) c.fail("APC1: the hit must be the same plan as the first call");
  if (!(first.buy.length > 0)) c.fail("APC1: the fixture must plan something, or nothing above was tested", `buy ${first.buy.length}`);

  second.buy.length = 0;
  second.logM = -1;
  const third = A.planPurchases({ offers, money });
  if (JSON.stringify(third) !== JSON.stringify(first)) c.fail("APC2: mutating a returned plan changed what the next caller got");
  if (third.buy === first.buy || third === first) c.fail("APC2: a hit must not share objects with an earlier return");

  // In place: the most valuable bought item becomes unaffordable.
  const name = first.buy[0].name;
  const target = offers.find((o) => o.name === name);
  const was = target.baseCost;
  target.baseCost = 1e30;
  const misses = s.misses;
  const edited = A.planPurchases({ offers, money });
  const fresh = A.planPurchases({ offers: offers.map((o) => ({ ...o })), money });
  if (s.misses !== misses + 1) c.fail("APC3: an offers array mutated in place must not hit the cache", `misses ${misses} -> ${s.misses}`);
  if (edited.buy.some((b) => b.name === name)) c.fail(`APC3: a stale plan came back — ${name} was priced out and is still bought`);
  if (JSON.stringify(edited) !== JSON.stringify(fresh)) c.fail("APC3: the in-place edit must plan exactly as a fresh copy of the same offers");
  target.baseCost = was;

  const m2 = s.misses;
  A.planPurchases({ offers, money, someHook: () => 1 });
  A.planPurchases({ offers, money, someHook: () => 1 });
  if (s.misses !== m2 + 2) c.fail("APC4: an input with a closure must be planned uncached each time", `misses ${m2} -> ${s.misses}`);
  c.note(`hits ${s.hits}, misses ${s.misses} in this process; first plan buys ${first.buy.length}, logM ${first.logM.toFixed(4)}`);
  return c;
}
