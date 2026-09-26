import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('.', import.meta.url));
const demo = root;
const expectedHeadings = ['Title', 'Brief description', 'Public description', 'Setting', 'Player character: Johnny / Bob', 'Character: Hazelnut', 'Plot', 'Opening description', 'Opening message (narrative)'];
const fieldFiles = ['01-title.txt', '02-brief-description.txt', '03-public-description.txt', '04-setting.txt', '05-player-description.txt', '06-hazelnut.txt', '07-plot.txt', '08-opening-description.txt', '09-opening-narrative.txt'];
const text = readFileSync(join(demo, 'SCENARIO.md'), 'utf8').replaceAll('\r\n', '\n');
const headings = [...text.matchAll(/^# (.+)$/gm)];
assert.deepEqual(headings.map(x => x[1]), expectedHeadings);
for (let i = 0; i < headings.length; i++) {
  const expected = text.slice(headings[i].index + headings[i][0].length, headings[i + 1]?.index ?? text.length).trim() + '\n';
  assert.equal(readFileSync(join(demo, 'fields', fieldFiles[i]), 'utf8'), expected, fieldFiles[i]);
}
assert.ok(!text.includes('#oc2026'));
assert.ok(!text.includes('<ext_ctx'));
assert.ok(readFileSync(join(demo, 'fields/02-brief-description.txt'), 'utf8').trim().length <= 75);
const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  assert.ok(!entry.isSymbolicLink());
  return entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)];
});
const entries = walk(demo).filter(p => relative(demo, p) !== 'DEMO-MANIFEST.json').map(p => {
  const bytes = readFileSync(p);
  return { path: relative(root, p).replaceAll('\\', '/'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
assert.ok(entries.every(e => !e.path.startsWith('extension/') && !e.path.includes('/.git/')));
if (process.argv.includes('--seal')) writeFileSync(join(root, 'DEMO-MANIFEST.json'), JSON.stringify({
  schema_version: 1, package: 'QE-The-Waykey-public-demo-r1', date: '2026-09-26',
  scope: 'Demo only; no extension runtime or replacement repository metadata.',
  source: 'QE_The_Waykey_SCENARIO_v1.md, 2026-09-23',
  new_live_playtest: false, exclusion: 'Manifest excludes itself; ZIP hash binds the full artifact.', files: entries,
}, null, 2) + '\n');
assert.deepEqual(JSON.parse(readFileSync(join(demo, 'DEMO-MANIFEST.json'), 'utf8')).files, entries);
console.log(JSON.stringify({ fileHashesPassed: entries.length, scenarioFieldsMatched: headings.length, noExtensionFiles: true, livePlaytestPerformed: false }, null, 2));
