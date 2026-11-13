// THE BN12 CLIMB'S LEVERS (tools/sim/bb12.mjs --levers --set <name>): each arm moves one thing against the
// first (the base clear's measured start state, bbplan.POLICY as played before 2026-11-13).
//   levers   every lever of the search (round 1)
//   raid     the boot's Raid bar and the boot's extent (round 2)
//   confirm  the shipped Raid bar and the fleets beside it, on fresh seeds (round 3)
//   fleet    every fleet the exit model's chooser ranks near the top, against i5 s3 (round 4)
const BOOT_OFF = { bootMinP: null, bootRaidMinP: null, bootSkillEveryS: null }
/** BN12.6 as played fits ~$1e9 at 0.5h + $1.1e10/h (its grafts' money-bound starts: Graphene at 2.32h, SPTN-97 at 3.65h). */
export const BB12_MONEY = { wealth: 1e9, perH: 1.1e10, fromH: 0.5 }
const LEGS = ['Bionic Legs', 'Graphene Bionic Legs Upgrade']
const fleet = (infiltrate, support, fa = 0, gym = 0) => ({ fleet: { infiltrate, support, fa, gym } })
const R = (x, extra = {}) => ({ sharedPolicy: { bootRaidMinP: x, ...extra } })
const F = (infiltrate, support, fa = 0, gym = 0) => ({ ...fleet(infiltrate, support, fa, gym), ...R(0.15) })

export const SETS = {
  levers: (base) => [
    { name: 'incumbent (as played)', arm: {} },
    // the action mix and its bars
    { name: 'boot policy off', arm: { sharedPolicy: BOOT_OFF } },
    { name: 'boot Raid bar 0.15 (= bootMinP)', arm: { sharedPolicy: { bootRaidMinP: null } } },
    { name: 'boot Raid bar 0.4', arm: { sharedPolicy: { bootRaidMinP: 0.4 } } },
    { name: 'bootMinP 0.25', arm: { sharedPolicy: { bootMinP: 0.25 } } },
    { name: 'bootMinP 0.05', arm: { sharedPolicy: { bootMinP: 0.05 } } },
    { name: 'black ops: threshold 0.5', arm: { sharedPolicy: { blackRule: 'threshold', blackThr: 0.5 } } },
    { name: 'black ops: threshold 0.8', arm: { sharedPolicy: { blackRule: 'threshold', blackThr: 0.8 } } },
    { name: 'rest band 0.3-0.8', arm: { sharedPolicy: { restLow: 0.3, restHigh: 0.8 } } },
    // skills
    { name: 'skills every 30s while booting', arm: { sharedPolicy: { bootSkillEveryS: 30 } } },
    { name: 'skills every 600s while booting', arm: { sharedPolicy: { bootSkillEveryS: 600 } } },
    { name: "skill objective 'sum'", arm: { sharedPolicy: { skillObjective: 'sum' } } },
    // city and chaos
    { name: 'Raid chaos guard 40', arm: { sharedPolicy: { raidChaos: 40 } } },
    { name: 'Raid chaos guard 60', arm: { sharedPolicy: { raidChaos: 60 } } },
    // the 8 sleeves
    { name: 'fleet i8', arm: fleet(8, 0) },
    { name: 'fleet i6 s2', arm: fleet(6, 2) },
    { name: 'fleet i5 s3', arm: fleet(5, 3) },
    { name: 'fleet i4 s4', arm: fleet(4, 4) },
    { name: 'fleet i3 s5', arm: fleet(3, 5) },
    { name: 'fleet i2 s6', arm: fleet(2, 6) },
    { name: 'fleet i1 s7', arm: fleet(1, 7) },
    { name: 'fleet i2 fa6', arm: fleet(2, 0, 6) },
    // the gift
    { name: 'gift off', arm: { gift: false } },
    { name: 'gift charger 2048GB', arm: { hostGb: 2048 } },
    { name: 'gift charger 8192GB', arm: { hostGb: 8192 } },
    // grafts (orders on BB12_MONEY: one money model for every order)
    { name: 'grafts: none', arm: { grafts: [] } },
    { name: 'grafts as played, money model', arm: { grafts: base.start.grafts.map((x) => x.name), money: BB12_MONEY } },
    { name: 'grafts legs, SPTN, heart', arm: { grafts: [...LEGS, 'SPTN-97 Gene Modification', 'Synthetic Heart'], money: BB12_MONEY } },
    { name: 'grafts SPTN, legs, heart', arm: { grafts: ['SPTN-97 Gene Modification', ...LEGS, 'Synthetic Heart'], money: BB12_MONEY } },
    { name: 'grafts heart, legs, SPTN', arm: { grafts: ['Synthetic Heart', ...LEGS, 'SPTN-97 Gene Modification'], money: BB12_MONEY } },
    { name: 'grafts legs, nextSENS, heart, SPTN', arm: { grafts: [...LEGS, 'nextSENS Gene Modification', 'Synthetic Heart', 'SPTN-97 Gene Modification'], money: BB12_MONEY } },
    // the Simulacrum's gym beside the actions
    { name: 'gym beside actions: all free slot', arm: { policy: { gymDuty: 1 } } },
    { name: 'gym beside actions: none', arm: { policy: { gymDuty: 0 } } },
    // the hacknet's exchanges
    { name: 'rank exchanges: none', arm: { hashBuys: false } },
    // training before acting
    { name: 'train to 200 before acting', arm: { policy: { train: { start: true, to: 200 } } } },
    { name: 'train agility to 300 before acting', arm: { policy: { train: { start: true, to: 300, stats: ['agility'] } } } },
  ],
  raid: () => [
    { name: 'incumbent (Raid bar 0.25)', arm: {} },
    { name: 'Raid bar 0.20', arm: R(0.2) },
    { name: 'Raid bar 0.15', arm: R(0.15) },
    { name: 'Raid bar 0.10', arm: R(0.1) },
    { name: 'Raid bar 0.15, bootMinP 0.10', arm: R(0.15, { bootMinP: 0.1 }) },
    { name: 'Raid bar 0.15, boot to 2 black ops', arm: R(0.15, { bootBlackOps: 2 }) },
    { name: 'Raid bar 0.15, boot to 4 black ops', arm: R(0.15, { bootBlackOps: 4 }) },
    { name: 'Raid bar 0.15, boot to 8 black ops', arm: R(0.15, { bootBlackOps: 8 }) },
    { name: 'Raid bar 0.15, skills 60s', arm: R(0.15, { bootSkillEveryS: 60 }) },
    { name: 'Raid bar 0.15 + fleet i5 s3', arm: { ...R(0.15), ...fleet(5, 3) } },
    { name: 'Raid bar 0.15 + gym all free slot', arm: { ...R(0.15), policy: { gymDuty: 1 } } },
    { name: 'minP 0.3 after the boot', arm: { sharedPolicy: { minP: 0.3 } } },
  ],
  confirm: () => [
    { name: 'incumbent (Raid bar 0.25)', arm: {} },
    { name: 'Raid bar = bootMinP 0.15 (shipped)', arm: { sharedPolicy: { bootRaidMinP: null } } },
    { name: 'fleet i5 s3', arm: fleet(5, 3) },
    { name: 'fleet i6 s2', arm: fleet(6, 2) },
    { name: 'fleet i3 s5', arm: fleet(3, 5) },
  ],
  fleet: () => [
    { name: 'i5 s3', arm: F(5, 3) },
    { name: 'i6 s2', arm: F(6, 2) },
    { name: 'i7 s1', arm: F(7, 1) },
    { name: 'i8', arm: F(8, 0) },
    { name: 'i6 f2', arm: F(6, 0, 2) },
    { name: 'i7 f1', arm: F(7, 0, 1) },
    { name: 'i5 f3', arm: F(5, 0, 3) },
    { name: 'i5 g3', arm: F(5, 0, 0, 3) },
    { name: 'i4 s4', arm: F(4, 4) },
    { name: 'i4 f4', arm: F(4, 0, 4) },
    { name: 'i3 s5', arm: F(3, 5) },
    { name: 'i2 s6', arm: F(2, 6) },
    { name: 'i3 f5', arm: F(3, 0, 5) },
  ],
}
