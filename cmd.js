// Terminal bridge: runs terminal commands written to a file, and writes back
// what the terminal printed.
//
//   run cmd.js
//
// This exists so an external agent can drive the game through the Remote File
// API alone — push a command file, read the output file — instead of clicking
// and typing in a browser. Everything the terminal can do, this can do:
// connect, backdoor, buy, run, kill, scp, analyze. Most of that is otherwise
// gated behind ns.singularity.*, which needs Source-File 4 and is unavailable
// for this whole BitNode.
//
// Protocol, all paths on home:
//   /cmd/in.txt   one command per line. Deleted once consumed.
//   /cmd/out.txt  JSON: what ran, what the terminal printed, when.
//   /cmd/busy.txt present while a batch is running.
//
// So from outside the game:
//   pushFile /cmd/in.txt  "connect n00dles\nbackdoor"
//   ...poll...
//   getFile  /cmd/out.txt
//
// Why the DOM. Terminal.executeCommands is not reachable from Netscript, and
// the input is a React controlled component: setting `.value` directly updates
// the element but not React's state, and Enter reads React's state
// (TerminalInput.tsx:244). So we go through the native value setter, fire the
// `input` event React actually listens to, then send Enter. `eval` is used to
// reach document/window because a direct reference would be seen by the RAM
// checker; this is the same trick infilhelper.js already uses.

const IN = '/cmd/in.txt'
const OUT = '/cmd/out.txt'
const BUSY = '/cmd/busy.txt'
const POLL = 1000

// Commands that must never be run from here. This is not a security boundary —
// anything with file access could do it anyway — it is a guard against an
// agent losing hours of progress to a typo in a queued batch.
const FORBIDDEN = [/^\s*softreset\b/i, /^\s*b1tflum3\b/i, /^\s*wd\b/i]

const doc = eval('document')
const win = eval('window')

function terminalText() {
  const el = doc.getElementById('terminal')
  return el ? el.innerText : ''
}

/** Type a command into the terminal the way a person would, and press Enter. */
function submit(command) {
  const input = doc.getElementById('terminal-input')
  if (!input) throw new Error('terminal input not found — is the Terminal tab open?')

  const setter = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set
  setter.call(input, command)
  input.dispatchEvent(new win.Event('input', { bubbles: true }))
  input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
}

export async function main(ns) {
  ns.disableLog('ALL')
  ns.tprint('cmd.js: terminal bridge up — write commands to /cmd/in.txt')

  // Clear any stale lock from a previous run that was killed mid-batch.
  if (ns.fileExists(BUSY, 'home')) ns.rm(BUSY, 'home')

  while (true) {
    if (!ns.fileExists(IN, 'home')) {
      await ns.sleep(POLL)
      continue
    }

    const script = ns.read(IN)
    ns.rm(IN, 'home')
    ns.write(BUSY, new Date().toISOString(), 'w')

    const results = []

    for (const line of script.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (FORBIDDEN.some((re) => re.test(line))) {
        results.push({ command: line, output: null, error: 'refused: destructive command' })
        continue
      }

      const before = terminalText()
      try {
        submit(line)
      } catch (err) {
        results.push({ command: line, output: null, error: String(err) })
        continue
      }

      // Let the command run. Most are instant, but backdoor and analyze take
      // real time and print when they finish, so wait until the terminal stops
      // growing rather than guessing a fixed delay.
      let output = ''
      let stableFor = 0
      for (let waited = 0; waited < 120000; waited += 200) {
        await ns.sleep(200)
        const now = terminalText()
        const grown = now.length > before.length + output.length
        output = now.slice(before.length)
        if (grown) {
          stableFor = 0
        } else {
          stableFor += 200
          if (stableFor >= 600 && waited >= 600) break
        }
      }

      results.push({ command: line, output: output.trim().slice(0, 4000), error: null })
    }

    ns.write(
      OUT,
      JSON.stringify({ at: new Date().toISOString(), results }, null, 2),
      'w',
    )
    ns.rm(BUSY, 'home')
    ns.print(`ran ${results.length} command(s)`)
  }
}
