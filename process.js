const usage = () =>
  ns.tprint();

export async function main(ns) {
  let flag_data = ns.flags([
    ["host", ns.getHostname()],
    ["threads", 1],
    ["kill", false],
    ["restart", false],
    ["run", false],
    ["verbose", false],
    ["debug", false],
  ]);
  if (flag_data.debug) ns.tprint(flag_data);
  let firstArg = flag_data._[0];
  let scriptname = firstArg.includes('.') ? firstArg : `${firstArg}.js`;
  let scriptWithNoExtension = scriptname.substr(0, scriptname.lastIndexOf('.'))
  let host = flag_data.host;
  let threads = flag_data.threads;
  let args = flag_data._.slice(1);
  if (flag_data.kill || flag_data.restart) {
    if(!ns.kill(scriptname, host, ...args)) {
      let matchingProcesses = ns.ps(host).filter(process =>
        process.filename.substr(0, process.filename.lastIndexOf('.')).toLowerCase() ==
          scriptWithNoExtension.toLowerCase());
      if (matchingProcesses.length == 1) {
        if (flag_data.verbose) {
          ns.tprint(`Failed to kill script with supplied arguments: ${
            JSON.stringify(flag_data)}`);
        }
        let matchingProcess = matchingProcesses.shift();
        if (ns.kill(matchingProcess.pid)) {
          if (!(args && args.length)) {
            args = matchingProcess.args;
          }
          ns.tprint(`Killed the only script starting with ${
            scriptWithNoExtension}: ${JSON.stringify(matchingProcess)}`);
        } else {
            ns.tprint(`Failed to kill the only script with name ${
              scriptWithNoExtension}: ${JSON.stringify(matchingProcess)}`);
        }
      } else if (matchingProcesses.length > 1) {
        if (!(args && args.length)) {
          args = matchingProcesses[0].args;
        }
        let numKilled = matchingProcesses.filter(matchingProcess => ns.kill(matchingProcess.pid)).length;
        ns.tprint(`Killed ${numKilled}/${matchingProcesses.length} ${scriptWithNoExtension} processes on ${host}`);
      } else {
        ns.tprint(`No scripts found with the filename of ${
          scriptWithNoExtension}.`);
      }
    } else {
      ns.tprint(`${scriptname} killed`)
    }
  }
  if (flag_data.run || flag_data.restart) {
      if(ns.exec(scriptname, host, threads, ...args)) {
          ns.tprint(`Started ${scriptname} with ${threads} thread(s) on ${host} with args: ${JSON.stringify(args)}`);
      } else {
          ns.tprint(`Failed to start ${scriptname} with ${threads} thread(s) on ${host} with args: ${JSON.stringify(args)}`);
      }
  }
}
