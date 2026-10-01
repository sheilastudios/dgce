import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { inspectScenario, verifyManifest, inventory, sealManifest, expectedFiles } from './verify-demo.mjs';
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

// Fixtures contain small stand-ins for media, never a copy of a user's package.
function packageFixture(t) {
  const root = fs.mkdtempSync(join(tmpdir(), 'dgce-demo-seal-'));
  t.after(() => {
    // Resolve and check the exact freshly allocated directory before deletion.
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(), 'dgce-demo-seal-')));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of expectedFiles) {
    const destination = join(root, name);
    fs.mkdirSync(dirname(destination), { recursive: true });
    fs.writeFileSync(destination, name === 'SCENARIO.md' ? scenario : `fixture: ${name}\n`);
  }
  sealManifest(root);
  return root;
}
function previousManifest(root) { return readFileSync(join(root, 'DEMO-MANIFEST.json')); }
function assertNoTemporary(root) {
  assert.deepEqual(fs.readdirSync(root).filter(name => name.startsWith('.DEMO-MANIFEST-')), []);
}

test('current repository demo inventory and manifest verify together', () => {
  verifyManifest(manifest, inventory(fileURLToPath(new URL('./', import.meta.url))));
});

test('sealing binds the video and all seven payload files, excluding only the manifest', t => {
  const root = packageFixture(t);
  const result = sealManifest(root);
  assert.equal(expectedFiles.length, 8);
  assert.equal(result.files.length, 7);
  assert.ok(result.files.some(entry => entry.path === 'media/QE_DEMO_DreamGen.mp4'));
  assert.equal(result.files.some(entry => entry.path === 'DEMO-MANIFEST.json'), false);
  verifyManifest(JSON.parse(previousManifest(root)), inventory(root));
  assertNoTemporary(root);
});

test('changed video bytes invalidate verification until intentionally resealed', t => {
  const root = packageFixture(t);
  const old = JSON.parse(previousManifest(root));
  fs.appendFileSync(join(root, 'media/QE_DEMO_DreamGen.mp4'), 'changed');
  assert.throws(() => verifyManifest(old, inventory(root)), /hash\/inventory mismatch/);
  sealManifest(root);
  verifyManifest(JSON.parse(previousManifest(root)), inventory(root));
});

for (const defect of ['extra-media', 'missing-video', 'invalid-scenario', 'orphan-temp']) {
  test(`failed sealing preserves the existing manifest: ${defect}`, t => {
    const root = packageFixture(t), before = previousManifest(root);
    if (defect === 'extra-media') fs.writeFileSync(join(root, 'media/extra.txt'), 'unexpected');
    if (defect === 'missing-video') fs.unlinkSync(join(root, 'media/QE_DEMO_DreamGen.mp4'));
    if (defect === 'invalid-scenario') fs.writeFileSync(join(root, 'SCENARIO.md'), 'invalid');
    if (defect === 'orphan-temp') fs.writeFileSync(join(root, '.DEMO-MANIFEST-orphan.tmp'), 'leftover');
    assert.throws(() => sealManifest(root));
    assert.deepEqual(previousManifest(root), before);
    if (defect !== 'orphan-temp') assertNoTemporary(root);
  });
}

for (const fault of ['read', 'open', 'partial-write', 'flush', 'readback', 'rename']) {
  test(`I/O failure preserves the old manifest and cleans owned temporary files: ${fault}`, t => {
    const root = packageFixture(t), before = previousManifest(root);
    const error = new Error(`injected ${fault} failure`);
    const io = { ...fs };
    if (fault === 'read') io.readFileSync = (path, ...args) => {
      if (String(path).endsWith('.mp4')) throw error;
      return fs.readFileSync(path, ...args);
    };
    if (fault === 'open') io.openSync = () => { throw error; };
    if (fault === 'partial-write') io.writeFileSync = (fd) => { fs.writeSync(fd, 'partial'); throw error; };
    if (fault === 'flush') io.fsyncSync = () => { throw error; };
    if (fault === 'readback') io.readFileSync = (path, ...args) => {
      if (String(path).endsWith('.tmp')) return 'wrong bytes';
      return fs.readFileSync(path, ...args);
    };
    if (fault === 'rename') io.renameSync = () => { throw error; };
    assert.throws(() => sealManifest(root, io), fault === 'readback' ? /readback mismatch/ : e => e === error);
    assert.deepEqual(previousManifest(root), before);
    assertNoTemporary(root);
  });
}

test('failed exclusive open never deletes an unowned temporary file', t => {
  const root = packageFixture(t), before = previousManifest(root);
  let unowned;
  const io = { ...fs, openSync: (path, ...args) => {
    unowned = path;
    fs.writeFileSync(path, 'not ours');
    return fs.openSync(path, ...args);
  } };
  assert.throws(() => sealManifest(root, io), { code: 'EEXIST' });
  assert.deepEqual(previousManifest(root), before);
  assert.equal(readFileSync(unowned, 'utf8'), 'not ours');
});

test('CLI --seal replaces successfully; import with --seal does not execute the CLI', t => {
  const root = packageFixture(t);
  for (const name of ['verify-demo.mjs', 'verify-demo.test.mjs']) {
    fs.copyFileSync(new URL(name, import.meta.url), join(root, name));
  }
  const script = join(root, 'verify-demo.mjs');
  const sealed = spawnSync(process.execPath, [script, '--seal'], { encoding: 'utf8' });
  assert.equal(sealed.status, 0, sealed.stderr);
  assert.equal(JSON.parse(sealed.stdout).exactInventory, 8);
  const before = previousManifest(root);
  const verified = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(verified.status, 0, verified.stderr);
  const imported = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(script).href)});`, '--', '--seal'], { encoding: 'utf8' });
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, '');
  assert.deepEqual(previousManifest(root), before);
});
