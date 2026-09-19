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
import { gangAllowed, assign, shouldAscend, bestEquipment, discount, respectForMembers, simulateGang, GANG_FACTIONS, MAX_MEMBERS } from 'gangplan.js'
import { spendable, augClaim, joinClaim } from 'budget.js'
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
  const FORECAST_MS = 60000
  const HORIZON_H = 24
  let forecast = null

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
      const gang = { respect: g.respect, wantedLevel: g.wantedLevel, territory: g.territory, isHacking: g.isHacking }

      // Mode: what the install gate says is binding — money means money.
      fetchFromHome(ns, GATE_FILE)
      let mode = 'respect'
      try {
        const gate = JSON.parse(ns.read(GATE_FILE) || 'null')
        if (gate?.binding?.gate === 'money') mode = 'money'
      } catch {
        /* unreadable gate: respect, the default the recruits need */
      }
      const plan = assign(gang, members, { softcap, mode })
      if (!plan) {
        publish(ns, { ...base, phase: 'refused', why: 'assign could not read the gang' })
        await ns.sleep(30000)
        continue
      }
      for (const m of members) {
        const want = plan.assignments[m.name]
        if (want && m.task !== want) ns.gang.setMemberTask(m.name, want)
      }

      // Forecast, on the pre-ascension members: ascension is left out of the
      // simulation (conservative), so feeding it post-ascension stats would
      // not change what it says, and pre-ascension stats are what earn now.
      if (!forecast || Date.now() - Date.parse(forecast.at) >= FORECAST_MS) {
        const sim = simulateGang(gang, members, { softcap, mode: plan.mode, horizonH: HORIZON_H, stepSec: 60 })
        forecast = sim
          ? {
              at: new Date().toISOString(),
              horizonH: sim.horizonH,
              respectPerSec: sim.respectPerSec,
              samples: sim.samples.filter((x, i) => i % 5 === 0 || i === sim.samples.length - 1).map((x) => ({ h: +x.h.toFixed(4), gross: x.gross, respect: x.respect, members: x.members })),
            }
          : { at: new Date().toISOString(), why: 'simulateGang could not read the gang' }
      }

      // Ascend.
      for (const m of members) {
        const r = ns.gang.getAscensionResult(m.name)
        const v = shouldAscend(m, r, gang, { members: members.length })
        if (v.ascend && ns.gang.ascendMember(m.name)) ascended.push({ at: new Date().toISOString(), name: m.name, why: v.why })
      }
      ascended = ascended.slice(-12)

      // Equipment, inside the budget every higher claim leaves.
      const claims = {
        join: joinClaim(ns.read(GATE_FILE), info.lastAugReset),
        augmentations: augClaim(ns.read(GATE_FILE), info.lastAugReset),
        home: (() => {
          const up = nextHomeUpgrade(ns.getServerMaxRam('home'), ns.getServer('home').cpuCores)
          if (!up) return 0
          const ram = ns.getServerMaxRam('home')
          return { amount: up.cost, deltaGB: up.kind === 'RAM' ? ram : ram / 16 }
        })(),
      }
      let budget = spendable('gang', ns.getServerMoneyAvailable('home'), claims)
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

      // Territory warfare only from strength.
      let warfare = false
      try {
        const others = ns.gang.getAllGangInformation()
        const rivals = Object.entries(others).filter(([n]) => n !== g.faction).map(([n, o]) => ({ name: n, power: o.power }))
        warfare = rivals.length > 0 && rivals.every((r) => g.power > 1.2 * r.power)
        if (g.territoryWarfareEngaged !== warfare) ns.gang.setTerritoryWarfare(warfare)
      } catch {
        /* unreadable rivals: leave warfare as it is */
      }

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
