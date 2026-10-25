// THE DARKNET MODEL (BitNode 15, "The Secrets of the Dark Net"; SF15 elsewhere). Pure: no ns, no RAM —
// imported by dnet.js (the crawler) and dnet-seed.js (its launcher on home), and by the tests.
//
// WHAT THE GAME DOES (~/Repos/bitburner/src/DarkNet, v3.0.2):
//   - home -- darkweb (a stationary darknet server, password '', 16GB, NetworkGenerator.ts:52-90) -- the
//     depth-0 row -- ... -- the row netDepth-1 -- the LABYRINTH. netDepth is the CURRENT lab's depth
//     (labyrinth.ts getNetDepth): 7, 12, 19, 23, 29 for the five labs BN15 needs. Rows 8/16/24 are AIR GAPS
//     (Enums.ts AIR_GAP_DEPTH, darknetNetworkUtils.ts isOnAirGap): empty, so a crawl crosses them only on a
//     server that migrates across (NetworkMovement.ts moveDarknetServer: scripts on it survive the move).
//   - a server's password is a puzzle per modelId (ServerGenerator.ts, authentication.ts checkPassword);
//     ns.dnet.authenticate returns only success/failure — the puzzle's feedback is in the server's logs,
//     read by ns.dnet.heartbleed (needs charisma >= the server's requiredCharismaSkill). Each failed
//     log entry is JSON.stringify of {code, message, data, passwordAttempted} (packetSniffing.ts).
//   - THE RED PILL in BN15 is not sold by Daedalus (FactionHelpers.tsx:205): it is the reward of the
//     5th labyrinth (labyrinth.ts:419-427, getCurrentLabName: EternalLab once The Staff is INSTALLED).
//     Each lab's reward is QUEUED by opening the lab's cache (cacheFiles.ts getLabReward), so the next
//     lab exists only after an install.
//
// SOLVED HERE (solverOf): every model whose answer follows from the hint, a dictionary, or a bounded
// feedback search — ZeroLogon, DeskMemo, FreshInstall, CloudBlare, Laika4, TopPass, EuroZone, PrimeTime,
// BellaCuore, AccountsManager, OctantVoxel, MathML, 110100100, OrdoXenos, Pr0verFl0, NIL, RateMyPix,
// DeepGreen (exact counts only), 2G_cellular, PHP 5.4, Factori-Os, BigMo%od, OpenWebAccessPoint.
// NOT SOLVED: KingOfTheHill (a numeric global-maximum search, BN15/SF15 only) — reported by the crawler
// as `unsolved` per model, never skipped silently. Each solver is checked against the game's own
// generator and checkPassword in tools/test/dnet.test.mjs.

export const DNET_PORT = 12615 // the crawler's reports (dnet.js -> dnet-seed.js); lock.js 12525, bb-lite 12611
export const DNET_SCRIPT = 'dnet.js'
export const DNET_FILES = ['dnet.js', 'dnetplan.js']
export const DNET_REG = '/dnet-pw.txt' // the passwords a crawler knows, carried to every child (a text file survives a restart of the host? no: a restart kills scripts only)
export const DNET_TEL = '/tel/dnet.txt'

// ---------------------------------------------------------------- the labyrinth (labyrinth.ts labData)
export const LABS = [
  { name: 'th3_l4byr1nth', depth: 7, cha: 300, w: 20, h: 14 },
  { name: 'cru3l_l4byr1nth', depth: 12, cha: 600, w: 30, h: 20 },
  { name: 'm3rc1l3ss_l4byr1nth', depth: 19, cha: 1500, w: 40, h: 26 },
  { name: 'ub3r_l4byr1nth', depth: 23, cha: 2500, w: 60, h: 40 },
  { name: 'et3rn4l_l4byr1nth', depth: 29, cha: 3000, w: 60, h: 40 },
  { name: 'end13ss_l4byr1nth', depth: 31, cha: 3500, w: 60, h: 40 },
  { name: 'f1n4l_l4byr1nth', depth: 36, cha: 4000, w: 60, h: 40 },
  { name: 'b0nus_l4byr1nth', depth: 36, cha: 4000, w: 60, h: 40 },
]
export const LAB_MODEL = '(The Labyrinth)'
export const LAB_AUGS = ['The W1ngs of Icarus', 'The B00ts of Perseus', 'The H4mmer of Daedalus', 'The St4ff of Asclepius', 'The L4w of Bayes', 'The B1ade of Solomonoff']
export const RED_PILL = 'The Red Pill'

/**
 * The lab this save faces and what it pays, from the INSTALLED augmentations (labyrinth.ts
 * getCurrentLabName / getLabAugReward). `installed` is a Set of names; `trpInLab` is the node's
 * DarknetLabyrinthRewardsTheRedPill (1 by default; 0 in two nodes). Returns {index, lab, reward,
 * labsToRedPill} — labsToRedPill = the lab clears (each followed by an install) still needed for The
 * Red Pill, null when no lab pays it.
 */
export function labOf(installed, node, trpInLab = 1) {
  const has = (a) => installed.has(a)
  const [wings, boots, hammer, staff, law, sword] = LAB_AUGS
  let index
  if (!has(wings)) index = 0
  else if (!has(boots)) index = 1
  else if (!has(hammer)) index = 2
  else if (!has(staff)) index = 3
  else if (node === 15) index = !has(RED_PILL) ? 4 : !has(law) ? 5 : !has(sword) ? 6 : 7
  else index = !has(law) ? 4 : !has(sword) ? 5 : trpInLab && !has(RED_PILL) ? 6 : 7
  // the reward (getLabAugReward): the next of the six in order; BN15's 5th lab pays The Red Pill
  const nextAug = LAB_AUGS.find((a) => !has(a)) ?? null
  let reward
  if (!nextAug && (has(RED_PILL) || !trpInLab)) reward = 'NeuroFlux Governor'
  else if (node === 15 && nextAug === law && !has(RED_PILL)) reward = RED_PILL
  else if (!nextAug && trpInLab) reward = RED_PILL
  else reward = nextAug ?? 'NeuroFlux Governor'
  // labs to The Red Pill: BN15 the 5th (index 4); elsewhere the 7th (index 6) when the node allows it
  const trpIndex = node === 15 ? 4 : trpInLab ? 6 : null
  const labsToRedPill = has(RED_PILL) ? 0 : trpIndex === null ? null : Math.max(0, trpIndex - index) + 1
  return { index, lab: LABS[index], reward, labsToRedPill }
}

// ---------------------------------------------------------------- dictionaries (models/dictionaryData.ts)
export const DIGITS = '0123456789'
export const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
export const DEFAULT_PW = ['admin', 'password', '0000', '12345']
export const DOG_NAMES = ['fido', 'spot', 'rover', 'max']
export const EU_COUNTRIES = ['Austria', 'Belgium', 'Bulgaria', 'Croatia', 'Republic of Cyprus', 'Czech Republic', 'Denmark', 'Estonia', 'Finland', 'France', 'Germany', 'Greece', 'Hungary', 'Ireland', 'Italy', 'Latvia', 'Lithuania', 'Luxembourg', 'Malta', 'Netherlands', 'Poland', 'Portugal', 'Romania', 'Slovakia', 'Slovenia', 'Spain', 'Sweden']
export const COMMON_PW = ['123456', 'password', '12345678', 'qwerty', '123456789', '12345', '1234', '111111', '1234567', 'dragon', '123123', 'baseball', 'abc123', 'football', 'monkey', 'letmein', '696969', 'shadow', 'master', '666666', 'qwertyuiop', '123321', 'mustang', '1234567890', 'michael', '654321', 'superman', '1qaz2wsx', '7777777', '121212', '0', 'qazwsx', '123qwe', 'trustno1', 'jordan', 'jennifer', 'zxcvbnm', 'asdfgh', 'hunter', 'buster', 'soccer', 'harley', 'batman', 'andrew', 'tigger', 'sunshine', 'iloveyou', '2000', 'charlie', 'robert', 'thomas', 'hockey', 'ranger', 'daniel', 'starwars', '112233', 'george', 'computer', 'michelle', 'jessica', 'pepper', '1111', 'zxcvbn', '555555', '11111111', '131313', 'freedom', '777777', 'pass', 'maggie', '159753', 'aaaaaa', 'ginger', 'princess', 'joshua', 'cheese', 'amanda', 'summer', 'love', 'ashley', '6969', 'nicole', 'chelsea', 'biteme', 'matthew', 'access', 'yankees', '987654321', 'dallas', 'austin', 'thunder', 'taylor', 'matrix']
const SMALL_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53, 59, 61, 67, 71, 73, 79, 83, 89, 97]
const LARGE_PRIMES = [1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503, 2539, 2693, 2741, 2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289, 4547, 4729, 4789, 4877, 4943, 4951, 4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881, 6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719, 6841, 7103, 7549, 7559, 7573, 7691, 7753, 7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199, 9343, 9467, 9551, 9601, 9739, 9749, 9859]

/** The model ids (Enums.ts ModelIds): the crawler's report keys. */
export const MODEL = {
  EchoVuln: 'DeskMemo_3.1', SortedEchoVuln: 'PHP 5.4', NoPassword: 'ZeroLogon', Captcha: 'CloudBlare(tm)', DefaultPassword: 'FreshInstall_1.0',
  BufferOverflow: 'Pr0verFl0', Mastermind: 'DeepGreen', TimingAttack: '2G_cellular', LargestPrimeFactor: 'PrimeTime 2', RomanNumeral: 'BellaCuore',
  DogNames: 'Laika4', GuessNumber: 'AccountsManager_4.2', CommonPassword: 'TopPass', EUCountry: 'EuroZone Free', Yesnt: 'NIL',
  BinaryEncoded: '110100100', SpiceLevel: 'RateMyPix.Auth', ConvertToBase10: 'OctantVoxel', ParsedExpression: 'MathML', Divisibility: 'Factori-Os',
  TripleModulo: 'BigMo%od', GlobalMaxima: 'KingOfTheHill', PacketSniffer: 'OpenWebAccessPoint', Encrypted: 'OrdoXenos', Labyrinth: LAB_MODEL,
}

const charsetOf = (format) => (format === 'numeric' ? DIGITS : format === 'alphabetic' ? LETTERS : DIGITS + LETTERS)

// ---------------------------------------------------------------- the game's own decoders (ServerGenerator.ts)
export function romanDecode(s) {
  if (String(s).toLowerCase() === 'nulla') return 0
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }
  let total = 0
  let prev = 0
  for (let i = s.length - 1; i >= 0; i--) {
    const c = v[s[i]]
    if (c < prev) total -= c
    else total += c
    prev = c
  }
  return total
}
export function baseNDecode(str, base) {
  const chars = (DIGITS + 'ABCDEFGHIJKLMNOPQRSTUVWXYZ').split('')
  let r = 0
  let i = 0
  let digit = str.split('.')[0].length - 1
  while (i < str.length) {
    if (str[i] === '.') {
      i++
      continue
    }
    r += chars.indexOf(str[i]) * base ** digit
    i++
    digit--
  }
  return r
}
export function cleanExpr(e) {
  return String(e).replaceAll('ҳ', '*').replaceAll('÷', '/').replaceAll('➕', '+').replaceAll('➖', '-').replaceAll('ns.exit(),', '').split(',')[0]
}
/** parseSimpleArithmeticExpression, ported (no eval: the hint can carry injected code). */
export function evalExpr(expression) {
  const tokens = cleanExpr(expression).split('')
  let depthNow = 0
  const depth = tokens.map((t) => {
    if (t === '(') depthNow += 1
    else if (t === ')') {
      depthNow -= 1
      return depthNow + 1
    }
    return depthNow
  })
  const d1 = depth.indexOf(1)
  const z = depth.indexOf(0, d1)
  const d1End = z === -1 ? depth.length - 1 : z - 1
  if (d1 !== -1) {
    const sub = tokens.slice(d1 + 1, d1End).join('')
    const r = evalExpr(sub)
    tokens.splice(d1, d1End - d1 + 1, r.toString())
    return evalExpr(tokens.join(''))
  }
  let rest = tokens.join('')
  const md = /(-?\d*\.?\d+) *([*/]) *(-?\d*\.?\d+)/
  let m = rest.match(md)
  while (m) {
    const r = m[2] === '*' ? parseFloat(m[1]) * parseFloat(m[3]) : parseFloat(m[1]) / parseFloat(m[3])
    rest = rest.replace(m[0], Math.abs(r) < 0.000001 ? r.toFixed(20) : r.toString())
    m = rest.match(md)
  }
  const as = /(-?\d*\.?\d+) *([+-]) *(-?\d*\.?\d+)/
  m = rest.match(as)
  while (m) {
    const r = m[2] === '+' ? parseFloat(m[1]) + parseFloat(m[3]) : parseFloat(m[1]) - parseFloat(m[3])
    rest = rest.replace(m[0], r.toString())
    m = rest.match(as)
  }
  const left = rest.match(/(-?\d*\.?\d+)/)
  return parseFloat(left ? left[1] : '')
}
function largestPrimeFactor(n) {
  let x = n
  let best = 1
  for (let p = 2; p * p <= x; p++) {
    while (x % p === 0) {
      best = p
      x /= p
    }
  }
  return x > 1 ? Math.max(best, x) : best
}
/** Chinese remainder over pairwise-coprime moduli (BigInt). */
function crt(rems, mods) {
  let r = 0n
  let m = 1n
  for (let i = 0; i < mods.length; i++) {
    const mi = BigInt(mods[i])
    const ai = BigInt(rems[i])
    // find x = r + m*k with x = ai (mod mi)
    let k = 0n
    while ((r + m * k - ai) % mi !== 0n) k++
    r = r + m * k
    m *= mi
  }
  return r
}

// ---------------------------------------------------------------- the feedback channel
/**
 * The feedback for `guess` in heartbleed's logs (strings; a password attempt is JSON of
 * {code, message, data, passwordAttempted}). Newest first, so the first match is the latest.
 * Returns {message, data} or null.
 */
export function feedbackOf(logs, guess) {
  for (const line of logs ?? []) {
    if (typeof line !== 'string' || line[0] !== '{') continue
    let o
    try {
      o = JSON.parse(line)
    } catch {
      continue
    }
    if (o && o.passwordAttempted === guess) return { message: String(o.message ?? ''), data: String(o.data ?? ''), code: o.code ?? null }
  }
  return null
}
/** Passwords the logs leak (packetSniffing.ts getLogNoise / addPacketSnifferNoise): [{host|null, pw}]. */
export function leakedOf(logs) {
  const out = []
  for (const line of logs ?? []) {
    if (typeof line !== 'string') continue
    let m = line.match(/^Connecting to (.+):(\S+) \.\.\.$/)
    if (m) out.push({ host: m[1], pw: m[2] })
    m = line.match(/^Logging in with passcode: (\S+) \.\.\.$/)
    if (m) out.push({ host: null, pw: m[1] })
  }
  return out
}
/** Passwords the server's .data.txt clue files name (effects.ts addClue): [{host, pw}]. */
export function cluesOf(text) {
  const out = []
  const m = String(text ?? '').match(/^Server: (.+) Password: "(.*)"$/)
  if (m) out.push({ host: m[1], pw: m[2] })
  return out
}

// ---------------------------------------------------------------- the solvers
/**
 * A solver for one server, from ns.dnet.getServerDetails' record d ({modelId, passwordHint, data,
 * passwordLength, passwordFormat, difficulty}) and the host name. Returns
 *   { model, solvable, why, feedback, nextGuess(hist) -> string | null }
 * `hist` is [{guess, fb}] (fb = feedbackOf of that guess, or null when the logs did not carry it);
 * nextGuess returns null when the solver has nothing left to try (a give-up, reported, never looped on).
 * `feedback` says whether the solver reads heartbleed (charisma >= the server's requirement).
 */
export function solverOf(d, host = null) {
  const model = d?.modelId ?? ''
  const hint = String(d?.passwordHint ?? '')
  const data = String(d?.data ?? '')
  const n = Number(d?.passwordLength ?? -1)
  const cs = charsetOf(d?.passwordFormat)
  const fixed = (list, why) => ({ model, solvable: true, why, feedback: false, nextGuess: (hist) => list.find((p) => !hist.some((h) => h.guess === p)) ?? null })
  const dict = (list, why) => fixed(list.filter((p) => n < 0 || p.length === n), why)
  switch (model) {
    case MODEL.NoPassword:
      return fixed([''], 'empty password')
    case MODEL.EchoVuln:
      return fixed([hint.trim().split(/\s+/).pop() ?? ''], 'the hint echoes it')
    case MODEL.DefaultPassword:
      return dict(DEFAULT_PW, 'factory default dictionary')
    case MODEL.DogNames:
      return dict(DOG_NAMES, 'dog name dictionary')
    case MODEL.CommonPassword:
      return dict(COMMON_PW, 'common password dictionary')
    case MODEL.EUCountry:
      return dict(EU_COUNTRIES, 'EU country dictionary')
    case MODEL.Captcha:
      return fixed([data.split('').filter((c) => DIGITS.includes(c)).join('')], 'the captcha digits')
    case MODEL.LargestPrimeFactor:
      return fixed([String(largestPrimeFactor(Number(data)))], 'largest prime factor of the hint')
    case MODEL.ConvertToBase10: {
      const [b, enc] = data.split(',')
      return fixed([String(baseNDecode(enc ?? '', Number(b)))], 'base-n decode')
    }
    case MODEL.ParsedExpression:
      return fixed([String(evalExpr(data))], 'the expression evaluated (ported parser, no eval)')
    case MODEL.BinaryEncoded:
      return fixed([data.split(' ').filter(Boolean).map((b) => String.fromCharCode(parseInt(b, 2))).join('')], 'binary decode')
    case MODEL.Encrypted: {
      const [masked, masks] = [data.slice(0, data.lastIndexOf(';')), data.slice(data.lastIndexOf(';') + 1)]
      const ms = masks.split(' ').filter(Boolean).map((b) => parseInt(b, 2))
      return fixed([masked.split('').map((c, i) => String.fromCharCode(c.charCodeAt(0) ^ (ms[i] ?? 0))).join('')], 'XOR unmask')
    }
    case MODEL.BufferOverflow:
      // authentication.ts BufferOverflow: a 2n-long input overwrites the expected half of the buffer with itself
      return n > 0 ? fixed(['A'.repeat(2 * n)], 'buffer overflow (2n identical bytes)') : { model, solvable: false, why: 'password length unknown', feedback: false, nextGuess: () => null }
    case MODEL.RomanNumeral: {
      if (!data.includes(',')) return fixed([String(romanDecode(data))], 'roman numeral decode')
      const [lo, hi] = data.split(',').map(romanDecode)
      return bisect(model, lo, hi, (fb) => (/ALTUS/.test(fb.data) ? 'high' : /PARUM/.test(fb.data) ? 'low' : null))
    }
    case MODEL.GuessNumber: {
      const m = hint.match(/between 0 and (\d+)/)
      const hi = m ? Number(m[1]) : n > 0 ? 10 ** n : 1e6
      return bisect(model, 0, hi, (fb) => (/Lower/.test(fb.data) ? 'high' : /Higher/.test(fb.data) ? 'low' : null))
    }
    case MODEL.Yesnt:
      return yesntSolver(model, n, cs)
    case MODEL.SpiceLevel:
      return exactCountSolver(model, n, cs, (fb) => {
        const [peppers] = String(fb.data).split('/')
        return peppers === '0' ? 0 : peppers.split('🌶️').length - 1
      })
    case MODEL.Mastermind:
      return exactCountSolver(model, n, cs, (fb) => Number(String(fb.data).split(',')[0]))
    case MODEL.TimingAttack:
      return timingSolver(model, n, cs)
    case MODEL.SortedEchoVuln:
      return sortedEchoSolver(model, data || hint.split(' ').pop(), n)
    case MODEL.Divisibility:
      return divisibilitySolver(model, d?.difficulty ?? 50)
    case MODEL.TripleModulo:
      return tripleModuloSolver(model)
    case MODEL.PacketSniffer:
      return snifferSolver(model, host, n)
    case MODEL.GlobalMaxima:
      return { model, solvable: false, why: 'KingOfTheHill (a numeric global-maximum search) is not solved yet', feedback: true, nextGuess: () => null }
    case MODEL.Labyrinth:
      return { model, solvable: false, why: 'the labyrinth is walked by labWalk, not guessed', feedback: false, nextGuess: () => null }
    default:
      return { model, solvable: false, why: `unknown model '${model}'`, feedback: false, nextGuess: () => null }
  }
}

function bisect(model, lo0, hi0, dirOf) {
  return {
    model,
    solvable: true,
    why: 'bisection on the high/low feedback',
    feedback: true,
    nextGuess(hist) {
      let lo = lo0
      let hi = hi0
      for (const h of hist) {
        if (!h.fb) continue
        const v = Number(h.guess)
        const dir = dirOf(h.fb)
        if (dir === 'high') hi = Math.min(hi, v - 1)
        else if (dir === 'low') lo = Math.max(lo, v + 1)
      }
      if (lo > hi) return null
      const g = String(Math.floor((lo + hi) / 2))
      // a guess already answered (feedback lost) is retried at most 3 times, then given up
      return hist.filter((h) => h.guess === g).length >= 3 ? null : g
    },
  }
}

function yesntSolver(model, n, cs) {
  return {
    model,
    solvable: n > 0,
    why: 'per-position yes/no feedback',
    feedback: true,
    nextGuess(hist) {
      if (!(n > 0)) return null
      const known = Array(n).fill(null)
      const tried = Array.from({ length: n }, () => new Set())
      for (const h of hist) {
        if (!h.fb) continue
        const marks = String(h.fb.data).split(',')
        for (let i = 0; i < n; i++) {
          const c = h.guess[i]
          if (marks[i] === 'yes') known[i] = c
          else tried[i].add(c)
        }
      }
      let g = ''
      for (let i = 0; i < n; i++) {
        if (known[i] !== null) {
          g += known[i]
          continue
        }
        const c = cs.split('').find((x) => !tried[i].has(x))
        if (c === undefined) return null
        g += c
      }
      return hist.filter((h) => h.guess === g).length >= 3 ? null : g
    },
  }
}

/** Exact-position COUNT feedback (SpiceLevel, Mastermind's first number): char counts, then positions. */
function exactCountSolver(model, n, cs, countOf) {
  return {
    model,
    solvable: n > 0,
    why: 'exact-position counts: every char repeated, then each position probed against a zero-count filler',
    feedback: true,
    nextGuess(hist) {
      if (!(n > 0)) return null
      const seen = new Map()
      for (const h of hist) if (h.fb) seen.set(h.guess, countOf(h.fb))
      // phase 1: counts per char (c repeated n times scores the positions holding c)
      const count = new Map()
      let total = 0
      for (const c of cs) {
        const g = c.repeat(n)
        if (!seen.has(g)) {
          // every position accounted for: the chars not yet probed hold none (a zero-count filler among them)
          if (total >= n) {
            count.set(c, 0)
            continue
          }
          return hist.filter((h) => h.guess === g).length >= 3 ? null : g
        }
        count.set(c, seen.get(g))
        total += seen.get(g)
      }
      // the filler: a zero-count char if any, else the rarest (every digit used once: a 10-digit password)
      const used = cs.split('').filter((c) => count.has(c))
      const filler = used.find((c) => count.get(c) === 0) ?? used.reduce((a, c) => (count.get(c) < count.get(a) ? c : a), used[0])
      if (filler === undefined) return null
      const kz = count.get(filler)
      // phase 2: z..z c z..z scores kz + 1 when c is at i, kz - 1 when z is, kz otherwise
      const known = Array(n).fill(null)
      const ruled = Array.from({ length: n }, () => new Set())
      for (const [g, k] of seen) {
        if (g.length !== n || g === filler.repeat(n)) continue
        const diff = g.split('').map((c, i) => (c !== filler ? i : -1)).filter((i) => i >= 0)
        if (diff.length !== 1) continue
        const at = diff[0]
        if (k === kz + 1) known[at] = g[at]
        else if (k === kz - 1) known[at] = filler
        else ruled[at].add(g[at])
      }
      const left = new Map(count)
      for (const c of known) if (c !== null) left.set(c, left.get(c) - 1)
      for (let i = 0; i < n; i++) {
        if (known[i] !== null) continue
        const cands = [...left].filter(([c, k]) => k > 0 && !ruled[i].has(c)).map(([c]) => c)
        if (cands.length === 1) {
          known[i] = cands[0]
          left.set(known[i], left.get(known[i]) - 1)
          continue
        }
        const probe = cands.find((c) => c !== filler)
        if (probe === undefined) return null
        return filler.repeat(i) + probe + filler.repeat(n - i - 1)
      }
      return known.join('')
    },
  }
}

/** TimingAttack: the message names the index of the first mismatch. */
function timingSolver(model, n, cs) {
  return {
    model,
    solvable: n > 0,
    why: 'first-mismatch index, one position at a time',
    feedback: true,
    nextGuess(hist) {
      if (!(n > 0)) return null
      let prefix = ''
      const bad = Array.from({ length: n }, () => new Set())
      // the longest confirmed prefix: a guess whose mismatch index is k confirms its first k chars
      for (const h of hist) {
        if (!h.fb) continue
        const m = String(h.fb.message).match(/\((-?\d+)\)/)
        if (!m) continue
        const k = Number(m[1])
        if (k > prefix.length) prefix = h.guess.slice(0, k)
        if (k >= 0 && k < n) bad[k].add(h.guess[k])
      }
      if (prefix.length >= n) return prefix.slice(0, n)
      const i = prefix.length
      const c = cs.split('').find((x) => !bad[i].has(x) && !hist.some((h) => h.guess === prefix + x + cs[0].repeat(n - i - 1)))
      if (c === undefined) return null
      return prefix + c + cs[0].repeat(n - i - 1)
    },
  }
}

/** SortedEchoVuln (PHP 5.4): RMS deviation of digit-wise guesses (length >= 5); permutations below 5. */
function sortedEchoSolver(model, sorted, n) {
  const digits = String(sorted ?? '').split('')
  if (digits.length < 5) {
    const perms = [...new Set(permutations(digits).map((p) => p.join('')))]
    return { model, solvable: perms.length > 0, why: 'the sorted digits, every permutation', feedback: false, nextGuess: (hist) => perms.find((p) => !hist.some((h) => h.guess === p)) ?? null }
  }
  const L = digits.length
  const se = (fb) => {
    const m = String(fb?.data ?? '').match(/RMS Deviation:([\d.]+)/)
    return m ? L * Number(m[1]) ** 2 : null
  }
  return {
    model,
    solvable: true,
    why: 'squared error of zero and unit probes: p_i = (SE0 - SE_i + 1) / 2',
    feedback: true,
    nextGuess(hist) {
      const at = (g) => {
        const h = [...hist].reverse().find((x) => x.guess === g && x.fb)
        return h ? se(h.fb) : null
      }
      const tries = (g) => hist.filter((h) => h.guess === g).length
      const zero = '0'.repeat(L)
      const s0 = at(zero)
      if (s0 === null) return tries(zero) >= 3 ? null : zero
      const p = []
      for (let i = 0; i < L; i++) {
        const g = '0'.repeat(i) + '1' + '0'.repeat(L - i - 1)
        const si = at(g)
        if (si === null) return tries(g) >= 3 ? null : g
        p.push(Math.round((s0 - si + 1) / 2))
      }
      return p.join('')
    },
  }
}
function permutations(a) {
  if (a.length <= 1) return [a]
  const out = []
  a.forEach((x, i) => {
    for (const rest of permutations([...a.slice(0, i), ...a.slice(i + 1)])) out.push([x, ...rest])
  })
  return out
}

/** Factori-Os: the password is a product of small (and, past difficulty 12, large) primes; test p^k. */
function divisibilitySolver(model, difficulty) {
  const primes = [...SMALL_PRIMES, ...(difficulty > 12 ? LARGE_PRIMES : [])]
  return {
    model,
    solvable: true,
    why: 'divisibility by growing prime powers',
    feedback: true,
    nextGuess(hist) {
      const ans = new Map()
      for (const h of hist) if (h.fb) ans.set(h.guess, h.fb.data === 'true')
      let N = 1n
      for (const p of primes) {
        for (;;) {
          const g = String(N * BigInt(p))
          if (!ans.has(g)) return hist.filter((h) => h.guess === g).length >= 3 ? null : g
          if (!ans.get(g)) break
          N *= BigInt(p)
        }
      }
      return String(N)
    },
  }
}

/** BigMo%od: for n <= 32, (P % n) % (((n - 1) % 32) + 1) = P % n — eleven coprime moduli, then CRT. */
const TM_MODS = [32, 27, 25, 7, 11, 13, 17, 19, 23, 29, 31]
function tripleModuloSolver(model) {
  return {
    model,
    solvable: true,
    why: 'residues mod 32,27,25,7..31 (lcm 1.4e14), Chinese remainder',
    feedback: true,
    nextGuess(hist) {
      const rem = []
      for (const m of TM_MODS) {
        const h = [...hist].reverse().find((x) => x.guess === String(m) && x.fb)
        if (!h) return hist.filter((x) => x.guess === String(m)).length >= 3 ? null : String(m)
        rem.push(Number(h.fb.data))
      }
      return String(crt(rem, TM_MODS))
    },
  }
}

/**
 * OpenWebAccessPoint: each failed response's data is a fresh capture with the password inside
 * (packetSniffing.ts capturePackets): ' host:password ' up to difficulty 16; above it, the bare password at
 * a random place in random alphanumerics — the length-n substring every capture shares.
 */
function snifferSolver(model, host, n) {
  return {
    model,
    solvable: true,
    why: "the captured packets: ' host:password ' (difficulty <= 16), else the length-n substring common to every capture",
    feedback: true,
    nextGuess(hist) {
      const caps = hist.map((h) => String(h.fb?.data ?? '')).filter(Boolean)
      const tried = (pw) => hist.some((x) => x.guess === pw)
      for (const data of [...caps].reverse()) {
        if (!host) break
        const i = data.indexOf(` ${host}:`)
        if (i >= 0) {
          const pw = data.slice(i + host.length + 2).split(' ')[0]
          if (!tried(pw)) return pw
        }
      }
      if (n > 0 && caps.length >= 2) {
        let common = null
        for (const data of caps) {
          const subs = new Set()
          for (let i = 0; i + n <= data.length; i++) subs.add(data.slice(i, i + n))
          common = common === null ? subs : new Set([...common].filter((x) => subs.has(x)))
        }
        const cand = [...(common ?? [])].filter((x) => !tried(x))
        if (cand.length === 1 || (cand.length > 0 && caps.length >= 4)) return cand[0]
      }
      // a probe guess makes the server answer with a fresh capture; a bounded number, then give up
      const probes = hist.filter((h) => h.guess.startsWith('sniff')).length
      return probes >= 8 ? null : `sniff${probes}`
    },
  }
}

// ---------------------------------------------------------------- the labyrinth walk (labyrinth.ts)
/**
 * One step of a depth-first walk of the maze from labreport's {coords:[x,y], north, east, south, west}.
 * `st` = {seen: Set('x,y'), stack: [dir taken], back: bool} (mutated). Returns the direction word to send
 * as the "password" ('north' ...), or null when the maze is exhausted. A move is 2 cells
 * (labyrinth.ts handleLabyrinthPassword: newLocation = initial + d * 2).
 */
const DIRS = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }
const OPP = { north: 'south', south: 'north', east: 'west', west: 'east' }
export function labStep(st, report) {
  const [x, y] = report.coords
  st.seen ??= new Set()
  st.stack ??= []
  st.seen.add(`${x},${y}`)
  for (const dir of ['east', 'south', 'north', 'west']) {
    if (!report[dir]) continue
    const [dx, dy] = DIRS[dir]
    if (st.seen.has(`${x + 2 * dx},${y + 2 * dy}`)) continue
    st.stack.push(dir)
    return dir
  }
  const last = st.stack.pop()
  return last ? OPP[last] : null
}
