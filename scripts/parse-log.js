// Print parseLog output for a real .log file (for manual verification).
const { parseLog } = require('../electron/compiler');
const fs = require('fs');
const [logPath, mainPath] = process.argv.slice(2);
const log = fs.readFileSync(logPath, 'utf8');
console.log(JSON.stringify(parseLog(log, mainPath), null, 1));
