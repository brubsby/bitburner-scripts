// The gang, run by gangplan.js's arithmetic.
//
//   run gang.js
//
// WHAT IT DOES, every ten seconds:
//   1. If no gang exists and the game allows one (gangplan.gangAllowed —
//      BitNode 2, or Source-File 2 with karma <= -54,000), create it with the
//      first joined faction that can host one. Joining that faction is
//      progress.js's job: in a gang-capable node it targets the cheapest
//      gang faction to join ahead of the augmentation walk, because the gang
//      faction becomes the augmentation ladder.
//   2. Recruit while respect allows (respectForMembers).
//   3. Assign every member the task gangplan.assign chooses — respect until
//      twelve members, then whatever the install gate says is binding.
//   4. Ascend members that pass gangplan.shouldAscend.
//   5. Buy the best equipment per dollar with what budget.js leaves after
//      the join, augmentation and home claims ('gang' is last in PRIORITY).
//   6. Publish /tel/gang.txt: rates, assignments with reasons, refusals.
//
// Territory warfare is engaged only when our power beats every other gang's
// (a clash we would lose costs members). Every decision names its reason in
// the telemetry, and every refusal is a refusal, not a zero.
//
// RAM: the gang API is 1-4GB per call (RamCostConstants.GangApiBase = 4);
// this file prices at ~28GB and runs ANYWHERE — a 64GB rooted host early,
// which is hours before home reaches a tier that could hold it. Telemetry
// it reads is copied from home each pass; what it writes is copied back.

import { reporter } from 'status.js'
import { gangAllowed, assign, shouldAscend, bestEquipment, discount, respectForMembers, policySearch, trainRatio, memberPower, simulateGang, scoreTrajectory, RESPECT_TO_REP, GANG_FACTIONS, MAX_MEMBERS } from 'gangplan.js'
import { spendable, augClaim, joinClaim, marginalLnPerDollar } from 'budget.js'
import { nextHomeUpgrade } from 'homecost.js'
import { bitNodeMults } from 'bitNodeMultipliers.js'
import { sfLevel } from 'sfgate.js'

const STATUS = '/tel/gang.txt'

/** Home's telemetry files, copied here when this runs off home. */
function fetchFromHome(ns, file) {
  if (ns.getHostname() === 'home') return
  try {
    ns.scp(file, ns.getHostname(), 'home')
  } catch {
    /* previous copy stays */
  }
}
function publish(ns, obj) {
  ns.write(STATUS, JSON.stringify(obj, null, 2), 'w')
  if (ns.getHostname() !== 'home') ns.scp(STATUS, 'home', ns.getHostname())
}
const GATE_FILE = '/tel/installgate.txt'
const SCHEDULE = '/tel/factionplan.txt'
const NAMES = ['ash', 'bex', 'cid', 'dov', 'eli', 'fay', 'gus', 'hal', 'ivy', 'jax', 'kit', 'lou', 'max', 'nia', 'oz', 'pip']

export async function main(ns) {
  ns.disableLog('ALL')
  const note = reporter(ns, STATUS, {})
  ns.atExit(() => note.exit('stopped', { detail: 'gang.js exited — killed, threw, or an install took it' }), 'status')
  const info = ns.getResetInfo()
  const softcap = bitNodeMults(info.currentNode)?.GangSoftcap
  let bought = []
  let ascended = []
  // THE RESPECT FORECAST (gangplan.js simulateGang): the gang faction's
  // reputation is respect / 75 and cannot be worked for, so progress.js
  // prices its catalogue off this trajectory. Rebuilt every FORECAST_MS, one
  // sample per 5 simulated minutes over 24h, under the assignment policy
  // this file actually runs. Gross respect is what reputation integrates.
  // THE POLICY, searched by trajectory (gangplan.js policySearch): two real
  // numbers — k, train while stat weight on the hardest respect task is
  // below k x 4 x difficulty; x, the ascension gain floor — found by
  // golden-section coordinate descent against the ECONOMIC objective the
  // planner publishes (unlock ln-values inside the remaining install
  // window), plus one rollout per member who could ascend: now vs not for
  // an hour. The search is a generator: each tick spends at most
  // SEARCH_BUDGET_MS on it and the incumbent policy stays in force until a
  // search completes. A new search starts SEARCH_EVERY_MS after the last
  // decision.
  const SEARCH_BUDGET_MS = 300
  const SEARCH_EVERY_MS = 60000
  const STEP_SEC = 180
  let policy = { k: 1, x: 1.25, y: 1, w: 0, e: 1.2, assignFn: null, ascendNow: {}, at: null, score: null, sims: 0, why: 'incumbent: train until the hardest task clears, ascend at 1.25, spend the gang budget, no warfare (no search complete yet)' }
  let search = null
  let searchBudget = 0
  let compete = null
  const readClaims = () => ({
    join: joinClaim(ns.read(GATE_FILE), info.lastAugReset),
    augmentations: augClaim(ns.read(GATE_FILE), info.lastAugReset),
    home: (() => {
      const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
      if (!up) return 0
      const ram = ns.getServerMaxRam('home')
      return { amount: up.cost, deltaGB: up.kind === 'RAM' ? ram : ram / 16 }
    })(),
  })
  let searchStartedAt = 0
  let forecast = null
  let objective = null
  while (true) {
    try {
      const player = ns.getPlayer()
      const allowed = gangAllowed({ bitNode: info.currentNode, sf2: sfLevel(info, 2), karma: player.karma, disabled: info.bitNodeOptions?.disableGang === true })
      const base = { at: new Date().toISOString(), lastAugReset: info.lastAugReset, allowed }
      if (!allowed.ok) {
        publish(ns, { ...base, phase: 'refused', why: allowed.why })
        await ns.sleep(60000)
        continue
      }
      if (!ns.gang.inGang()) {
        const host = GANG_FACTIONS.find((f) => player.factions.includes(f))
        if (!host) {
          publish(ns, { ...base, phase: 'waiting', why: `no gang faction joined yet (${GANG_FACTIONS.join(', ')})` })
          await ns.sleep(30000)
          continue
        }
        const ok = ns.gang.createGang(host)
        publish(ns, { ...base, phase: ok ? 'created' : 'create-failed', faction: host })
        await ns.sleep(2000)
        continue
      }
      if (!(typeof softcap === 'number' && isFinite(softcap))) {
        publish(ns, { ...base, phase: 'refused', why: 'GangSoftcap unreadable for this node' })
        await ns.sleep(60000)
        continue
      }

      // Recruit.
      const recruited = []
      while (ns.gang.canRecruitMember()) {
        const names = ns.gang.getMemberNames()
        const name = NAMES.find((n) => !names.includes(n)) ?? `m${names.length}`
        if (!ns.gang.recruitMember(name)) break
        recruited.push(name)
      }

      const g = ns.gang.getGangInformation()
      const members = ns.gang.getMemberNames().map((n) => ns.gang.getMemberInformation(n))
      const gang = { respect: g.respect, wantedLevel: g.wantedLevel, territory: g.territory, isHacking: g.isHacking, power: g.power, faction: g.faction, territoryWarfareEngaged: g.territoryWarfareEngaged, territoryClashChance: g.territoryClashChance }
      // Rivals (getAllGangInformation): power and territory, for the
      // territory model. Unreadable -> null -> the warfare coordinate is
      // left out of the search and warfare stays off.
      let rivals = null
      try {
        const all = ns.gang.getAllGangInformation()
        rivals = Object.fromEntries(Object.entries(all).filter(([n]) => n !== g.faction).map(([n, o]) => [n, { power: o.power, territory: o.territory }]))
      } catch {
        rivals = null
      }

      // Mode: what the install gate says is binding — money means money.
      fetchFromHome(ns, GATE_FILE)
      let mode = 'respect'
      try {
        const gate = JSON.parse(ns.read(GATE_FILE) || 'null')
        if (gate?.binding?.gate === 'money') mode = 'money'
      } catch {
        /* unreadable gate: respect, the default the recruits need */
      }
      // The objective, from the planner's gang section (same life, fresh):
      // unlock values and the remaining install window. Absent -> value 0
      // and reputation at an 8h horizon decides — stated in `why`.
      if (!search && (!policy.at || Date.now() - policy.at >= SEARCH_EVERY_MS)) {
        objective = null
        try {
          fetchFromHome(ns, SCHEDULE)
          const sched = JSON.parse(ns.read(SCHEDULE) || 'null')
          const gs = sched?.gang
          if (sched?.lastAugReset === info.lastAugReset && gs && Date.now() - Date.parse(sched.at) < 20 * 60 * 1000 && gs.facRepMult > 0 && typeof gs.repNow === 'number') {
            const horizonH = Math.min(12, Math.max(2, gs.remainingWindowH ?? 8))
            objective = { unlocks: (gs.unlocks ?? []).filter((u) => typeof u.repReq === 'number' && typeof u.value === 'number'), repNow: gs.repNow, facRepMult: gs.facRepMult, favor: gs.favor ?? 0, horizonH, why: null }
          } else objective = { unlocks: [], horizonH: 8, why: 'no fresh same-life gang section in factionplan.txt' }
        } catch {
          objective = { unlocks: [], horizonH: 8, why: 'factionplan.txt unreadable' }
        }
        // THE BUDGET THE GANG MAY COMPETE FOR: everything the join,
        // augmentation and home claims hold — budget.js's
        // ln(M) competition decides after the search whether the chosen
        // spend earns it. The search sees the contested budget so y is
        // chosen against real money; the spend is then cut to what the
        // competition allows.
        const claimsNow = readClaims()
        const contested = spendable('gang', ns.getServerMoneyAvailable('home'), claimsNow, { lnCompete: { lnPerDollar: Infinity, rivals: { join: 0, augmentations: 0, home: 0 } } })
        search = policySearch(gang, members, { softcap, mode, horizonH: objective.horizonH, stepSec: STEP_SEC, objective, rivals, equipment: contested > 0 ? { budget: contested } : null, incumbent: { k: policy.k, x: policy.x, y: policy.y, w: policy.w, e: policy.e } })
        searchBudget = contested
        searchStartedAt = Date.now()
      }
      if (search) {
        const t0 = Date.now()
        let r = null
        do {
          r = search.next()
        } while (!r.done && Date.now() - t0 < SEARCH_BUDGET_MS)
        if (r.done) {
          const d = r.value
          search = null
          if (d) {
            policy = {
              k: d.k,
              x: d.x,
              y: d.y ?? policy.y,
              w: d.w ?? 0,
              e: d.e ?? policy.e,
              assignFn: trainRatio(d.k, gang.isHacking),
              ascendNow: Object.fromEntries(d.ascendNow.map((a) => [a.name, a.ascend])),
              at: Date.now(),
              score: d.score,
              sims: d.sims,
              searchMs: Date.now() - searchStartedAt,
              evals: d.evals.length,
              rollouts: d.ascendNow,
              why: objective?.why ?? null,
            }
            // The spend's own ln per dollar: the chosen trajectory's value
            // minus the same policy without equipment, over the cost.
            compete = null
            if (searchBudget > 0 && d.y > 0 && d.forecast && d.forecast.equipSpent > 0) {
              const bare = simulateGang(gang, members, { softcap, mode, horizonH: objective.horizonH, stepSec: STEP_SEC, assignFn: policy.assignFn, ascend: { minGain: d.x }, rivals, warfare: rivals ? { fraction: d.w, engageRatio: d.e } : null })
              const without = bare ? scoreTrajectory(bare, objective) : null
              const lnGain = without ? d.score.value - without.value : null
              compete = { cost: d.forecast.equipSpent, lnGain, lnPerDollar: lnGain !== null && d.forecast.equipSpent > 0 ? lnGain / d.forecast.equipSpent : null, contested: searchBudget }
            }
            const sim = d.forecast
            forecast = sim
              ? { at: new Date().toISOString(), horizonH: sim.horizonH, respectPerSec: sim.respectPerSec, policy: `k=${d.k.toFixed(3)} x=${isFinite(d.x) ? d.x.toFixed(3) : 'never'} y=${d.y ?? '-'} w=${d.w ?? '-'} e=${d.e ?? '-'}`, end: { territory: sim.territory, power: sim.power, engaged: sim.engaged, deaths: sim.deaths, equipSpent: sim.equipSpent }, samples: sim.samples.map((s) => ({ h: +s.h.toFixed(4), gross: s.gross, respect: s.respect, members: s.members })) }
              : { at: new Date().toISOString(), why: 'the chosen policy could not be simulated' }
          }
        }
      }
      if (!policy.assignFn) policy.assignFn = trainRatio(policy.k, gang.isHacking) ?? assign
      const plan = policy.assignFn(gang, members, { softcap, mode })
      if (!plan) {
        publish(ns, { ...base, phase: 'refused', why: 'assign could not read the gang' })
        await ns.sleep(30000)
        continue
      }
      // Warfare, as the search chose: the strongest w-fraction of members
      // hold Territory Warfare; engage while our power >= e x the strongest
      // rival's. Without rivals readable, none of this happens.
      let warfare = false
      if (rivals && policy.w > 0) {
        const n = Math.round(policy.w * members.length)
        for (const m of [...members].sort((a, b) => memberPower(b) - memberPower(a)).slice(0, n)) plan.assignments[m.name] = 'Territory Warfare'
        const maxRival = Math.max(...Object.values(rivals).map((r) => r.power))
        warfare = g.power >= policy.e * maxRival
      }
      try {
        if (g.territoryWarfareEngaged !== warfare) ns.gang.setTerritoryWarfare(warfare)
      } catch {
        /* leave warfare as it is */
      }
      for (const m of members) {
        const want = plan.assignments[m.name]
        if (want && m.task !== want) ns.gang.setMemberTask(m.name, want)
      }

      // Ascend only whom the rollout said to, while that decision is fresh;
      // the game's own result and the member-keeping guard still apply.
      const rolloutFresh = policy.at && Date.now() - policy.at < 3 * SEARCH_EVERY_MS
      for (const m of rolloutFresh ? members.filter((m) => policy.ascendNow[m.name]) : []) {
        const r = ns.gang.getAscensionResult(m.name)
        const v = shouldAscend(m, r, gang, { members: members.length, minGain: 1 })
        if (v.ascend && ns.gang.ascendMember(m.name)) ascended.push({ at: new Date().toISOString(), name: m.name, why: v.why })
      }
      ascended = ascended.slice(-12)

      // Equipment, inside the budget every higher claim leaves, at the
      // fraction y the search chose (equipment is lost on ascension, so
      // WHEN to spend is the trajectory's call).
      const claims = readClaims()
      // Compete: the rivals' ln per dollar from the gate file; the gang's own
      // from the last decision. Unreadable either side keeps the claims.
      fetchFromHome(ns, GATE_FILE)
      const rivalsLn = marginalLnPerDollar(ns.read(GATE_FILE), info.lastAugReset)
      const lnCompete = compete && typeof compete.lnPerDollar === 'number' && compete.lnPerDollar > 0 ? { lnPerDollar: compete.lnPerDollar, rivals: rivalsLn } : null
      const permitted = spendable('gang', ns.getServerMoneyAvailable('home'), claims, lnCompete ? { lnCompete } : {})
      // Spend what the trajectory chose, inside what the competition allows.
      let budget = Math.min(permitted, compete ? compete.cost : permitted * policy.y)
      if (compete) compete.rivals = rivalsLn
      if (compete) compete.permitted = permitted
      const disc = discount(g.respect, g.power)
      const purchases = []
      for (let round = 0; round < 24 && budget > 0; round++) {
        let best = null
        for (const m of members) {
          const e = bestEquipment(m, [...(m.upgrades ?? []), ...(m.augmentations ?? [])], budget, disc, g.isHacking)
          if (e && (!best || e.gainPerDollar > best.gainPerDollar)) best = { ...e, member: m.name }
        }
        if (!best) break
        if (!ns.gang.purchaseEquipment(best.member, best.name)) break
        budget -= best.cost
        purchases.push(best)
        const idx = members.findIndex((m) => m.name === best.member)
        if (idx >= 0) members[idx] = ns.gang.getMemberInformation(best.member)
      }
      if (purchases.length) bought = [...bought, ...purchases.map((p) => ({ at: new Date().toISOString(), ...p }))].slice(-20)

      publish(ns, {
            ...base,
            phase: 'running',
            faction: g.faction,
            isHacking: g.isHacking,
            members: members.length,
            respect: g.respect,
            respectForNextRecruit: g.respectForNextRecruit,
            nextRecruitAt: respectForMembers(members.length + 1),
            wantedLevel: g.wantedLevel,
            wantedPenalty: g.respect / (g.respect + g.wantedLevel),
            territory: g.territory,
            power: g.power,
            warfare,
            mode: plan.mode,
            rates: { gameRespectPerCycle: g.respectGainRate, gameMoneyPerCycle: g.moneyGainRate, gameWantedPerCycle: g.wantedGainRate, plannedPerSec: plan.rates },
            assignments: plan.assignments,
            why: plan.why,
            policy: { k: policy.k, x: isFinite(policy.x) ? policy.x : null, ascendNever: !isFinite(policy.x), y: policy.y, w: policy.w, e: policy.e, rivals, compete, at: policy.at ? new Date(policy.at).toISOString() : null, score: policy.score, sims: policy.sims, searchMs: policy.searchMs ?? null, evals: policy.evals ?? null, rollouts: policy.rollouts ?? null, searching: !!search, objective: objective ? { horizonH: objective.horizonH, unlocks: objective.unlocks.length, why: objective.why } : null, why: policy.why },
            forecast,
            recruited,
            ascended,
            bought,
            budget: { spendable: budget, claims: { join: claims.join, augmentations: claims.augmentations, home: typeof claims.home === 'object' ? claims.home.amount : claims.home } },
      })
      await ns.sleep(10000)
    } catch (err) {
      ns.print(`gang error: ${err}`)
      await ns.sleep(10000)
    }
  }
}
