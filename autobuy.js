// Buys the TOR router and the port-opening programs as soon as they are
// affordable, with no human and no Source-File 4.
//
//   run autobuy.js
//
// Port openers are the best conversion of money into progress in the game:
// rooting is gated on open ports alone, never on hacking level, so each one
// unlocks a whole tier of servers whose RAM the batcher can use immediately.
// relaySMTP once unlocked 688GB for $5m — about $7.3k/GB against the cloud's
// flat $55k/GB.
//
// Buying them is normally a UI job (`ns.singularity.purchaseProgram` needs
// Source-File 4), which meant a human had to notice and click, and so they sat
// unbought for hours at a time. Two routes out, tried in order:
//
//   1. ns.singularity.purchaseProgram, if the Source-File is present.
//   2. The terminal's own `buy` command, queued through cmd.js — which works
//      at any Source-File level, because the terminal is not gated.
//
// So this file behaves correctly whether or not SF4 is owned, and needs
// nothing rewritten when it is eventually obtained.

const TOR_COST = 200e3
const PROGRAMS = [
  { file: 'BruteSSH.exe', price: 500e3 },
  { file: 'FTPCrack.exe', price: 1.5e6 },
  { file: 'relaySMTP.exe', price: 5e6 },
  { file: 'HTTPWorm.exe', price: 30e6 },
  { file: 'SQLInject.exe', price: 250e6 },
]

const CMD_IN = '/cmd/in.txt'
const STATUS = '/tel/autobuy.txt'
const INTERVAL = 60000

/** Queue terminal commands for cmd.js. Appends if something is already pending. */
function queue(ns, lines) {
  const existing = ns.fileExists(CMD_IN, 'home') ? ns.read(CMD_IN) : ''
  ns.write(CMD_IN, (existing ? existing.trimEnd() + '\n' : '') + lines.join('\n'), 'w')
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('autobuy.js: watching for affordable port programs')

  const bought = []
  let warnedTor = false

  while (true) {
    try {
      const money = ns.getServerMoneyAvailable('home')
      const hasTor = ns.serverExists('darkweb')
      const sing = ns.singularity
      const wanted = []

      // Keep a little headroom so this never spends the last dollar out from
      // under something else mid-purchase.
      if (!hasTor && money > TOR_COST * 1.5) {
        let done = false
        if (sing) {
          try {
            done = sing.purchaseTor()
          } catch {
            /* no Source-File 4 */
          }
        }
        if (done) bought.push('TOR (singularity)')
        // Without Source-File 4 there is no way to buy TOR from a script at
        // all: the terminal's `buy` command requires the darkweb, which
        // requires TOR. Retrying just floods the terminal with the same error
        // every tick — it did exactly that for half an hour. Say it once and
        // leave it to a human.
        else if (!warnedTor) {
          warnedTor = true
          ns.tprint('autobuy: TOR router is needed and cannot be bought by a script without Source-File 4 — buy it at Alpha Enterprises (Sector-12) for $200k. Every port program after that is automatic.')
        }
      }

      if (hasTor) {
        for (const { file, price } of PROGRAMS) {
          if (ns.fileExists(file, 'home')) continue
          if (money < price * 1.5) continue

          let done = false
          if (sing) {
            try {
              done = sing.purchaseProgram(file)
            } catch {
              /* no Source-File 4 */
            }
          }
          if (done) bought.push(`${file} (singularity)`)
          else wanted.push(`buy ${file}`)
          break // one at a time, so the next tick re-reads the balance
        }
      }

      if (wanted.length) {
        // The terminal route. cmd.js opens the Terminal tab itself if needed
        // and restores faction-work focus afterwards, so this costs nothing
        // beyond a moment of screen time.
        queue(ns, hasTor ? wanted : ['connect darkweb', ...wanted, 'home'])
        bought.push(`queued: ${wanted.join(', ')}`)
      }

      const owned = PROGRAMS.filter((p) => ns.fileExists(p.file, 'home')).map((p) => p.file)
      ns.write(
        STATUS,
        JSON.stringify(
          { at: new Date().toISOString(), tor: hasTor, owned, missing: PROGRAMS.length - owned.length, recent: bought.slice(-10) },
          null,
          2,
        ),
        'w',
      )
    } catch (err) {
      ns.print(`autobuy error: ${err}`)
    }

    await ns.sleep(INTERVAL)
  }
}
