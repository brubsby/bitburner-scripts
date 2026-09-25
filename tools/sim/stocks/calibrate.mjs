// Live calibration of the stock harness: /tel/stock.txt's measured return over
// the last hour against stockplan.RATE_TABLE at the same capital and mode.
//
//   node tools/sim/stocks/calibrate.mjs
// CALIBRATION: this IS the calibration line; it prints the error pass or fail.
import { calibrationLine } from "./compare.mjs";
console.log(await calibrationLine());
process.exit(0);
