import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const expectedFiles = ['DEMO-MANIFEST.json', 'DEMO-STATUS.md', 'README.md', 'RIGHTS.md', 'SCENARIO.md', 'media/QE_DEMO_DreamGen.mp4', 'verify-demo.mjs', 'verify-demo.test.mjs'].sort();
const requiredFields = ['Title', 'Brief description', 'Public description', 'Setting', 'Player character: Johnny / Bob', 'Character: Hazelnut', 'Style', 'Plot', 'Opening description'];

export function inspectScenario(input) {
  const text = input.replaceAll('\r\n', '\n');
  const headings = [...text.matchAll(/^## (.+)$/gm)];
  assert.equal(new Set(headings.map(h => h[1])).size, headings.length, 'duplicate section');
  const sections = Object.fromEntries(headings.map((h, i) => [h[1], text.slice(h.index + h[0].length, headings[i + 1]?.index ?? text.length).trim()]));
  const body = name => {
    const match = sections[name]?.match(/^```(text|xml)\n([\s\S]*?)\n```$/);
    assert.ok(match, `one fenced copy block required: ${name}`);
    return match[2];
  };
  for (const name of requiredFields) body(name);
  assert.equal(body('Title'), 'Quantum Enchantments: The Waykey');
  assert.ok(body('Brief description').length <= 75, 'brief too long');
  assert.ok(!text.includes('#oc2026'), 'demo must not claim contest entry');
  assert.ok(!text.includes('<ext_ctx'), 'no injected carrier in source');
  const xmlFields = ['Setting', 'Player character: Johnny / Bob', 'Character: Hazelnut', 'Style', 'Plot'];
  for (const name of xmlFields) assert.match(sections[name], /^```xml\n/);
  // XML is additionally parsed with .NET XmlDocument in the package check.
  // These checks pin copy structure and regression intent, not model semantics.
  assert.match(body('Setting'), /simultaneous physical awareness is rare/);
  assert.match(body('Setting'), /Transcript presence is not transmission/);
  assert.match(body('Setting'), /Cynthia is not Hazelnut/);
  assert.match(body('Character: Hazelnut'), /Hazelnut is a were-squirrel/);
  assert.match(body('Character: Hazelnut'), /no tail, fur or animal ears/);
  assert.match(body('Character: Hazelnut'), /Chemistry may develop; never assume Bob reciprocates/);
  assert.match(body('Plot'), /<npc_initiative>/);
  assert.match(body('Plot'), /floor hatch ABOVE Pip/);
  assert.match(body('Plot'), /Settle applicable agreed rewards/);
  assert.match(body('Style'), /not NPC\s+dialogue/);
  assert.match(body('Style'), /Figurative\s+personification/);
  assert.match(body('Style'), /never a separate commentator/);
  assert.match(body('Style'), /Never append an unattended-world cutaway/);
  const openings = [...(sections['Opening interactions'] ?? '').matchAll(/^### (\d+)\. (Narrative|Character — [^\n]+)\n\n```text\n([\s\S]*?)\n```/gm)];
  assert.equal(openings.length, 8, 'eight opening interactions required');
  assert.deepEqual(openings.map(m => Number(m[1])), [1,2,3,4,5,6,7,8]);
  assert.deepEqual(openings.map(m => m[2]), ['Narrative','Character — High Priestess Aurelia','Character — Hazelnut','Character — High Priestess Aurelia','Character — Hazelnut','Character — High Priestess Aurelia','Narrative','Character — High Priestess Aurelia']);
  const openingText = openings.map(m => m[3]).join('\n');
  assert.doesNotMatch(openingText, /Cynthia|NeoKing|five minutes|Meanwhile/);
  assert.match(openingText, /What would you need to know/);
  const cards = [...(sections['Optional Chaos Deck cards — not scenario fields'] ?? '').matchAll(/^### (.+)\n\n```text\n([\s\S]*?)\n```/gm)];
  assert.equal(cards.length, 6);
  assert.equal(new Set(cards.map(m => m[1])).size, 6);
  for (const card of cards) {
    assert.ok(card[2].length <= 220, `card length: ${card[1]}`);
    assert.match(card[2], /Ignore otherwise\.$/, `ignore permission: ${card[1]}`);
  }
  assert.match(sections['Optional Chaos Deck cards — not scenario fields'], /protection from refill eviction, not from consumption/);
  return { copyableFields: requiredFields.length, xmlFields: xmlFields.length, openingInteractions: openings.length, optionalDeckCards: cards.length };
}

export function inventory(root, io = fs) {
  const walk = dir => io.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    assert.ok(!e.isSymbolicLink(), 'symlink disallowed');
    return e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)];
  });
  const files = walk(root).map(p => relative(root, p).replaceAll('\\', '/')).sort();
  assert.deepEqual(files, expectedFiles, 'unexpected or missing package members');
  return files.filter(p => p !== 'DEMO-MANIFEST.json').map(path => {
    const data = io.readFileSync(join(root, path));
    return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  });
}

export function verifyManifest(manifest, entries) {
  assert.equal(manifest.schema, 3);
  assert.equal(manifest.package, 'QE-The-Waykey-expanded-demo-r3');
  assert.equal(manifest.livePlaytestScope, 'focused-private-clone-not-end-to-end');
  assert.equal(manifest.stableReleaseApproved, false);
  assert.deepEqual(manifest.files, entries, 'artifact hash/inventory mismatch');
}

// Maintainer-only operation on a quiescent package directory, not a signing or
// authorization boundary. Never truncate/unlink the previous manifest first.
export function sealManifest(root, io = fs) {
  inspectScenario(io.readFileSync(join(root, 'SCENARIO.md'), 'utf8'));
  const files = inventory(root, io);
  const manifest = { schema: 3, package: 'QE-The-Waykey-expanded-demo-r3', date: '2026-09-30', livePlaytestScope: 'focused-private-clone-not-end-to-end', stableReleaseApproved: false, excludes: 'Manifest excludes itself; any external ZIP SHA must bind all members.', files };
  verifyManifest(manifest, files);
  const serialized = JSON.stringify(manifest, null, 2) + '\n';
  const temporary = join(root, `.DEMO-MANIFEST-${randomUUID()}.tmp`);
  let fd = null, ownsTemporary = false;
  try {
    fd = io.openSync(temporary, 'wx', 0o600);
    ownsTemporary = true;
    io.writeFileSync(fd, serialized, 'utf8');
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = null;
    assert.equal(io.readFileSync(temporary, 'utf8'), serialized, 'temporary manifest readback mismatch');
    // Same-directory replacement; if rename fails, the old file remains.
    // Do not fall back to deleting the destination on Windows or elsewhere.
    io.renameSync(temporary, join(root, 'DEMO-MANIFEST.json'));
    ownsTemporary = false;
    return manifest;
  } finally {
    try { if (fd !== null) io.closeSync(fd); }
    finally { if (ownsTemporary) io.unlinkSync(temporary); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = dirname(fileURLToPath(import.meta.url));
  const results = inspectScenario(fs.readFileSync(join(root, 'SCENARIO.md'), 'utf8'));
  if (process.argv.includes('--seal')) sealManifest(root);
  const entries = inventory(root);
  verifyManifest(JSON.parse(fs.readFileSync(join(root, 'DEMO-MANIFEST.json'), 'utf8')), entries);
  console.log(JSON.stringify({ ...results, hashesPassed: entries.length, exactInventory: expectedFiles.length, livePlaytestScope: 'focused-private-clone-not-end-to-end', stableReleaseApproved: false }, null, 2));
}
