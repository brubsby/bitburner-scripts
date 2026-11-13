// Ask the running go.js to exit between games so watchdog.js relaunches it on
// the code now on disk (go.js reads /go/restart.txt at every game boundary).
//
//   node tools/go-restart.mjs [--rpc http://127.0.0.1:12526/rpc]
//
// The solver is restarted separately: systemctl --user restart bitburner-gosolver.
const argv = process.argv.slice(2);
const RPC = argv.includes("--rpc") ? argv[argv.indexOf("--rpc") + 1] : "http://127.0.0.1:12526/rpc";
const at = Date.now();
const res = await fetch(RPC, { method: "POST", body: JSON.stringify({ method: "pushFile", params: { filename: "/go/restart.txt", server: "home", content: String(at) } }) });
const body = await res.json().catch(() => null);
if (!body || body.error) {
  console.error(`go-restart: the bridge refused: ${JSON.stringify(body)}`);
  process.exit(2);
}
console.log(`go-restart: /go/restart.txt = ${at} (${new Date(at).toISOString()}); a go.js started before then exits at its next game boundary`);
