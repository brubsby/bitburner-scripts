// What the playthrough actually measured, per BitNode, out of
// .telemetry/history.jsonl (the save digest, appended every ~30s on the game's
// own totalPlaytime clock). Read-only.
//
// For each contiguous run of one bitNode: its duration, the Source-Files held
// on entry, the installs (playtimeSinceLastAug falling back), the mean life,
// and — where the digest carries hacking exp (from BitNode 10 on) — the
// effective hacking multiplier recovered from skill.ts:13
//     level = mult * (32 ln(exp + 534.6) - 200)
// and the exp rate over the final hours.

import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const TELEMETRY = process.env.TELEMETRY ?? path.resolve(HERE, '../../../.telemetry')

/** The level of Source-File n in a digest's sourceFiles.data ([[n, lvl]]), 0 when absent. */
export const sfLevelIn = (data, n) => (Array.isArray(data) ? data.find((x) => x[0] === n)?.[1] ?? 0 : 0)
/**
 * A NEW CLEAR of the same BitNode starts a new segment: the node's own Source-File
 * level rises (destroying w0r1d_d43m0n grants it, and the next node can be the same
 * one — BN14.1 -> BN14.2, 2026-10-05). Without this the two clears read as one
 * node with an extra "install" at the boundary.
 */
export const isNewClear = (seg, bn, data) => !seg || seg.bitNode !== bn || sfLevelIn(data, bn) > sfLevelIn(seg.sfOnEntry, bn)

const multOf = (level, exp) => {
  if (!(level > 1) || !(exp >= 0)) return null
  const d = 32 * Math.log(exp + 534.6) - 200
  return d > 0 ? level / d : null
}

export async function nodeSegments(file = path.join(TELEMETRY, 'history.jsonl')) {
  if (!fs.existsSync(file)) throw new Error(`no history at ${file} — set TELEMETRY to the live .telemetry directory`)
  const segs = []
  let cur = null
  let prevP = null
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
  for await (const line of rl) {
    let r
    try {
      r = JSON.parse(line)
    } catch {
      continue
    }
    const bn = r.bitNode
    const tp = r.totalPlaytime
    if (typeof bn !== 'number' || typeof tp !== 'number') continue
    if (isNewClear(cur, bn, r.sourceFiles?.data)) {
      cur = { bitNode: bn, t0: tp, at0: r.at, sfOnEntry: r.sourceFiles?.data ?? [], rows: [], installs: [], retrain: [] }
      segs.push(cur)
      prevP = null
    }
    const h = (tp - cur.t0) / 3.6e6
    const p = r.playtimeSinceLastAug
    const sk = r.skills ?? {}
    const combatMin = Math.min(sk.strength ?? 0, sk.defense ?? 0, sk.dexterity ?? 0, sk.agility ?? 0)
    if (prevP !== null && typeof p === 'number' && p < prevP - 60e3) {
      cur.installs.push(h)
      cur.pendingMult = true
      // the retrain after it: hours until every combat stat is back at 100 (null while not; gameplan/observe.mjs voids a bad install by it)
      cur.retrain.push({ at: h, h: null })
    }
    const rt = cur.retrain[cur.retrain.length - 1]
    if (rt && rt.h === null && combatMin >= 100 && h > rt.at) rt.h = h - rt.at
    prevP = p
    const exp = r.exp?.hacking
    cur.intelligence = r.skills?.intelligence ?? cur.intelligence ?? null
    // the Bladeburner opening (entry -> every combat stat 100, first life) and the Bladeburner faction join (gameplan/observe.mjs)
    if (cur.combat100H === undefined && combatMin >= 100) cur.combat100H = h
    if (cur.bbJoinH === undefined && (r.factions ?? []).includes('Bladeburners')) cur.bbJoinH = h
    cur.rows.push({ h, level: r.skills?.hacking ?? null, exp: typeof exp === 'number' ? exp : null, mult: multOf(r.skills?.hacking, exp), augs: (r.augmentations ?? []).length })
    // the multiplier each life after an install runs at (the first row of the life that reads one): gameplan/observe.mjs inProgressG
    const mNow = cur.rows[cur.rows.length - 1].mult
    // (level >= 100: the level is an integer, so a fresh life's first rows read the multiplier to 1/level)
    if (cur.pendingMult && mNow && (r.skills?.hacking ?? 0) >= 100) {
      ;(cur.multAtInstalls ??= []).push({ h, mult: mNow })
      cur.pendingMult = false
    }
    cur.atEnd = r.at
  }
  return segs.map((s) => {
    const T = s.rows.length ? s.rows[s.rows.length - 1].h : 0
    const lives = s.installs.length + 1
    const withMult = s.rows.filter((x) => x.mult)
    const last = s.rows[s.rows.length - 1]
    // exp rate over the last 4h of rows that carry exp (the final climb, when the node finished)
    let expRate = null
    const tail = s.rows.filter((x) => x.exp !== null && x.h >= T - 4)
    if (tail.length > 2) {
      // median of the positive per-sample rates (an install resets exp, so negative steps are skipped)
      const rates = []
      for (let i = 1; i < tail.length; i++) {
        const dt = (tail[i].h - tail[i - 1].h) * 3600
        const de = tail[i].exp - tail[i - 1].exp
        if (dt > 0 && de > 0) rates.push(de / dt)
      }
      rates.sort((a, b) => a - b)
      expRate = rates.length ? rates[Math.floor(rates.length / 2)] : null
    }
    return {
      bitNode: s.bitNode,
      startedAt: s.at0,
      endedAt: s.atEnd,
      hours: T,
      sfOnEntry: s.sfOnEntry,
      installs: s.installs.length,
      meanLifeH: T / lives,
      maxLevel: Math.max(...s.rows.map((x) => x.level ?? 0)),
      lastLevel: last?.level ?? null,
      multFirst: withMult[0]?.mult ?? null,
      multLast: withMult.length ? withMult[withMult.length - 1].mult : null,
      multMax: withMult.length ? Math.max(...withMult.map((x) => x.mult)) : null,
      expRateEnd: expRate,
      intelligence: s.intelligence ?? null,
      combat100H: s.combat100H ?? null,
      bbJoinH: s.bbJoinH ?? null,
      installsH: s.installs,
      // per install: { at, h } — h the hours back to combat 100 (null: never reached again)
      retrainH: s.retrain,
      multAtInstalls: s.multAtInstalls ?? [],
    }
  })
}
