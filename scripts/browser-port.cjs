const fs = require('node:fs');
const path = require('node:path');

async function waitForBrowserPort(browser, profile) {
  let stderr = '', spawnError;
  // Drain both pipes so browser diagnostics cannot block the child process.
  browser.stdout?.on('data', () => {});
  browser.stderr?.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-8192); });
  browser.on('error', error => { spawnError = error; });
  const file = path.join(profile, 'DevToolsActivePort');
  for (let attempt = 0; attempt < 80; attempt++) {
    if (fs.existsSync(file)) {
      const port = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
      if (!/^\d+$/.test(port)) throw Error('Browser wrote an invalid debugging port.');
      return port;
    }
    if (spawnError || (browser.exitCode !== null && browser.exitCode !== 0) || browser.signalCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw Error('Browser did not start its debugging endpoint within 20 seconds. ' +
    `Exit=${browser.exitCode}, signal=${browser.signalCode}. ` +
    (spawnError?.message || '') + '\n' + stderr);
}

module.exports = {waitForBrowserPort};
