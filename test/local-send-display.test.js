import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesLocalSendDisplay } from '../extension/host/builder-transcript.js';
import { dialogueRow, appendConcealedCarrier } from './helpers/history-surface.js';
import { compareHostPackets } from '../extension/core/host-packet-equivalence.js';

const source = 'I ask, "Which basket?" Then "This one?"';
const fixture = () => dialogueRow('Johnny', source).prose;

test('display comparison permits only marked dialogue edge rendering', () => {
  assert.equal(matchesLocalSendDisplay(fixture(), source), true);
  assert.equal(matchesLocalSendDisplay(fixture(), source.replace('"Which basket?"', '“Which basket?”')), true);
  assert.equal(matchesLocalSendDisplay({ innerText: ' exact\r\ntext ' }, 'exact\ntext'), true);
});

test('adjacent quote Text nodes are equivalent to one Text node without changing characters', () => {
  const prose = fixture();
  const quote = prose.childNodes[0].childNodes[1];
  assert.equal(quote.childNodes.length, 3, 'captured host splits delimiter/body/delimiter');
  assert.equal(matchesLocalSendDisplay(prose, source), true);
  const text = quote.childNodes.map(node => node.textContent).join('');
  quote.childNodes = [{ nodeType: 3, textContent: text }];
  assert.equal(matchesLocalSendDisplay(prose, source), true);
  quote.childNodes = Array.from(text, char => ({ nodeType: 3, textContent: char }));
  assert.equal(matchesLocalSendDisplay(prose, source), true);
});

for (const child of [{ nodeType: 8, textContent: 'comment' },
  { nodeType: 1, tagName: 'EM', textContent: 'nested' }]) {
  test(`split quote rejects non-text node type ${child.nodeType}`, () => {
    const prose = fixture();
    prose.childNodes[0].childNodes[1].childNodes.splice(1, 0, child);
    assert.equal(matchesLocalSendDisplay(prose, source), false);
  });
}

for (const mode of ['unmarked', 'wrong-class', 'nested', 'wrong-tag', 'wrong-delimiter',
  'changed-word', 'punctuation', 'interior-quote', 'display-hidden-text', 'line-break', 'extra-paragraph']) {
  test(`display comparison rejects ${mode}`, () => {
    const prose = fixture(), quote = prose.childNodes[0].childNodes[1];
    let expected = source;
    if (mode === 'unmarked') prose.childNodes = [];
    if (mode === 'wrong-class') quote.className = 'not-quote';
    if (mode === 'nested') quote.childNodes = [{ nodeType: 1, tagName: 'EM', textContent: '“Which basket?”' }];
    if (mode === 'wrong-tag') quote.tagName = 'EM';
    if (mode === 'wrong-delimiter') quote.childNodes[0].textContent = '”Which basket?“';
    if (mode === 'changed-word') expected = source.replace('basket', 'bucket');
    if (mode === 'punctuation') expected = source.replace('?', '!');
    if (mode === 'interior-quote') expected = source.replace('basket', 'bas“et');
    if (mode === 'display-hidden-text') prose.innerText += ' omitted';
    if (mode === 'line-break') prose.innerText = prose.innerText.replace(' Then ', '\nThen ');
    if (mode === 'extra-paragraph') prose.childNodes.push({ nodeType: 1, tagName: 'P', childNodes: [{ nodeType: 3, textContent: 'hidden' }] });
    assert.equal(matchesLocalSendDisplay(prose, expected), false);
  });
}

test('display allowance does not make body quotes equivalent in raw packet evidence', () => {
  assert.equal(compareHostPackets(source, fixture().innerText).equivalent, false);
});

const carrier = '<hidden><ext_ctx id="dgce-abcdef123">\n<memory>\nExact body.\n</memory>\n\n<deck>\nOptional.\n</deck>\n</ext_ctx></hidden>';
test('concealed split paragraphs require the complete locally bound carrier', () => {
  const prose = appendConcealedCarrier(dialogueRow('Johnny', source), carrier.replace('"dgce-abcdef123"', '“dgce-abcdef123”')).prose;
  assert.equal(matchesLocalSendDisplay(prose, source, carrier), true);
  assert.equal(matchesLocalSendDisplay(prose, source), false);
});

for (const mode of ['body', 'nonce', 'marker', 'visible', 'extra', 'interleaved', 'unbound', 'body-quote']) {
  test(`concealed display suffix rejects ${mode}`, () => {
    const prose = appendConcealedCarrier(dialogueRow('Johnny', source), carrier).prose;
    const hidden = prose.childNodes[2]; let bound = carrier;
    if (mode === 'body') hidden.textContent = hidden.textContent.replace('Exact', 'Wrong');
    if (mode === 'nonce') bound = bound.replace('abcdef123', 'abcdef124');
    if (mode === 'marker') hidden.getAttribute = () => null;
    if (mode === 'visible') hidden.style.display = '';
    if (mode === 'extra') hidden.textContent += ' extra';
    if (mode === 'interleaved') prose.childNodes.push(prose.childNodes[0]);
    if (mode === 'unbound') bound = null;
    if (mode === 'body-quote') { bound = bound.replace('Exact', '"Exact"'); hidden.textContent = hidden.textContent.replace('Exact', '“Exact”'); }
    assert.equal(matchesLocalSendDisplay(prose, source, bound), false);
  });
}
