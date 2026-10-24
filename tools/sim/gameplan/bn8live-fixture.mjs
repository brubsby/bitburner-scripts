// Freeze a BN8.2 entry dry-run's live-shaped inputs for the tests (tools/test/lifedonate.test.mjs LD2).
//
//   node tools/sim/gameplan/bn8live-fixture.mjs --tel <keep-tel>/BN8.2/entry
//
// Writes tools/test/fixture-bn8-entry.json: the entry pass's exit inputs, the snapshots restricted to the
// factions bn8live prices (catalogue, prices, requirements, hacking/exp/rep multipliers, prerequisites), the
// owned set, the cadence ledger and the earnings ledger's BN8 lives (none at an entry).
// NOT CALIBRATED: a fixture writer — it prices nothing; bn8live.mjs states its check against the gameplan.
import '../../test/gameresolve.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ENTRY_FIXTURE = path.join(HERE, '../../test/fixture-bn8-entry.json')

const argv = process.argv.slice(2)
const dir = argv[argv.indexOf('--tel') + 1]
if (!argv.includes('--tel') || !dir) {
  console.error('usage: node tools/sim/gameplan/bn8live-fixture.mjs --tel <keep-tel>/BN8.2/entry')
  process.exit(2)
}
const L = await import('./bn8live.mjs')
const bn8 = await import('./bn8.mjs')
const e = L.loadEntry(dir)
const joined = L.bn8Joined(e, bn8.FACTION_BARS, bn8.CITY_GROUPS)
const names = new Set(['NeuroFlux Governor', ...joined.flatMap((f) => e.catalog[f] ?? [])])
for (const n of [...names]) for (const p of e.prereq[n] ?? []) names.add(p)
const pick = (o, keys) => Object.fromEntries([...keys].filter((k) => k in (o ?? {})).map((k) => [k, o[k]]))
const statKeys = ['hacking', 'hacking_exp', 'faction_rep', 'hacking_money', 'hacking_speed']
const out = {
  from: dir,
  at: new Date().toISOString(),
  joined,
  base: e.base,
  catalog: pick(e.catalog, joined),
  price: pick(e.price, names),
  repReq: pick(e.repReq, names),
  stats: Object.fromEntries([...names].filter((n) => e.stats[n]).map((n) => [n, pick(e.stats[n], statKeys)])),
  prereq: pick(e.prereq, names),
  owned: e.owned,
  lifetimes: e.lifetimes,
  earnings: { lives: Object.fromEntries(Object.entries(e.earnings?.lives ?? {}).filter(([, v]) => v?.node === 8)) },
}
fs.writeFileSync(ENTRY_FIXTURE, JSON.stringify(out))
console.log(`wrote ${ENTRY_FIXTURE}: ${fs.statSync(ENTRY_FIXTURE).size} bytes, ${joined.length} factions, ${names.size} augmentations`)
process.exit(0)
