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

/**
 * The terminal's rendered lines, as an array.
 *
 * Diffing the container's innerText by string length does not work: the
 * terminal keeps only a bounded number of entries, so once it is full the old
 * lines fall off the front and the text shifts rather than growing. Counting
 * <li> children and taking the ones past the old count is stable under that.
 */
function terminalLines() {
  const el = doc.getElementById('terminal')
  return el ? Array.from(el.children).map((li) => li.innerText) : []
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

/**
 * Commands handled directly through the NS API, with no DOM involved.
 *
 * The terminal path only works while the Terminal tab is actually rendered, so
 * it fails whenever the game is showing the faction-work screen, the City, or
 * Create Program — which is exactly when an agent most wants to run something
 * without disturbing what is on screen. Focused faction work is worth 25% more
 * reputation than unfocused, so "go look at the Terminal first" is not free.
 *
 * Everything here has an NS equivalent and therefore needs no terminal at all.
 * Anything else — connect, backdoor, buy — genuinely has no NS equivalent
 * without Source-File 4 and still goes through the DOM.
 *
 * Returns a string result, or null if this is not a native command.
 */
async function runNative(ns, line) {
  const [verb, ...args] = line.split(/\s+/)

  switch (verb) {
    case 'exec': {
      // exec <script> <host> [threads] [args...]
      const [script, host, threadsRaw, ...rest] = args
      const threads = Number(threadsRaw) || 1
      if (host !== 'home' && !ns.scp(script, host, 'home')) return `exec: could not copy ${script} to ${host}`
      const pid = ns.exec(script, host, threads, ...rest)
      return pid ? `started ${script} on ${host} (pid ${pid}, ${threads} threads)` : `exec failed — not enough RAM on ${host}?`
    }
    case 'scp':
      return ns.scp(args[0], args[1], args[2] ?? 'home') ? `copied ${args[0]} to ${args[1]}` : `scp failed`
    case 'killall':
      // killall <host> — the terminal's version only hits the connected server.
      return `killed ${ns.killall(args[0] ?? ns.getHostname())} process(es) on ${args[0] ?? ns.getHostname()}`
    case 'killscript':
      // killscript <script> <host>
      return ns.scriptKill(args[0], args[1]) ? `killed ${args[0]} on ${args[1]}` : `nothing killed`
    case 'ps':
      return ns
        .ps(args[0] ?? ns.getHostname())
        .map((p) => `${p.pid} ${p.filename} ${p.threads}t ${p.args.join(' ')}`)
        .join('\n')
    case 'free': {
      const host = args[0] ?? ns.getHostname()
      const max = ns.getServerMaxRam(host)
      return `${host}: ${ns.getServerUsedRam(host).toFixed(2)} / ${max} GB used`
    }
    default:
      return null
  }
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

      // Prefer the NS path — it works whatever the game is displaying.
      try {
        const native = await runNative(ns, line)
        if (native !== null) {
          results.push({ command: line, output: native, error: null, via: 'ns' })
          continue
        }
      } catch (err) {
        results.push({ command: line, output: null, error: String(err), via: 'ns' })
        continue
      }

      const before = terminalLines().length
      try {
        submit(line)
      } catch (err) {
        results.push({ command: line, output: null, error: String(err) })
        continue
      }

      // Let the command run. Most are instant, but backdoor and analyze take
      // real time and print only when they finish, so wait until the terminal
      // stops producing lines rather than guessing a fixed delay.
      let lines = []
      let count = before
      let stableFor = 0
      for (let waited = 0; waited < 120000; waited += 200) {
        await ns.sleep(200)
        const now = terminalLines()
        if (now.length !== count) {
          count = now.length
          stableFor = 0
        } else {
          stableFor += 200
          if (stableFor >= 800) {
            // The terminal is bounded, so once it is full the line count stops
            // rising and the new output is simply the tail.
            lines = now.length > before ? now.slice(before) : now.slice(-8)
            break
          }
        }
      }

      // Drop the echoed prompt line the terminal prints for the command itself.
      const output = lines
        .filter((l) => !l.trimEnd().endsWith('> ' + line))
        .join('\n')
        .trim()

      results.push({ command: line, output: output.slice(0, 4000), error: null })
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
