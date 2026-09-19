// Offline RAM pricer for STAGED Netscript files.
//
// calculateRam over the RFA only works on files the game already has, and the
// staged scripts deliberately are not in the game. So price them the way the
// game does: parse with the same parser (acorn), collect every Identifier and
// every MemberExpression property name exactly as Script/RamCalculations.ts
// does, and look each one up in a cost table extracted from
// Netscript/RamCostGenerator.ts.
//
// Costs are read out of the game source at run time, not transcribed.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire('/home/tbusby/Repos/bitburner/package.json')
const acorn = require('acorn')

const SRC = '/home/tbusby/Repos/bitburner/src'
const gen = readFileSync(`${SRC}/Netscript/RamCostGenerator.ts`, 'utf8')

// --- RamCostConstants -------------------------------------------------------
const constants = {}
{
  const block = gen.slice(gen.indexOf('export const RamCostConstants'), gen.indexOf('} as const;'))
  for (const m of block.matchAll(/^\s*(\w+):\s*([\d.]+),/gm)) constants[m[1]] = parseFloat(m[2])
}

// --- every `name: <cost>` pair in the file ---------------------------------
// Costs appear as: a bare number, RamCostConstants.X, RamCostConstants.X / n,
// or SF4Cost(<one of those>). In BitNode 4 SF4Cost returns the base cost
// (RamCostGenerator.ts:82-96), which is the case being priced here.
const costs = {}
const resolve = (expr) => {
  expr = expr.trim()
  const sf4 = expr.match(/^SF4Cost\((.*)\)$/)
  if (sf4) return resolve(sf4[1])
  const div = expr.match(/^(.*?)\s*\/\s*([\d.]+)$/)
  if (div) {
    const base = resolve(div[1])
    return base === null ? null : base / parseFloat(div[2])
  }
  const c = expr.match(/^RamCostConstants\.(\w+)$/)
  if (c) return constants[c[1]] ?? null
  if (/^[\d.]+$/.test(expr)) return parseFloat(expr)
  return null
}
for (const m of gen.matchAll(/^\s*(\w+):\s*([^,\n]+),\s*$/gm)) {
  const v = resolve(m[2])
  if (v === null) continue
  // Later definitions do not override earlier ones with a *higher* cost; the
  // game flattens namespaces, and a name appearing twice (ns.getServer and
  // formulas-side getServer) is charged once. Keep the max, which is what a
  // conservative pricing wants.
  costs[m[1]] = Math.max(costs[m[1]] ?? 0, v)
}
// These are RamCostConstants members, not ns functions.
for (const k of Object.keys(constants)) delete costs[k]
// Structural entries in the generator that are not callable ns names.
for (const k of ['Base', 'Dom', 'Max']) delete costs[k]

// Object.prototype members are skipped by the real walker
// (RamCalculations.ts:408).
const proto = new Set(Object.getOwnPropertyNames(Object.prototype))

export function priceFile(path, { verbose = false } = {}) {
  const text = readFileSync(path, 'utf8')
  const ast = acorn.parse(text, { ecmaVersion: 'latest', sourceType: 'module' })
  const names = new Set()
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return
    if (node.type === 'Identifier' && !proto.has(node.name)) names.add(node.name)
    if (node.type === 'PrivateIdentifier') return
    for (const key of Object.keys(node)) {
      const child = node[key]
      if (Array.isArray(child)) child.forEach((n) => n && typeof n.type === 'string' && walk(n))
      else if (child && typeof child.type === 'string') walk(child)
    }
  }
  walk(ast)

  const hits = []
  let total = constants.Base
  for (const n of [...names].sort()) {
    if (costs[n] !== undefined && costs[n] > 0) {
      hits.push([n, costs[n]])
      total += costs[n]
    }
  }
  if (verbose) {
    console.log(`\n${path}`)
    for (const [n, c] of hits.sort((a, b) => b[1] - a[1])) console.log(`  ${String(c).padStart(6)}  ${n}`)
    console.log(`  ${String(constants.Base).padStart(6)}  (script base)`)
    console.log(`  ------  TOTAL ${total.toFixed(2)} GB`)
  }
  return { total, hits }
}

if (process.argv[2]) {
  let sum = 0
  for (const f of process.argv.slice(2)) sum += priceFile(f, { verbose: true }).total
  console.log(`\nsum of all listed files: ${sum.toFixed(2)} GB`)
}
