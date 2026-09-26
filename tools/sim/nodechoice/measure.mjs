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
    if (!cur || cur.bitNode !== bn) {
      cur = { bitNode: bn, t0: tp, at0: r.at, sfOnEntry: r.sourceFiles?.data ?? [], rows: [], installs: [] }
      segs.push(cur)
      prevP = null
    }
    const h = (tp - cur.t0) / 3.6e6
    const p = r.playtimeSinceLastAug
    if (prevP !== null && typeof p === 'number' && p < prevP - 60e3) cur.installs.push(h)
    prevP = p
    const exp = r.exp?.hacking
    cur.intelligence = r.skills?.intelligence ?? cur.intelligence ?? null
    cur.rows.push({ h, level: r.skills?.hacking ?? null, exp: typeof exp === 'number' ? exp : null, mult: multOf(r.skills?.hacking, exp), augs: (r.augmentations ?? []).length })
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
    }
  })
}
