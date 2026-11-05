const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const test = require('node:test');

test('every major Settings section has a unique, portable layout identifier',()=>{
  const html=readFileSync('index.html','utf8');
  const inspector=html.slice(html.indexOf('<aside class="inspector"'),html.indexOf('</aside>',html.indexOf('<aside class="inspector"')));
  const sections=[...inspector.matchAll(/<(?:section|div|details) class="(?:inspector-section|settings-card)[^"]*"[^>]*>/g)];
  const keys=sections.map(([section])=>section.match(/data-settings-key="([^"]+)"/)?.[1]);
  assert.ok(sections.length>=19);
  assert.ok(keys.every(Boolean));
  assert.equal(new Set(keys).size,sections.length);
  for(const oldKey of ['project-details','stitch-progress-','project-dashboard','text-to-chart','layerPanel','patternHealth','sizePanel']){
    assert.ok(keys.includes(oldKey),oldKey+' remains compatible with 2.3.0 backups');
  }
});
