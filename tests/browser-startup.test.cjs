const {test} = require('node:test');
const assert = require('node:assert/strict');
const {spawn} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {waitForBrowserPort} = require('../scripts/browser-port.cjs');

test('a browser startup failure exposes its exit code and bounded diagnostic output', async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-startup-test-'));
  const child = spawn(process.execPath, ['-e', "process.stderr.write('x'.repeat(150000)+'Synthetic startup failure',()=>process.exit(17))"], {windowsHide:true});
  try {
    await assert.rejects(waitForBrowserPort(child, profile), error =>
      error.message.includes('Exit=17') && error.message.includes('Synthetic startup failure') && error.message.length<8500);
  } finally {
    child.kill();
    fs.rmdirSync(profile);
  }
});
