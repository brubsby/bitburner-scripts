// Kill a script by name across every rooted server.
//
//   run killall.js early.js
//   run killall.js early.js auto.js
//
// The terminal's own `killall` only touches the server you are connected to,
// and workers are spread over every rooted host, so switching controllers by
// hand means connecting to thirty machines in turn. This does it in one call.
//
// Never kills itself.

export async function main(ns) {
  const names = ns.args.map(String)
  if (!names.length) {
    ns.tprint('usage: run killall.js <script.js> [script2.js ...]')
    return
  }

  const seen = new Set(['home'])
  const queue = ['home']
  while (queue.length) {
    for (const host of ns.scan(queue.shift())) {
      if (!seen.has(host)) {
        seen.add(host)
        queue.push(host)
      }
    }
  }

  const self = ns.getScriptName()
  let killed = 0
  const byHost = {}

  for (const host of seen) {
    if (!ns.hasRootAccess(host)) continue
    for (const p of ns.ps(host)) {
      if (p.filename === self) continue
      if (!names.includes(p.filename)) continue
      if (ns.kill(p.pid)) {
        killed++
        byHost[host] = (byHost[host] ?? 0) + 1
      }
    }
  }

  ns.tprint(`killall: killed ${killed} process(es) across ${Object.keys(byHost).length} host(s): ${names.join(', ')}`)
}
