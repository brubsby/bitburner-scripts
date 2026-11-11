#!/usr/bin/env node
// THE BN12 LEADERBOARD — every BN12 clear's wall hours by level, the route it played, where its time went
// (join, first black op, the 21st), and what the live plan predicted at entry and 1h in against what it
// took (tools/sim/gameplan/bn12.mjs: the board's logic, pure and tested — BN1-BN6 in bn12.test.mjs).
//
//   node tools/bn12board.mjs            rebuild .telemetry/bn12-board.json from the run record and print it
//   node tools/bn12board.mjs --json     print the board as JSON
//   node tools/bn12board.mjs --no-write print only (do not touch the board file)
//   TELEMETRY=<dir> ...                 another telemetry directory
//
// tools/plan-on-node.sh runs it every pass (15 min): the board carries the Go farm each clear ran
// (go-dash-history.json keeps only the node in progress), and observe.mjs reads the finished clears'
// farms from it (autoClearLegsOf) so each clear's k enters the posterior without a hand CLEAR_LEGS entry.
// CALIBRATION: a reader of records — no model. The "predicted" columns are the LIVE plan's own exit at
// entry; the calibration line is that model's error on BN12 (ln measured / predicted).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { boardFromTelemetry } from './sim/gameplan/bn12.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TEL = process.env.TELEMETRY ?? path.resolve(HERE, '../.telemetry')
const argv = process.argv.slice(2)
const has = (k) => argv.includes(k)

const board = await boardFromTelemetry(TEL)
if (!has('--no-write')) {
  const f = path.join(TEL, 'bn12-board.json')
  fs.writeFileSync(f + '.tmp', JSON.stringify(board, null, 1) + '\n')
  fs.renameSync(f + '.tmp', f)
}
if (has('--json')) {
  console.log(JSON.stringify(board, null, 1))
  process.exit(0)
}
const f1 = (x) => (Number.isFinite(x) ? x.toFixed(2).padStart(6) : '     -')
console.log(`BN12 CLEARS — ${board.clears.length} (${board.clears.filter((c) => c.done).length} finished), ${board.at}`)
console.log('  clear     route  active   wall    gap | join  BO1   BO10  BO21 | inst | predicted at entry (+h in)    1h in            resid ln')
for (const c of board.clears) {
  const m = c.milestones
  const p = c.predicted.entry
  const q = c.predicted.late
  console.log(`  ${c.label.padEnd(8)}  ${String(c.route ?? '?').padEnd(5)} ${f1(c.activeH)} ${f1(c.wallH)} ${f1(c.gapH)} |${f1(m.joinH)}${f1(m.bo1H)}${f1(m.bo10H)}${f1(m.bo21H)} | ${String(c.installs).padStart(4)} | ${p ? `${f1(p.totalH)}h (+${p.afterH.toFixed(2)})`.padEnd(28) : 'none (no plan of this clear)'.padEnd(28)} ${q ? `${f1(q.totalH)}h`.padEnd(16) : '-'.padEnd(16)} ${c.resid ? `${c.resid.entry}${c.resid.late !== null ? ` / ${c.resid.late}` : ''}` : c.done ? '-' : '(in progress)'}`)
}
console.log('BEST BY LEVEL')
for (const [L, b] of Object.entries(board.best)) console.log(`  BN12.${L}: ${b.activeH.toFixed(2)}h (${b.route})`)
if (!Object.keys(board.best).length) console.log('  none finished yet')
console.log(`CALIBRATION (the live exit at entry on BN12): ${board.calibration.why}`)
if (board.inProgress?.go) console.log(`GO FARM (in progress, captured ${board.inProgress.go.at}, ${board.inProgress.go.hoursIn}h in): ${JSON.stringify(board.inProgress.go.np)}`)
