import test from 'node:test';
import assert from 'node:assert/strict';
import { renderedCarrierText, discoverOwnedInjectionCarriers, sweepOwnedInjectionHistory } from '../extension/host/injection-prune.js';
import { stripInjections, stripRecordedInjection, wrapInjection } from '../extension/core/injection.js';
import { fixture, row } from './helpers/history-surface.js';

const nonce = 'dgce-0ade11fa43c8bc425e22dc92';
const body = '<memory>\nEstablished:\nBrass lantern on the desk.\n</memory>';
const inner = `<ext_ctx id=“${nonce}”>\n${body}\n</ext_ctx>`;
const text = value => ({ nodeType: 3, textContent: value });
function element(tagName, attrs, childNodes) {
  const node = { tagName, nodeType: 1, childNodes,
    get children() { return this.childNodes.filter(n => n.nodeType === 1); },
    get textContent() { return this.childNodes.map(n => n.textContent).join(''); },
    getAttribute: name => attrs[name] ?? null,
    closest(selector) {
      if (selector === '.prose' && attrs.class === 'prose') return this;
      if (selector === 'pre,code' && ['PRE', 'CODE'].includes(this.tagName)) return this;
      return this.parentElement?.closest(selector) ?? null;
    },
    querySelectorAll(selector) {
      return this.children.flatMap(n => [
        ...(selector === 'button[aria-label="Reveal spoiler"]' && n.tagName === 'BUTTON'
          && n.getAttribute('aria-label') === 'Reveal spoiler' ? [n] : []),
        ...n.querySelectorAll(selector),
      ]);
    },
  };
  childNodes.forEach(n => { n.parentElement = node; });
  return node;
}
function rendered(value = inner, variant = '') {
  const span = element('SPAN', { 'aria-hidden': variant === 'visible_span' ? 'false' : 'true' }, [text(value)]);
  const button = element('BUTTON', { 'aria-label': variant === 'wrong_label' ? 'Other' : 'Reveal spoiler',
    'aria-expanded': variant === 'expanded' ? 'true' : 'false' }, [span]);
  if (variant === 'extra_child') button.childNodes.push(text('extra'));
  const prose = element(variant === 'code' ? 'CODE' : 'DIV', { class: variant === 'outside_prose' ? '' : 'prose' }, [text('Rowan asks.\n'), button]);
  return { root: element('DIV', {}, [prose]), button, span };
}

test('observed hidden-spoiler DOM permits read-only discovery without changing DOM', () => {
  const { root } = rendered(), original = root.textContent;
  const projection = renderedCarrierText(root);
  assert.equal(projection, `Rowan asks.\n<hidden>${inner}</hidden>`);
  assert.deepEqual(stripInjections(projection).nonces, [nonce]);
  assert.equal(root.textContent, original);
  // A rendered candidate cannot substitute for the complete raw editor carrier.
  assert.equal(stripRecordedInjection(projection, { nonce, body }).status, 'manual_review');
  assert.equal(stripRecordedInjection(`Rowan asks.\n\n${wrapInjection(body, nonce)}`, { nonce, body }).status, 'matched');
});
for (const variant of ['wrong_label', 'expanded', 'visible_span', 'extra_child', 'outside_prose', 'code']) {
  test(`unrecognized spoiler shape remains ambiguous: ${variant}`, () => {
    const { root } = rendered(inner, variant);
    assert.equal(renderedCarrierText(root), root.textContent);
    assert.equal(stripInjections(renderedCarrierText(root)).status, 'ambiguous');
  });
}
test('plain hidden text is not a carrier; broken and nested carriers stay ambiguous', () => {
  assert.deepEqual(stripInjections(renderedCarrierText(rendered('plain secret').root)).nonces, []);
  for (const value of [inner.replace('</ext_ctx>', ''), `<hidden>${inner}</hidden>`, `${inner}<ext_ctx`]) {
    assert.equal(stripInjections(renderedCarrierText(rendered(value).root)).status, 'ambiguous');
  }
});
function historyWithSpoiler() {
  const fx = fixture(), dom = rendered(), target = row('Rowan', '');
  target.childNodes = dom.root.childNodes;
  const query = target.querySelectorAll.bind(target);
  target.querySelectorAll = s => s === 'button[aria-label="Reveal spoiler"]' ? [dom.button] : query(s);
  Object.defineProperty(target, 'textContent', { get: () => dom.root.textContent });
  fx.roots = [target, row('Kit', 'The lantern is available.')];
  fx.loaded = 2;
  return fx;
}
test('actual discovery associates rendered spoiler with one interaction and following reply', () => {
  const fx = historyWithSpoiler(), carriers = discoverOwnedInjectionCarriers(fx.doc);
  assert.equal(carriers.length, 1);
  assert.equal(carriers[0].nonce, nonce);
  assert.equal(carriers[0].interaction, fx.roots[0]);
  assert.equal(carriers[0].has_following_interaction, true);
});
test('rendered spoiler syntax never supplies ownership', async () => {
  const fx = historyWithSpoiler();
  fx.loaded = 1; // The native Load all cycle adds the second row.
  const result = await sweepOwnedInjectionHistory({ doc: fx.doc, records: [], waitOptions: { attempts: 4, delay: 0 } });
  assert.equal(result.status, 'manual_review');
  assert.deepEqual(result.unknown_nonces, [nonce]);
  assert.deepEqual(result.results, []);
});
test('raw exact cleanup still refuses changed body and wrong nonce', () => {
  const raw = `Rowan asks.\n\n${wrapInjection(body, nonce)}`;
  assert.equal(stripRecordedInjection(raw.replace('Brass', 'Glass'), { nonce, body }).status, 'manual_review');
  assert.equal(stripRecordedInjection(raw, { nonce: 'dgce-abcdef', body }).status, 'manual_review');
});
