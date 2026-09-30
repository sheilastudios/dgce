import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('manifest display version and candidate receipt match the loaded version', () => {
  const manifest = JSON.parse(readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
  const status = JSON.parse(readFileSync(new URL('../BUILD-STATUS.json', import.meta.url), 'utf8'));
  assert.equal(manifest.version_name, `${manifest.version} public candidate`);
  assert.equal(status.version, manifest.version);
});

test('actual panel module graph imports without unresolved exports or top-level browser access', async () => {
  const panel = await import('../extension/ui/panel.js');
  assert.equal(typeof panel.mountPanel, 'function');
});
