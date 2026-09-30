import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectScenario, verifyManifest } from './verify-demo.mjs';
const scenario = readFileSync(new URL('./SCENARIO.md', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('./DEMO-MANIFEST.json', import.meta.url), 'utf8'));

test('single authoritative document has all fields, eight openings, six cards', () => {
  assert.deepEqual(inspectScenario(scenario), {copyableFields:9, xmlFields:5, openingInteractions:8, optionalDeckCards:6});
});
test('LF and CRLF document representations both validate', () => {
  assert.deepEqual(inspectScenario(scenario.replaceAll('\r\n','\n').replaceAll('\n','\r\n')), inspectScenario(scenario));
});
test('reject duplicate field section', () => assert.throws(() => inspectScenario(scenario+'\n## Title\n\n```text\nx\n```\n')));
test('reject missing human-form boundary', () => assert.throws(() => inspectScenario(scenario.replace('no tail, fur or animal ears','a fluffy tail'))));
test('reject opening reality cutaway', () => assert.throws(() => inspectScenario(scenario.replace('At last, a task worthy of Bob:', 'Meanwhile, at NeoKing:'))));
test('reject opening misnumbering', () => assert.throws(() => inspectScenario(scenario.replace('### 8. Character', '### 9. Character'))));
test('reject omitted world initiative', () => assert.throws(() => inspectScenario(scenario.replace('<npc_initiative>', '<obsolete>'))));
test('reject removed private-knowledge boundary', () => assert.throws(() => inspectScenario(scenario.replace('Transcript presence is not transmission', 'Everyone knows everything'))));
test('manifest rejects altered content hash', () => {
  const entries = structuredClone(manifest.files); entries[0].sha256 = '0'.repeat(64);
  assert.throws(() => verifyManifest(manifest, entries));
});
test('manifest rejects missing member', () => assert.throws(() => verifyManifest(manifest, manifest.files.slice(1))));
test('manifest rejects extra member', () => assert.throws(() => verifyManifest(manifest, [...manifest.files, {path:'fields/stale.txt', bytes:0, sha256:'0'.repeat(64)}])));
test('manifest rejects unearned end-to-end or stable-release claims', () => {
  assert.throws(() => verifyManifest({...manifest,livePlaytestScope:'end-to-end'},manifest.files));
  assert.throws(() => verifyManifest({...manifest,stableReleaseApproved:true},manifest.files));
});
