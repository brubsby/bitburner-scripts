// Snapshot actor: ONE Singularity call family, written to a file for the planner
// (snapshot.js explains why). Runs anywhere; the result lands on home.
import { ALL_FACTIONS } from 'factions.js'
import { MEGACORPS } from 'companyplan.js'
/** @param {NS} ns */
export async function main(ns) {
  const info = ns.getResetInfo()
  const rep = {}
  const favor = {}
  for (const f of ALL_FACTIONS) {
    try { rep[f] = ns.singularity.getFactionRep(f); favor[f] = ns.singularity.getFactionFavor(f) } catch { /* not a faction here */ }
  }
  const companyRep = {}
  const companyFavor = {}
  for (const m of MEGACORPS) {
    try { companyRep[m.company] = ns.singularity.getCompanyRep(m.company); companyFavor[m.company] = ns.singularity.getCompanyFavor(m.company) } catch { /* unknown company */ }
  }
  const data = { rep, favor, companyRep, companyFavor, work: ns.singularity.getCurrentWork(), focused: ns.singularity.isFocused() }
  ns.write('/tel/snap-rep.txt', JSON.stringify({ at: new Date().toISOString(), lastAugReset: info.lastAugReset, lastNodeReset: info.lastNodeReset, data }), 'w')
  if (ns.getHostname() !== 'home') ns.scp('/tel/snap-rep.txt', 'home', ns.getHostname())
}
