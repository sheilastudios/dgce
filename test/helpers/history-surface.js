// Captured English host representation: one live OUTPUT sibling of stored rows.
export function row(actor, body) {
  const root = { tagName: 'DIV', className: 'flex flex-col rounded-md min-h-12', isConnected: true,
    textContent: actor + body, actor, body,
    querySelectorAll(s) {
      if (s === '.prose') return [this.prose ?? { innerText: this.body }];
      if (s === 'div.text-sm.font-light.opacity-65') return [{ textContent: this.actor }];
      return [];
    },
    querySelector(s) { return s.includes('button[aria-label="Edit Interaction"]') ? this.edit : null; },
    closest(s) { return s === 'div.OUTPUT' ? this.output ?? null : s === 'div.group' ? this.group : null; },
  };
  root.edit = { closest: () => root };
  root.group = { contains: x => x === root };
  root.group.parentElement = { tagName: 'DIV', className: 'flex flex-col', children: [root.group] };
  return root;
}
// Actual host dialogue shape: paragraphs containing text and span.quote nodes.
export function dialogueRow(actor, source) {
  const text = value => ({ nodeType: 3, textContent: value });
  const paragraphs = source.split('\n\n').map(part => {
    const children = []; let end = 0;
    for (const match of part.matchAll(/"([^"\n]*)"/g)) {
      children.push(text(part.slice(end, match.index)));
      children.push({ nodeType: 1, tagName: 'SPAN', className: 'quote',
        childNodes: [text('“'), text(match[1]), text('”')] });
      end = match.index + match[0].length;
    }
    children.push(text(part.slice(end)));
    return { nodeType: 1, tagName: 'P', childNodes: children };
  });
  const rendered = source.replace(/"([^"\n]*)"/g, '“$1”');
  const root = row(actor, rendered);
  root.prose = { innerText: rendered, childNodes: paragraphs.flatMap((p, i) => i ? [text('\n'), p] : [p]) };
  return root;
}
export function appendConcealedCarrier(root, carrier) {
  for (const part of carrier.split('\n\n')) {
    root.prose.childNodes.push({ nodeType: 3, textContent: '\n' }, {
      nodeType: 1, tagName: 'P', textContent: part, style: { display: 'none' },
      getAttribute: name => name === 'data-dgce-concealed' ? '1' : null,
      childNodes: [{ nodeType: 3, textContent: part }],
    });
  }
  root.textContent += carrier;
  return root;
}
export function fixture() {
  const lane = {}, fx = { roots: [row('Narrator', 'Old history'), row('Johnny', 'Old player')], loaded: 1, load: true, listeners: [], outputs: [] };
  fx.history = { tagName: 'DIV', className: 'flex flex-col', parentElement: lane };
  fx.generated = members => {
    for (const root of fx.roots) root.output = null;
    const output = { tagName: 'DIV', className: 'OUTPUT relative flex flex-col min-h-[calc(min(23rem,47vh))]',
      parentElement: lane, contains: root => members.includes(root) };
    members.forEach(root => { root.output = output; }); fx.outputs = [output];
    return output;
  };
  const load = { textContent: 'Load all', getAttribute: () => null, click() { fx.loaded = Infinity; fx.load = false; } };
  fx.doc = { location: { origin: 'https://v2.dreamgen.com', pathname: '/app/my/session/fixture' }, documentElement: { lang: 'en' },
    body: {}, addEventListener(type, fn) { if (type === 'click') fx.listeners.push(fn); },
    querySelectorAll(s) {
      fx.roots.forEach(r => { r.group.parentElement.parentElement = r.output ?? fx.history; });
      const roots = fx.roots.slice(0, fx.loaded);
      if (s === 'div.OUTPUT') return fx.outputs;
      if (s === 'div.flex.flex-col.rounded-md.min-h-12') return roots;
      if (s === 'button[aria-label="Edit Interaction"]') return roots.map(r => r.edit);
      if (s === 'button') return [...(fx.load ? [load] : []), { textContent: 'Continue conversation', getAttribute: () => null }];
      if (s.includes('Message as ')) return [{ offsetParent: {}, getAttribute: () => 'Message as Johnny' }];
      return [];
    } };
  fx.click = label => fx.listeners.forEach(fn => fn({ isTrusted: true, target: { closest: () => ({ getAttribute: () => label }) } }));
  return fx;
}
