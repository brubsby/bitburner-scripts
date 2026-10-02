// THE BLADEBURNER ROUTE'S HEALTH — outcome checks for tools/healthcheck.mjs.
//
// Pure (no I/O): healthcheck passes in what it read, this returns what is
// wrong. Kept apart so tools/test/bbhealth.test.mjs can put each failure back
// and watch it fire (CLAUDE.md "A check you have not seen fail is not
// evidence").
//
// Every check asks a question about the OUTCOME, not the component:
//   BLADEBURNER SILENT       where the division can exist (BN6/7, SF6/7) and a daemon should be placed (home >= 128GB, or >= 32GB on the
//                            Bladeburner route: bb-lite.js), /tel/bladeburner.txt is missing or stale
//   BB-LITE STARVED          bb-lite.js's one-shot actors failed to place/answer 3+ times in 10 min
//   ORDER NOT HELD           progress.js claims the slot for 'bladeburner' but the game runs other work, or no Bladeburner action
//   NO RANK PROGRESS         the slot was ours at both ends of an interval >= 15 min and rank did not rise
//   STAMINA STUCK            resting for 30+ min of samples and stamina is not rising
//   ACTION FAILING           >= 10 attempts at under half the success rate the policy expected
//   MODEL OFF                the formula's action time disagrees with the game's getActionTime
//   EXIT READY, NOT TAKEN    all 21 black ops done and endgame.js is not leaving (held is a note: a deliberate hold)
//   BLADE FLEET UNPRICED     on the committed route, in the division, sleeve.js priced NO fleet configuration
//                            (every exit null): the model could not price the sleeves, so they keep their
//                            ordinary plan and the route prices them as assigned. Live 2026-10-02 its gym rate
//                            was null (bestGym had no city): no fleet whenever an install was committed —
//                            sleeves at the gym worth ~13h of exit, and the fleet flipped at the install (-15.1h)
//
// sl = /tel/sleeve.txt (its blade record),
// bb = /tel/bladeburner.txt, pr = /tel/progress.txt, eg = /tel/endgame.txt,
// state = the save digest (/state: bitNode, currentWork, home.ram,
// playtimeSinceLastAug), prev = this function's own `snap` from the last run.

const num = (x) => typeof x === 'number' && isFinite(x)
const ageMinOf = (iso, nowMs) => {
  const t = Date.parse(iso ?? '')
  return Number.isFinite(t) ? (nowMs - t) / 60000 : null
}
export const BB_FRESH_MIN = 20
export const MIN_INTERVAL_MIN = 15

/** Source-File levels from the save digest (a JSONMap {ctor, data: [[n, lvl]]} or an array of pairs). */
const sfOf = (state) => {
  const data = Array.isArray(state?.sourceFiles) ? state.sourceFiles : state?.sourceFiles?.data ?? []
  return new Map(data.map(([n, l]) => [Number(n), Number(l)]))
}

export function bladeburnerHealth({ bb = null, lite = null, pl = null, pr = null, eg = null, sl = null, state = {}, prev = null, nowMs = Date.now() } = {}) {
  const fails = []
  const notes = []
  const fail = (what, detail = null) => fails.push({ what, detail })
  const node = state?.bitNode ?? null
  const bbNode = bb?.bitNode ?? null
  // The division exists in BN6/7 and wherever Source-File 6 or 7 is held
  // (sfgate.canUseBladeburner). This read BN6/7 only, so in BN4 with SF6.1
  // (2026-10-02) every check here was silent.
  const sf = sfOf(state)
  const bladeNode = node === 6 || node === 7 || (sf.get(6) ?? 0) > 0 || (sf.get(7) ?? 0) > 0
  const routeBlade = !!pl && pl.node === node && pl?.decisions?.bladeRoute?.key === 'blade'
  const age = ageMinOf(bb?.at, nowMs)
  const lifeStart = num(state?.playtimeSinceLastAug) ? nowMs - state.playtimeSinceLastAug : null
  const ours = !!bb && bbNode === node
  const snap = { at: new Date(nowMs).toISOString(), bitNode: node, rank: ours && num(bb.rank) ? bb.rank : null, owned: false, acting: false }

  // ---- presence --------------------------------------------------------
  if (!ours) {
    // bb-lite.js (tier 32) publishes this file from its first pass, joined or not.
    if (bladeNode && num(state?.home?.ram) && (state.home.ram >= 128 || (routeBlade && state.home.ram >= 32))) fail(`BLADEBURNER SILENT: BitNode ${node} has the division${routeBlade ? ', the route is Bladeburner' : ''} and home is ${state.home.ram}GB (boot.js places bb-lite.js from tier 32, bladeburner.js at 128), but /tel/bladeburner.txt is ${bb ? `from BitNode ${bbNode}` : 'missing'}`, `/tel/boot.txt names why neither was placed; /tel/bb-lite.txt: ${lite ? `${lite.result} — ${String(lite.detail ?? '').slice(0, 120)}` : 'missing'}`)
    else if (bladeNode) notes.push(`bladeburner: no record this node yet (home ${state?.home?.ram ?? '?'}GB)`)
    return { fails, notes, snap }
  }
  // ---- the lean daemon's actors -------------------------------------------
  // bb-lite.js runs its 4GB calls in one-shot actors placed wherever there is
  // room; three failures in ten minutes is a fleet with no room for them.
  if (bb.daemon === 'bb-lite' && lite && lite.bitNode === node) {
    const recent = (lite.actorErrors ?? []).filter((e) => { const a = ageMinOf(e.at, nowMs); return a !== null && a <= 10 })
    if (recent.length >= 3) fail(`BB-LITE STARVED: ${recent.length} actor failures in 10 min — ${String(recent[recent.length - 1].why).slice(0, 160)}`, 'its actors need 9.6-14.6GB free on one rooted host (home\'s action slot is sized for act.js\'s); free RAM or a server is the fix')
    else notes.push(`bladeburner: bb-lite.js is the actor (${bb.result}; ${String(bb.detail ?? '').slice(0, 100)})`)
  }
  if (bb.capability === false || bb.result === 'capability-absent' || bb.result === 'disabled-in-node') {
    notes.push(`bladeburner: ${bb.result} — ${String(bb.detail ?? '').slice(0, 120)}`)
    return { fails, notes, snap }
  }
  const fromLastLife = lifeStart !== null && Number.isFinite(Date.parse(bb.at)) && Date.parse(bb.at) < lifeStart
  if (age === null) fail('BLADEBURNER SILENT: /tel/bladeburner.txt has no readable timestamp')
  else if (age > BB_FRESH_MIN && !fromLastLife) fail(`BLADEBURNER SILENT: /tel/bladeburner.txt is ${age.toFixed(0)} min stale (budget ${BB_FRESH_MIN})`, `last result '${bb.result}', health '${bb.health}' — the daemon died or its host is gone`)
  if (bb.health === 'error') fail(`bladeburner.js reports health 'error' (${bb.result})`, String(bb.detail ?? '').slice(0, 240))
  if (fromLastLife) {
    notes.push('bladeburner: record is from a previous life — not yet republished')
    return { fails, notes, snap }
  }

  // ---- the slot ---------------------------------------------------------
  const prAge = ageMinOf(pr?.at, nowMs)
  const claimed = pr?.slot?.owner === 'bladeburner' && prAge !== null && prAge < 15
  const work = state?.currentWork ?? null
  const workType = work?.type ?? work?.ctor ?? null
  const running = bb.running ?? null
  snap.owned = claimed && bb.slot?.ours === true
  snap.acting = snap.owned && !!running && age !== null && age < 5
  if (claimed) {
    if (workType) fail(`ORDER NOT HELD: progress.js claims the work slot for 'bladeburner', but the game is running ${workType}`, 'faction/crime/class work cancels a Bladeburner action every tick (Bladeburner.ts:1353-1366) — find who started it (act.js decision.why, orders.txt)')
    else if (age !== null && age < 5 && !running && !bb.exitReady) fail("ORDER NOT HELD: progress.js claims the work slot for 'bladeburner' and nothing is running", `bladeburner.js: ${bb.result} — ${String(bb.detail ?? '').slice(0, 160)}`)
  }

  // ---- rank -------------------------------------------------------------
  if (prev && prev.bitNode === node && prev.owned && snap.owned && num(prev.rank) && num(snap.rank) && !bb.exitReady) {
    const dt = ageMinOf(prev.at, nowMs)
    if (dt !== null && dt >= MIN_INTERVAL_MIN) {
      if (!(snap.rank > prev.rank)) fail(`NO RANK PROGRESS: rank ${prev.rank} -> ${snap.rank} over ${dt.toFixed(0)} min with the slot on Bladeburner`, `action ${bb.action?.name ?? '?'} (${bb.action?.why ?? ''}); outcomes observed ${bb.outcomes?.observed ?? '?'} vs expected ${bb.outcomes?.expected ?? '?'}`)
      else notes.push(`bladeburner: rank ${prev.rank} -> ${snap.rank} in ${dt.toFixed(0)} min (${(((snap.rank - prev.rank) / dt) * 60).toFixed(1)}/h)`)
    }
  }

  // ---- stamina ----------------------------------------------------------
  const samples = Array.isArray(bb.samples) ? bb.samples.filter((s) => num(s.stamina) && ageMinOf(s.at, nowMs) !== null) : []
  const last30 = samples.filter((s) => ageMinOf(s.at, nowMs) <= 30)
  if (bb.resting && last30.length >= 20 && num(bb.maxStamina)) {
    const lo = Math.min(...last30.map((s) => s.stamina))
    const hi = Math.max(...last30.map((s) => s.stamina))
    const first = last30[0].stamina
    const lastS = last30[last30.length - 1].stamina
    if (!(lastS > first + 0.01 * bb.maxStamina) && hi - lo < 0.02 * bb.maxStamina) fail(`STAMINA STUCK: resting for ${last30.length} min and stamina ${first.toFixed(1)} -> ${lastS.toFixed(1)} of ${bb.maxStamina.toFixed(1)}`, 'regeneration is passive plus the chamber (Bladeburner.ts:1318-1326, 1201-1205): no rise means the chamber is not running or the slot is not ours')
  }

  // ---- outcomes -----------------------------------------------------------
  const oc = bb.outcomes
  if (oc && num(oc.n) && oc.n >= 10 && num(oc.observed) && num(oc.expected) && oc.observed < 0.5 * oc.expected) fail(`ACTION FAILING: ${(oc.observed * 100).toFixed(0)}% of the last ${oc.n} attempts succeeded, the policy expected ${(oc.expected * 100).toFixed(0)}%`, `the chance is the REAL one (the true population read off the black-op range, bbplan.popRatioFromRange): a rate this far under it means the ENV probe or the population read is wrong — last: ${JSON.stringify(oc.last ?? []).slice(0, 200)}`)

  // ---- the model ----------------------------------------------------------
  const cal = bb.calibration
  if (cal && num(cal.timeFormulaS) && num(cal.timeGameS) && Math.abs(cal.timeFormulaS - cal.timeGameS) > 1) fail(`MODEL OFF: bbplan.actionTime ${cal.timeFormulaS}s vs the game's getActionTime ${cal.timeGameS}s for ${bb.action?.name}`, 'every simulated Bladeburner exit uses this formula ([BB3] checks it against the game source; a live mismatch means the source moved or the inputs are wrong)')
  // The success posterior (bbplan.successPosterior on the daemon's measured attempts): the
  // formula is the game's, so a k away from 1 with the evidence to show it is an INPUT wrong.
  const sc = cal?.success
  if (sc && num(sc.k) && num(sc.sdLn) && num(sc.n)) {
    const off = Math.abs(Math.log(sc.k))
    if (sc.n >= 200 && off > 0.3 && off > 3 * sc.sdLn) fail(`MODEL OFF: success realised ${sc.s}/${sc.n} against ${sc.expected} predicted (k ${sc.k}, x/÷ ${Math.exp(1.2816 * sc.sdLn).toFixed(2)})`, 'the chance formula is the game\'s (bbplan [BB2]): an input is wrong — the true population read (cities[].r), the ENV probe, the stamina — every Bladeburner exit is priced with it (decisions.bladeRoute.calibration)')
    else notes.push(`bladeburner model: ${sc.why}`)
  }
  if (cal && num(cal.maxStaminaFormula) && num(cal.maxStaminaGame) && cal.maxStaminaGame > 0) {
    const e = cal.maxStaminaFormula / cal.maxStaminaGame - 1
    notes.push(`bladeburner model: max stamina formula ${cal.maxStaminaFormula} vs game ${cal.maxStaminaGame} (${(e * 100).toFixed(1)}%; Training's stamina bonus is not read)`)
  }

  // ---- the fleet (sleeve.js's Bladeburner configuration) ---------------------
  const fb = sl && sl.bitNode === node ? sl.blade : null
  if (fb && fb.route === 'blade' && fb.joined === true && !fb.config && Array.isArray(fb.byConfig) && fb.byConfig.length && fb.byConfig.every((c) => !num(c?.hours))) {
    fail(`BLADE FLEET UNPRICED: sleeve.js priced none of ${fb.byConfig.length} Bladeburner fleets on the committed route — the sleeves keep their ordinary plan`, String(fb.why ?? '').slice(0, 240))
  }

  // ---- the exit -------------------------------------------------------------
  if (bb.exitReady) {
    const egAge = ageMinOf(eg?.at, nowMs)
    if (eg?.result === 'held') notes.push(`bladeburner: EXIT READY (21/21 black ops) and held by /endgame-hold.txt — ${String(eg.detail ?? '').slice(0, 120)}`)
    else if (eg?.result === 'destroying') notes.push('bladeburner: EXIT READY — endgame.js is destroying w0r1d_d43m0n')
    else if (eg?.result === 'ready') fail('EXIT READY, NOT TAKEN: all 21 black ops done and endgame.js is waiting for --next', String(eg.detail ?? '').slice(0, 200))
    else if (egAge === null || egAge > 10) fail(`EXIT READY, NOT TAKEN: all 21 black ops done and /tel/endgame.txt is ${egAge === null ? 'missing' : `${egAge.toFixed(0)} min old`} (${eg?.result ?? '?'})`, 'the watchdog runs endgame.js every 2 min once Daedalus is next or done (bladeburner.txt blackOps.done >= 20)')
    else fail(`EXIT READY, NOT TAKEN: all 21 black ops done and endgame.js says '${eg?.result}'`, String(eg?.detail ?? '').slice(0, 200))
  } else if (bb.blackOps) notes.push(`bladeburner: rank ${num(bb.rank) ? bb.rank.toFixed(0) : '?'} (${num(bb.rankPerHour) ? bb.rankPerHour.toFixed(0) : '?'}/h), black ops ${bb.blackOps.done}/21, next ${bb.blackOps.next} at rank ${bb.blackOps.reqdRank} chance ${JSON.stringify(bb.blackOps.chance)}; ${bb.result}: ${String(bb.detail ?? '').slice(0, 100)}`)
  return { fails, notes, snap }
}
