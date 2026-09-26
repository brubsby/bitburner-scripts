// [W] "MONEY MEANS CASH IN HAND" — the bug class, and the negative-cash escape.
//
// Where stock.js holds the book (BitNode 8, any node with TIX access) cash
// reads ~$0-$80k on a run worth billions: every gate that asked cash "can we
// afford it?" starved (2026-09-25: no plan, no install for 5.8h). The rule
// (nodeecon.js WEALTH, NOT CASH): affordability and pricing use cash + equity;
// a purchase that needs cash is preceded by a sized raise; without a trader
// equity is 0 and nothing changes.
//
//   W1  every cash read in a root script is either combined with the book on
//       its line, or on the allow-list below with a one-line reason; every
//       allow entry still matches something (a stale exemption fails)
//   W2  wealthOf / raiseRequestFor / raiseToServe: cash ~0 + equity >> 0
//       against no trader
//   W3  actplan (act.js's bootstrap): join, fare and gym fee afford on wealth
//       and RAISE first; with no trader the same state idles exactly as before
//   W4  sleeveplan: study affordable on wealth asks for cashNeed; cash < 0
//       never; no trader asks for nothing; a running class continues at >= 0
//   W5  softlockStep: each escalation level, the hold file, the two-sample
//       rule, the capital-node rule, and "unknown book is not no book"
//   W6  the trader's fee reserve is a MEDIAN of measured drains
//   W7  healthcheck WEALTH NEGATIVE
//   W8  wiring: act.js runs the escape and serves requests; every requester
//       writes its file; the trader keeps the reserve; the course is costed
import fs from "node:fs";
import path from "node:path";
import { Check } from "./harness.mjs";
import { REPO_ROOT } from "./gameresolve.mjs";
import { scanMoneyReads, isWealthLine, stripComments } from "./wealthscan.mjs";

const econ = await import("../../nodeecon.js");
const AP = await import("../../actplan.js");
const SP = await import("../../sleeveplan.js");

const src = (f) => fs.readFileSync(path.join(REPO_ROOT, f), "utf8");

// ---------------------------------------------------------------------------
// THE ALLOW-LIST. Every cash read that is NOT affordability, with why. Classes:
//   a  correct as cash — the purchase site itself (after a raise, or where the
//      trader already holds the claim in cash), the raise's own measurement,
//      the trader's accounting, a cash-in-hand game rule, or a no-SF4 route
//   d  telemetry/display, labelled as cash (wealth published beside it)
//   fp not a cash read (the scanner's variable binding is out of scope)
// `has` must appear in the read's line. A read matching no entry fails W1.
export const ALLOW = [
  { file: "act-graft.js", has: "const money = ns.getPlayer().money", cls: "a", why: "names the cash shortfall AFTER the game refused the graft" },
  { file: "act-liquidate.js", has: "ns.getServerMoneyAvailable('home') < raise", cls: "a", why: "the raise measures the cash balance it is raising" },
  { file: "act-liquidate.js", has: "const need = raise - ns.getServerMoneyAvailable('home')", cls: "a", why: "the raise sizes each sale against cash" },
  { file: "act-liquidate.js", has: "res.cash = ns.getServerMoneyAvailable('home')", cls: "a", why: "read back: did the raise land in cash" },
  { file: "act.js", has: "ns.getServerMoneyAvailable('home') < next.cost) break", cls: "a", why: "spend-down before an install: the book was just sold, cash is everything" },
  { file: "act.js", has: "ns.getServerMoneyAvailable('home') < h.next.cost) return null", cls: "a", why: "homeup's purchase: stock.js holds the home claim in cash whenever wealth covers the claims" },
  { file: "act.js", has: "const cash = ns.getServerMoneyAvailable('home')", cls: "a", why: "the escape and the bootstrap split cash from equity (stockRec) themselves" },
  { file: "act.js", has: "serveRaiseRequests(ns, info, ns.getServerMoneyAvailable('home')", cls: "a", why: "a raise is sized against cash" },
  { file: "actplan.js", has: "const cash = num(p.money) ? p.money : null", cls: "a", why: "split into cash and wealth right here (wealth = cash + s.equity)" },
  { file: "actplan.js", has: "crime loop (${crime}) already running", cls: "d", why: "progress display of the $1m gate" },
  { file: "autobuy.js", has: "const money = ns.getServerMoneyAvailable('home')", cls: "a", why: "purchase site: where money is capital it buys only on a priced verdict, and the planner's own TOR/program orders carry a cost the batch raises" },
  { file: "batch.js", has: "p.money / (4 * SETTINGS.spacing)", cls: "fp", why: "`p` is a batch plan here (plan.money = dollars per batch), not the player" },
  { file: "batch.js", has: "(slice * p.money)", cls: "fp", why: "`p` is a batch plan here, not the player" },
  { file: "bootnag.js", has: "const cash = ns.getServerMoneyAvailable('home')", cls: "a", why: "nags about idle CASH, which an install destroys (the book is sold before one)" },
  { file: "buyserv.js", has: "const money = ns.getServerMoneyAvailable('home')", cls: "a", why: "the approved spend's reserve; the raise request for it is built beside it" },
  { file: "buyserv.js", has: "const surplus = ns.getServerMoneyAvailable('home') - reserve", cls: "a", why: "purchase site; the unpriced surplus rule never sells the book (LEAD: the trader invests surplus before buyserv sees it)" },
  { file: "buyserv.js", has: "money: Math.round(ns.getServerMoneyAvailable('home'))", cls: "d", why: "buyserv.txt report of cash" },
  { file: "faction.js", has: "requirements.money > player.money", cls: "a", why: "an invitation's money requirement is cash in hand (FactionJoinCondition)" },
  { file: "faction.js", has: "requirements.money <= player.money", cls: "a", why: "same rule, reporting side" },
  { file: "fast.js", has: "money: p.money", cls: "d", why: "dashboard feed of cash; tel.js publishes wealth" },
  { file: "gang.js", has: "const cashNow = ns.getServerMoneyAvailable('home')", cls: "a", why: "paired with wealthOf on the next lines; the approved spend raises the rest" },
  { file: "hacknet.js", has: "const money = ns.getServerMoneyAvailable('home')", cls: "a", why: "purchase site; an approved upgrade the book must fund posts a raise request" },
  { file: "hash.js", has: "ns.getPlayer().money < travel_cost", cls: "a", why: "unbooted legacy: sells hashes FOR cash when a fare is short" },
  { file: "homeup.js", has: "ns.getServerMoneyAvailable('home') - next.cost < flags.reserve", cls: "a", why: "purchase site: the trader holds the home claim in cash (stock.js claimsOf)" },
  { file: "homeup.js", has: "have $${ns.format.number(ns.getServerMoneyAvailable('home'))}", cls: "d", why: "labelled display beside the purchase check" },
  { file: "homeup.js", has: "const money = ns.getServerMoneyAvailable('home')", cls: "a", why: "the UI purchase loop reads the cash the button will take" },
  { file: "homeup.js", has: "money: Math.round(ns.getServerMoneyAvailable('home'))", cls: "d", why: "homeup.txt report of cash" },
  { file: "nfg.js", has: "const money = ns.getServerMoneyAvailable('home')", cls: "a", why: "no-SF4 DOM purchase site (with Singularity the planner donates by order)" },
  { file: "progress.js", has: "const money = player?.money", cls: "a", why: "joinMoneyClaim: the Daedalus invitation needs CASH in hand, and the claim is what makes the trader raise it" },
  { file: "sleeve.js", has: "const cashNow = ns.getPlayer?.().money", cls: "a", why: "cash for the fee floor; wealth passed beside it" },
  { file: "sleeve.js", has: "} else if (player.money > travel_cost) {", cls: "a", why: "sleeve travel is a game-checked purchase with a local-gym/uni fallback" },
  { file: "sleeveaug.js", has: "ns.getServerMoneyAvailable('home') < first.raise.target", cls: "a", why: "waits for the requested raise to land in cash" },
  { file: "sleeveaug.js", has: "if (ns.getServerMoneyAvailable('home') >= target) return true", cls: "a", why: "cashFor: the purchase needs cash, else a raise request" },
  { file: "sleeveaug.js", has: "ns.getServerMoneyAvailable('home') - j2 >= ns.sleeve.getSleeveCost()", cls: "a", why: "the mandate loop buys only what the cash already raised covers" },
  { file: "stock.js", has: "const cash = ns.getServerMoneyAvailable('home')", cls: "a", why: "the trader's own accounting (wealth = cash + posValue beside it)" },
  { file: "stock.js", has: "const cashBefore = ns.getServerMoneyAvailable('home')", cls: "a", why: "the trader's flow accounting" },
  { file: "stock.js", has: "(ns.getServerMoneyAvailable('home') - raiseCash - consts.StockMarketCommission)", cls: "a", why: "an order is paid in cash" },
  { file: "stock.js", has: "const flows = ns.getServerMoneyAvailable('home') - cashBefore", cls: "a", why: "the trader's flow accounting" },
  { file: "stock.js", has: "ns.getServerMoneyAvailable('home') >= cost", cls: "a", why: "4S purchase site; the verdict is priced on wealth (buy4SVerdict)" },
  { file: "stock.js", has: "const need = cost - ns.getServerMoneyAvailable('home')", cls: "a", why: "the 4S raise is sized against cash" },
  { file: "tel.js", has: "money: Math.round(player.money)", cls: "d", why: "status.txt `money` is cash (kept for readers); `cash`, `stockEquity`, `wealth` beside it" },
  { file: "tel.js", has: "cash: Math.round(player.money)", cls: "d", why: "labelled cash" },
  { file: "torbuy.js", has: "ns.getServerMoneyAvailable('home') < TOR_COST * 1.2", cls: "a", why: "no-SF4 DOM route (exits when Singularity exists)" },
  { file: "torbuy.js", has: "have $${Math.round(ns.getServerMoneyAvailable('home'))}", cls: "d", why: "labelled display" },
  { file: "watchdog.js", has: "ns.getServerMoneyAvailable('home') > NFG_RESERVE", cls: "a", why: "no-SF4 NFG trigger only" },
  { file: "watchdog.js", has: "ns.getServerMoneyAvailable('home') >= next.cost + join", cls: "a", why: "homeup launch on an approved exit: the trader holds the home claim in cash (LEAD: not when wealth covers join+home but not join+augs+home)" },
  { file: "watchdog.js", has: "ns.getServerMoneyAvailable('home') >= next.cost + held", cls: "a", why: "homeup launch on the claims rule: the trader holds the home claim in cash" },
];

export async function run() {
  const checks = [];

  // -------------------------------------------------------------------------
  const w1 = new Check("W1", "every cash read in a root script is wealth-combined or allow-listed with a reason");
  {
    const { files, hits } = scanMoneyReads(REPO_ROOT);
    w1.examined(hits.length);
    // Establish that it looked (CLAUDE.md: a tool that returns nothing).
    if (files < 100) w1.fail(`scanned only ${files} root scripts — the scanner is not looking at the repo`);
    if (hits.length < 60) w1.fail(`only ${hits.length} cash reads found — the patterns stopped matching`);
    const used = new Set();
    let wealth = 0;
    for (const h of hits) {
      if (isWealthLine(h.text)) {
        wealth++;
        continue;
      }
      const a = ALLOW.findIndex((x) => x.file === h.file && h.text.includes(x.has));
      if (a < 0) w1.fail(`${h.file}:${h.line} reads CASH with no wealth term and no allow-list entry`, `${h.text.slice(0, 200)}\n— affordability/pricing: use cash + equity (nodeecon.wealthOf) and raise before spending; a justified cash read: add it to ALLOW in tools/test/wealth.test.mjs with why`);
      else used.add(a);
    }
    ALLOW.forEach((x, i) => {
      if (!used.has(i)) w1.fail(`stale allow-list entry: ${x.file} '${x.has}' matches no cash read`, "remove it — an exemption that never matches is decoration");
    });
    const by = ALLOW.reduce((m, x) => ((m[x.cls] = (m[x.cls] ?? 0) + 1), m), {});
    w1.note(`${hits.length} cash reads in ${files} root scripts: ${wealth} combined with the book, ${used.size} allow-listed (a ${by.a ?? 0}, d ${by.d ?? 0}, fp ${by.fp ?? 0})`);
    // The scanner itself: a comment is not a read; a template string is.
    const probe = stripComments("// ns.getServerMoneyAvailable('home')\nconst x = `${ns.getServerMoneyAvailable('home')}`\n/* player.money */");
    if (/getServerMoneyAvailable/.test(probe.split("\n")[0]) || !/getServerMoneyAvailable/.test(probe.split("\n")[1]) || /player\.money/.test(probe)) w1.fail("stripComments mis-strips", JSON.stringify(probe));
  }
  checks.push(w1);

  // -------------------------------------------------------------------------
  const w2 = new Check("W2", "wealth = cash + equity; a raise is requested only when the book can fund it; act.js serves the largest fresh one, once per cooldown");
  {
    w2.examined(12);
    const now = Date.parse("2026-09-26T00:00:00Z");
    const rec = (eq) => econ.stockRecordOf({ at: new Date(now).toISOString(), lastAugReset: 7, equity: eq }, 7, now);
    if (econ.wealthOf(8e4, rec(5e10)) !== 5e10 + 8e4) w2.fail("wealthOf does not add the book");
    if (econ.wealthOf(8e4, econ.stockRecordOf(null, 7)) !== 8e4) w2.fail("no trader: wealth must BE cash");
    if (econ.wealthOf(8e4, econ.stockRecordOf({ at: "2026-09-25T00:00:00Z", lastAugReset: 7, equity: 5e10 }, 7, now)) !== 8e4) w2.fail("a stale record must add nothing");
    if (econ.wealthOf(undefined, rec(5e10)) !== null) w2.fail("unreadable cash must be null, not a number");
    if (econ.stockRecordFromText("not json", 7, now).ok) w2.fail("malformed stock.txt must read as no record");
    const r = econ.raiseRequestFor({ cash: 8e4, equity: 5e10, target: 1e9, by: "sleeveaug", why: "x", lastAugReset: 7, now });
    if (!(r && r.target >= 1e9 && r.by === "sleeveaug")) w2.fail("cash short + book covers: a request", JSON.stringify(r));
    if (econ.raiseRequestFor({ cash: 8e4, equity: 0, target: 1e9, by: "sleeveaug", lastAugReset: 7, now }) !== null) w2.fail("no trader: never a request (behaviour unchanged)");
    if (econ.raiseRequestFor({ cash: 2e9, equity: 5e10, target: 1e9, by: "sleeveaug", lastAugReset: 7, now }) !== null) w2.fail("cash covers: no request");
    if (econ.raiseRequestFor({ cash: 0, equity: 5e8, target: 1e9, by: "sleeveaug", lastAugReset: 7, now }) !== null) w2.fail("the book cannot cover it: no request (unaffordable, not a sale)");
    const small = econ.raiseRequestFor({ cash: 0, equity: 5e10, target: 1e6, by: "sleeve", why: "fees", lastAugReset: 7, now });
    const s1 = econ.raiseToServe([r, small, null], { cash: 8e4, equity: 5e10, lastAugReset: 7, lastServedAt: 0, now });
    if (s1.serve?.by !== "sleeveaug") w2.fail("the largest fresh request is served", JSON.stringify(s1));
    const s2 = econ.raiseToServe([r], { cash: 8e4, equity: 5e10, lastAugReset: 7, lastServedAt: now - 60e3, now });
    if (s2.serve) w2.fail("a raise inside the cooldown must wait (commission, paused book)");
    const s3 = econ.raiseToServe([{ ...r, lastAugReset: 6 }, { ...r, by: "stranger" }, { ...r, at: new Date(now - 10 * 60e3).toISOString() }], { cash: 8e4, equity: 5e10, lastAugReset: 7, lastServedAt: 0, now });
    if (s3.serve) w2.fail("another life, an unknown requester or a stale request must not be served", JSON.stringify(s3));
    w2.note(`request ${JSON.stringify({ target: r?.target })}; served ${s1.serve?.by}; cooldown: ${s2.why.slice(0, 60)}`);
  }
  checks.push(w2);

  // -------------------------------------------------------------------------
  const w3 = new Check("W3", "the bootstrap affords on cash + equity and raises first; with no trader it idles exactly as before");
  {
    w3.examined(8);
    const base = (over = {}) => ({
      now: Date.parse("2026-09-26T00:00:00Z"),
      gangNode: true,
      gangWorth: { worth: true },
      factions: [],
      tried: {},
      work: null,
      progress: null,
      schedule: null,
      node: { CrimeSuccessRate: 1, CrimeMoney: 1, CrimeExpGain: 1 },
      player: { money: 8e4, karma: -20, city: "Sector-12", skills: { strength: 40, defense: 40, dexterity: 40, agility: 40, hacking: 10, charisma: 1 }, exp: {}, mults: { crime_success: 1, crime_money: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1 } },
      ...over,
    });
    const join = AP.decide(base({ equity: 5e10 }));
    if (!(join.kind === "liquidate" && join.args?.[0] === "raise" && join.args[1] >= 1e6)) w3.fail("rich book, $80k cash, every other gate met: raise the $1m first", JSON.stringify(join));
    const joinCash = AP.decide(base({ equity: 5e10, player: { ...base().player, money: 2e6 } }));
    if (joinCash.kind !== "join") w3.fail("cash already covers it: join, no raise", JSON.stringify(joinCash));
    const poor = AP.decide(base({ equity: 0 }));
    if (poor.kind === "liquidate" || poor.kind === "join") w3.fail("no trader, $80k: must not raise or join (unchanged)", JSON.stringify(poor));
    // Combat short, in the wrong city: the fare, then the gym fee floor.
    const weak = { ...base().player, city: "Aevum", skills: { ...base().player.skills, strength: 5 }, money: 1e3, karma: -20 };
    const fare = AP.decide(base({ equity: 5e10, player: weak, gangWorth: { worth: true } }));
    if (fare.kind !== "liquidate") w3.fail("rich book in the wrong city: raise the fare, never idle on 'need $200k'", JSON.stringify(fare));
    const fareNo = AP.decide(base({ equity: 0, player: weak }));
    if (fareNo.kind === "liquidate" || fareNo.kind === "travel") w3.fail("no trader, $1k: neither a raise nor a fare it cannot pay (unchanged)", JSON.stringify(fareNo));
    const atGym = { ...weak, city: "Sector-12", money: 1e3, karma: -20 };
    const gymRaise = AP.decide(base({ equity: 5e10, player: { ...atGym, money: 1e5 } }));
    if (!(gymRaise.kind === "liquidate" && gymRaise.args[1] >= AP.GYM_FEE_PER_SEC * 120)) w3.fail("at the gym, $100k cash under the $288k fee floor, rich book: raise the floor first", JSON.stringify(gymRaise));
    const gymFunded = AP.decide(base({ equity: 5e10, player: { ...atGym, money: 1e7 } }));
    if (gymFunded.kind !== "gym") w3.fail("cash covers the fee floor: train", JSON.stringify(gymFunded));
    const gymNo = AP.decide(base({ equity: 0, player: { ...atGym, money: 1e5 } }));
    if (gymNo.kind === "gym" || gymNo.kind === "liquidate") w3.fail("no trader, $100k: short of the $1m join, earns it (unchanged) — no gym, no raise", JSON.stringify(gymNo));
    const gymPoor = AP.decide(base({ equity: 5e10, player: { ...atGym, money: -5 } }));
    if (gymPoor.kind === "gym" || gymPoor.kind === "liquidate") w3.fail("cash below zero: no fee-charging work and no raise from the bootstrap (the escape owns that)", JSON.stringify(gymPoor));
    w3.note(`join: ${join.kind} ${JSON.stringify(join.args)}; no trader: ${poor.kind}; wrong city: ${fare.kind}; cash<0 at the gym: ${gymPoor.kind} (${String(gymPoor.why).slice(0, 70)}); gym at $100k cash: ${gymRaise.kind}`);
  }
  checks.push(w3);

  // -------------------------------------------------------------------------
  const w4 = new Check("W4", "sleeves: study afforded on wealth asks for cashNeed; below zero never; no trader asks nothing; a running class continues");
  {
    w4.examined(5);
    const sl = (over = {}) => ({ index: 0, sync: 100, shock: 0, skills: { hacking: 50, strength: 10, defense: 10, dexterity: 10, agility: 10, charisma: 1, intelligence: 0 }, exp: { hacking: 1000, strength: 0, defense: 0, dexterity: 0, agility: 0, charisma: 0 }, mults: { hacking_exp: 1, strength_exp: 1, defense_exp: 1, dexterity_exp: 1, agility_exp: 1, charisma_exp: 1, hacking: 1, strength: 1, defense: 1, dexterity: 1, agility: 1, charisma: 1, crime_success: 1, crime_money: 1, faction_rep: 1 }, city: "Volhaven", memory: 1, ...over });
    const exitOf = (k, t) => (t.perSec > 0 ? 10 : 20); // studying always wins
    const o = { objective: "exp", horizonHours: 1, exitOf, playerIntelligence: 0 };
    const rich = SP.sleeveAssignments([sl()], null, { ...o, money: 8e4, wealth: 5e10 });
    if (!(rich.tasks[0] === "shock" && rich.cashNeed > 0)) w4.fail("cash $80k, book $50b, study worth it: recover shock AND ask for the fee cash", JSON.stringify({ t: rich.tasks, n: rich.cashNeed, w: rich.why[0] }));
    const funded = SP.sleeveAssignments([sl()], null, { ...o, money: 5e7, wealth: 5e10 });
    if (!(funded.tasks[0] === "hacking" && funded.cashNeed === 0)) w4.fail("cash covers the floor: study, no raise", JSON.stringify({ t: funded.tasks, n: funded.cashNeed }));
    const noTrader = SP.sleeveAssignments([sl()], null, { ...o, money: 8e4 });
    if (!(noTrader.tasks[0] === "shock" && noTrader.cashNeed === 0)) w4.fail("no trader, $80k: shock and no raise (unchanged)", JSON.stringify({ t: noTrader.tasks, n: noTrader.cashNeed }));
    const negative = SP.sleeveAssignments([sl({ task: { type: "CLASS" } })], null, { ...o, money: -1e6, wealth: 5e10 });
    if (!(negative.tasks[0] === "shock" && negative.cashNeed === 0)) w4.fail("cash below zero: every fee stops, even running, even with a book (escape level 1; act.js raises)", JSON.stringify({ t: negative.tasks, n: negative.cashNeed, w: negative.why[0] }));
    const running = SP.sleeveAssignments([sl({ task: { type: "CLASS" } })], null, { ...o, money: 1e4, wealth: 5e10 });
    if (running.tasks[0] !== "hacking") w4.fail("a running class continues while cash >= 0 (no flapping at the floor)", JSON.stringify({ t: running.tasks, w: running.why[0] }));
    w4.note(`book/no cash: ${rich.tasks[0]} + cashNeed $${rich.cashNeed}; funded: ${funded.tasks[0]}; no trader: ${noTrader.tasks[0]}; cash<0: ${negative.tasks[0]}; running at $10k: ${running.tasks[0]}`);
  }
  checks.push(w4);

  // -------------------------------------------------------------------------
  const w5 = new Check("W5", "the negative-cash escape: stop, raise once per cooldown, reset only on repeated positive evidence in a capital node, never under the hold");
  {
    w5.examined(12);
    const t0 = Date.parse("2026-09-26T00:00:00Z");
    const rec = (eq, at = t0) => econ.stockRecordOf({ at: new Date(at).toISOString(), lastAugReset: 7, equity: eq }, 7, at);
    const kinds = (s) => s.actions.map((a) => a.kind).join(",");
    const ok = econ.softlockStep({ cash: 5, stock: rec(0), now: t0 });
    if (ok.level !== 0 || ok.actions.length) w5.fail("cash >= 0: nothing", JSON.stringify(ok));
    const l1 = econ.softlockStep({ cash: -100, stock: rec(0, t0), work: { type: "CLASS", classType: "Algorithms" }, hackPays: 1, now: t0 });
    if (kinds(l1) !== "stop") w5.fail("cash < 0 in a class: stop it", JSON.stringify(l1));
    const l2 = econ.softlockStep({ cash: -2.4e6, stock: rec(5e9), work: null, now: t0 });
    if (!(l2.level === 2 && kinds(l2) === "raise" && l2.actions[0].target === econ.NEG_CASH_TARGET)) w5.fail("cash < 0 with equity: one raise", JSON.stringify(l2));
    const l2b = econ.softlockStep({ cash: -2.4e6, stock: rec(5e9), lastRaiseAt: t0 - 60e3, now: t0 });
    if (l2b.actions.length) w5.fail("inside the cooldown: no second raise (no churn)", JSON.stringify(l2b));
    // Level 3: wealth <= 0, no book, BN8.
    const args = { cash: -2.4e6, stock: rec(0), hackPays: 0, queued: 0, hold: "" };
    const s1 = econ.softlockStep({ ...args, now: t0 });
    if (s1.actions.length || s1.samples.length !== 1) w5.fail("first sample: evidence only, no act", JSON.stringify(s1));
    const s1b = econ.softlockStep({ ...args, stock: rec(0, t0 + 30e3), samples: s1.samples, now: t0 + 30e3 });
    if (s1b.actions.length || s1b.samples.length !== 1) w5.fail("a second check 30s later is NOT a second sample", JSON.stringify(s1b));
    const s2 = econ.softlockStep({ ...args, stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (kinds(s2) !== "softreset") w5.fail("two samples >= 2 min apart, nothing queued: soft reset", JSON.stringify(s2));
    const s2i = econ.softlockStep({ ...args, queued: 3, stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (kinds(s2i) !== "install") w5.fail("augmentations queued: install instead", JSON.stringify(s2i));
    const held = econ.softlockStep({ ...args, hold: "user", stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (held.actions.length || !/held/.test(held.why)) w5.fail("/softlock-hold.txt disables step 3", JSON.stringify(held));
    const notCapital = econ.softlockStep({ ...args, hackPays: 1, stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (notCapital.actions.length) w5.fail("step 3 only where money is capital (ScriptHackMoneyGain 0)", JSON.stringify(notCapital));
    const unknownBook = econ.softlockStep({ ...args, stock: econ.stockRecordOf(null, 7), samples: s1.samples, now: t0 + 150e3 });
    if (unknownBook.actions.length) w5.fail("no trader record is UNKNOWN, not 'no book' — never reset on it", JSON.stringify(unknownBook));
    const rising = econ.softlockStep({ ...args, cash: -1e6, stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (rising.actions.length) w5.fail("cash rising between samples: something earns, no reset", JSON.stringify(rising));
    const blind = econ.softlockStep({ ...args, queued: null, stock: rec(0, t0 + 150e3), samples: s1.samples, now: t0 + 150e3 });
    if (blind.actions.length) w5.fail("queued count unreadable: do not choose install vs reset blind", JSON.stringify(blind));
    w5.note(`l1 ${kinds(l1)}; l2 ${kinds(l2)}; samples ${s1.samples.length}->${s2.samples.length}: ${kinds(s2)} / queued: ${kinds(s2i)}; hold: '${held.why.slice(-40)}'`);
  }
  checks.push(w5);

  // -------------------------------------------------------------------------
  const w6 = new Check("W6", "the trader's fee reserve is the median measured drain x the floor — a lumpy purchase cannot set it, income zeroes it");
  {
    w6.examined(4);
    const fees = econ.feeReserveOf([-8e3, -8e3, -8e3, -8e3, -8e3, -8e3], 240);
    if (!(Math.abs(fees.drainPerSec - 8e3) < 1 && fees.reserve === 8e3 * 240)) w6.fail("steady $8k/s drain: reserve $1.92m", JSON.stringify(fees));
    const lumpy = econ.feeReserveOf([0, 0, -5e8, 0, 0, 0, 0], 240);
    if (lumpy.reserve !== 0) w6.fail("one aug purchase must not become a reserve", JSON.stringify(lumpy));
    const income = econ.feeReserveOf([1e6, 1e6, 9e5, 1.1e6, 1e6], 240);
    if (income.reserve !== 0) w6.fail("income covers fees: no reserve", JSON.stringify(income));
    if (econ.feeReserveOf([-8e3, -8e3], 240).reserve !== 0) w6.fail("too few samples: no reserve yet");
  }
  checks.push(w6);

  // -------------------------------------------------------------------------
  const w7 = new Check("W7", "healthcheck WEALTH NEGATIVE fails on cash + equity < 0, and on cash < 0 in two samples");
  {
    w7.examined(4);
    if (econ.wealthNegativeCheck({ cash: -1e6, equity: 0 }, null).length !== 1) w7.fail("wealth < 0 must fail at once");
    if (econ.wealthNegativeCheck({ cash: -1e6, equity: 5e9 }, null).length !== 0) w7.fail("one negative-cash sample with a book is recoverable (the escape raises)");
    if (econ.wealthNegativeCheck({ cash: -1e6, equity: 5e9 }, { cash: -5e5 }).length !== 1) w7.fail("cash < 0 across two samples must fail");
    if (econ.wealthNegativeCheck({ cash: 1e3, equity: 0 }, { cash: -5e5 }).length !== 0) w7.fail("recovered: pass");
    const hc = stripComments(src("tools/healthcheck.mjs"));
    if (!/wealthNegativeCheck\(\{ cash: now\.cash, equity: now\.equity \}/.test(hc)) w7.fail("tools/healthcheck.mjs section F does not run wealthNegativeCheck");
  }
  checks.push(w7);

  // -------------------------------------------------------------------------
  const w8 = new Check("W8", "wiring: act.js escapes and serves raises; every requester writes its file; the trader keeps the reserve; costed fee orders");
  {
    const act = stripComments(src("act.js"));
    const wires = [
      [/await softlockGuard\(ns, info, node, cash, stockRec\)/.test(act), "act.js runs softlockGuard every pass"],
      [/await serveRaiseRequests\(ns, info,/.test(act), "act.js serves raise requests"],
      [/stop: 'act-stop\.js'/.test(act) && /softreset: 'act-softreset\.js'/.test(act), "act.js has the stop and softreset actors"],
      [/equity: stockRec\.ok \? stockRec\.equity : 0/.test(act), "the bootstrap state carries the trader's equity"],
      [/readHomeFile\(ns, INSTALL_HOLD_FILE\)/.test(act.slice(act.indexOf("async function softlockGuard"))), "the escape's install honours /install-hold.txt"],
      [/fileExists\('\/softlock-hold\.txt', 'home'\)/.test(stripComments(src("act-softreset.js"))), "act-softreset.js re-checks the hold itself"],
      [/reserve: feeReserve\.reserve/.test(stripComments(src("stock.js"))), "stock.js keeps the measured fee reserve"],
      [/order\('course', \[[^\]]*\], `[^`]*`, Math\.ceil\(courseFee/.test(stripComments(src("progress.js"))), "the course order carries its fee cost (withCashRaise raises it)"],
    ];
    for (const by of econ.RAISE_REQUESTERS) {
      const writers = fs.readdirSync(REPO_ROOT).filter((f) => f.endsWith(".js") && new RegExp(`raiseFileOf\\('${by}'\\)`).test(stripComments(src(f))));
      wires.push([writers.length > 0, `a script writes the '${by}' raise request (${writers.join(", ") || "none"})`]);
    }
    w8.examined(wires.length);
    for (const [ok, what] of wires) if (!ok) w8.fail(what);
  }
  checks.push(w8);

  return checks;
}
