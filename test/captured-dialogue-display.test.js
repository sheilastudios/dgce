import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { matchesLocalSendDisplay } from '../extension/host/builder-transcript.js';
import { compareHostPackets } from '../extension/core/host-packet-equivalence.js';
import { stripRecordedInjection, wrapInjection } from '../extension/core/injection.js';

// Read-only DOM capture from .155 turn 35, paired with that turn's UI-exported
// injection record. Functions below only restore Element accessors, not text.
const captured = JSON.parse(readFileSync(new URL('./fixtures/dialogue-carrier-dom-155.json', import.meta.url), 'utf8'));
const hydrate = node => {
  node.childNodes?.forEach(hydrate);
  if (node.nodeType === 1) {
    node.style = { display: node.display };
    node.getAttribute = name => name === 'data-dgce-concealed' ? node.concealed : null;
  }
  return node;
};
const fixture = () => hydrate(structuredClone(captured.prose));
const packet = wrapInjection(captured.body, captured.nonce);

test('captured live dialogue matches despite host removing carrier continuation indentation', () => {
  assert.equal(matchesLocalSendDisplay(fixture(), captured.source, packet), true);
});

test('captured display projection cannot authorize raw delivery or cleanup', () => {
  const displayed = captured.prose.childNodes.filter(node => node.concealed === '1').map(node => node.textContent).join('\n\n');
  const comparison = compareHostPackets(packet, displayed);
  assert.equal(comparison.equivalent, false);
  assert.equal(comparison.first_normalized_difference.expected.startsWith('    last supported'), true);
  assert.equal(comparison.first_normalized_difference.inspected.startsWith('last supported'), true);
  assert.equal(stripRecordedInjection(`${captured.source}\n\n${displayed}`, captured).status, 'manual_review');
});

for (const indent of [' ', '  ', '   ', '     ', '\t']) {
  test(`unobserved source indentation ${JSON.stringify(indent)} stays unsupported`, () => {
    const changed = packet.replace('\n    last supported', `\n${indent}last supported`);
    assert.equal(matchesLocalSendDisplay(fixture(), captured.source, changed), false);
  });
}

test('carrier paragraph boundaries and first-line indentation remain exact', () => {
  assert.equal(matchesLocalSendDisplay(fixture(), captured.source, packet.replace('\n    last supported', '\n\n    last supported')), false);
  assert.equal(matchesLocalSendDisplay(fixture(), captured.source, packet.replace('\n\n<deck>', '\n\n    <deck>')), false);
  assert.equal(matchesLocalSendDisplay(fixture(), captured.source, null), false);
});

for (const [name, change] of [
  ['body change', value => value.replace('covered', 'left')],
  ['support turn', value => value.replace('17 of 35', '18 of 35')],
  ['nonce', value => value.replace('c739616f8f8dc3a75d47bdfc', 'c739616f8f8dc3a75d47bdfd')],
  ['space inside line', value => value.replace('last supported', 'last  supported')],
  ['unexpected indentation', value => value.replace('\nlast supported', '\n  last supported')],
  ['body curly apostrophe', value => value.replace("Johnny's", 'Johnny’s')],
]) {
  test(`captured carrier rejects ${name}`, () => {
    const prose = fixture();
    prose.childNodes[2].textContent = change(prose.childNodes[2].textContent);
    assert.equal(matchesLocalSendDisplay(prose, captured.source, packet), false);
  });
}
