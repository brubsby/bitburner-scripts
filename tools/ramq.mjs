// Print the static RAM of root scripts under a save regime.
//   node tools/ramq.mjs [--bn 4 --sf4 2] file.js ...
const m = await import('./test/ram.mjs')
await m.load()
const a = process.argv.slice(2)
const opt = (k, d) => {
  const i = a.indexOf(k)
  return i > -1 ? Number(a.splice(i, 2)[1]) : d
}
const bn = opt('--bn', 4)
const sf4 = opt('--sf4', 2)
m.asSave({ bitNode: bn, sf: { 4: sf4 } })
for (const f of a) {
  const r = m.ramOf(f)
  console.log(f.padEnd(24), r.error ? `ERR ${r.error.slice(0, 160)}` : r.cost)
}
