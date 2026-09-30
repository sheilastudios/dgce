import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fixture, row, dialogueRow, appendConcealedCarrier } from './helpers/history-surface.js';
import { captureOpeningSessionHistory, attestOpeningSessionHistory, settleHistoryContinuity,
  hasHistoryCompletenessWitness, historyContinuityScope, armHistoryLocalSend,
  loadedInteractionRoots } from '../extension/host/builder-transcript.js';
import { historyContinuityDiagnostics, historyLoadControl, inspectHistoryLoad } from '../extension/host/builder-transcript.js';
import { beginHistoryReadback, acknowledgeHistoryReadback } from '../extension/host/builder-transcript.js';

const panel = readFileSync(new URL('../extension/ui/panel.js', import.meta.url), 'utf8');
const quickLoad = { attempts: 5, delay: 0 };
for (const change of ['normal', 'changed-body', 'changed-actor', 'prefix-remount', 'not-detached', 'wrong-anchor', 'no-send', 'duplicate-output']) {
  test(`Load all preserves terminal reply representation lease: ${change}`, async () => {
    const fx = fixture();
    const replies = [row('Hazelnut', 'First reply'), row('Narrator', 'Second reply')];
    fx.roots.push(...replies); fx.generated(replies);
    if (change === 'duplicate-output') fx.outputs.push(fx.outputs[0]);
    assert.equal((await inspectHistoryLoad(fx.doc, quickLoad)).complete, true);
    if (change !== 'no-send') assert.equal(armHistoryLocalSend(fx.doc, { id: 'next', visibleText: 'Next action' }), true);
    for (const old of replies) old.isConnected = change === 'not-detached';
    fx.roots.splice(2, 2, ...replies.map(r => row(r.actor, r.body)));
    if (change === 'changed-body') fx.roots[2] = row('Hazelnut', 'Different reply');
    if (change === 'changed-actor') fx.roots[2] = row('Cynthia', 'First reply');
    if (change === 'prefix-remount') fx.roots[0] = row('Narrator', 'Old history');
    const next = row('Hazelnut', 'New response');
    fx.roots.push(row('Johnny', change === 'wrong-anchor' ? 'Not the action' : 'Next action'), next);
    fx.generated([next]);
    assert.equal(await settleHistoryContinuity(fx.doc, quickLoad), change === 'normal');
  });
}
function extract(name) {
  const at = panel.indexOf(`function ${name}(`);
  assert.ok(at >= 0);
  return panel.slice(panel.slice(at - 6, at) === 'async ' ? at - 6 : at, panel.indexOf('\n}', at) + 2);
}
function harness({ attest = true, settle = settleHistoryContinuity } = {}) {
  const fx = fixture(); fx.loaded = Infinity; fx.load = false;
  fx.roots = Array.from({length:10}, (_, i) => row('Narrator', `Opening ${i}`));
  if (attest) assert.equal(attestOpeningSessionHistory(fx.doc,
    captureOpeningSessionHistory(fx.doc, fx.doc.location.pathname)), true);
  const state = { epoch:1, ws:{workspace_id:'fixture',injections:[],timeline_integrity:{}},
    carrierHygieneStatus:'clean' };
  let renders = 0, recoveryRequests = 0;
  const context = { state, document:fx.doc, isCurrent:e=>e===state.epoch,
    workspaceIdFromLocation:()=>fx.doc.location.pathname.split('/').at(-1),
    editionWorkspaceIssue:()=>null, hasHistoryCompletenessWitness, historyContinuityScope,
    loadedInteractionRoots, discoverOwnedInjectionCarriers:()=>fx.carriers ?? [],
    historyLoadControl, roleplayEditorIdle:()=>!fx.busy,
    scheduleRecurringInjectionPrune:()=>recoveryRequests++,
    settleHistoryContinuity:doc=>settle(doc,{attempts:5,delay:0}), render:()=>renders++ };
  const api = runInNewContext(`${extract('scheduleFreeHistoryRecovery')}\n${extract('refreshFreeHistoryContinuity')}\n({refresh:refreshFreeHistoryContinuity,recover:scheduleFreeHistoryRecovery})`,context);
  return {fx,state,...api,renders:()=>renders,recoveryRequests:()=>recoveryRequests};
}

test('carrier-free pagination requests an independent Load all cycle, never promotes the subset', async () => {
  const h = harness(), { fx } = h;
  h.state.ws.current_turn = 4;
  const all = fx.roots;
  fx.roots = all.slice(3); fx.load = true;
  const control = historyLoadControl(fx.doc);
  control.click = () => { fx.roots = all; fx.load = false; };
  assert.equal(await h.refresh(), false);
  assert.equal(h.state.carrierHygieneStatus, 'history_unverified');
  assert.equal(h.recoveryRequests(), 1);
  assert.equal(fx.load, true, 'refresh schedules the idle-gated sweep, not a direct click');
  await h.refresh(); h.recover();
  assert.equal(h.recoveryRequests(), 1, 'same turn/control cannot create a retry storm');
  // The unchanged sweep's loader must obtain positive materialization evidence.
  assert.equal((await inspectHistoryLoad(fx.doc, { attempts: 5, delay: 0 })).complete, true);
  assert.equal(await h.refresh(), true);
  assert.equal(h.state.carrierHygieneStatus, 'clean');
  assert.equal(historyContinuityScope(fx.doc), 'supported_host_load_all_cycle');
});

test('a vanished load button without restored rows cannot restore clearance', async () => {
  const h = harness(), { fx } = h;
  fx.roots = fx.roots.slice(3); fx.load = true;
  historyLoadControl(fx.doc).click = () => { fx.load = false; };
  await h.refresh();
  assert.equal((await inspectHistoryLoad(fx.doc, { attempts: 5, delay: 0 })).complete, false);
  assert.equal(await h.refresh(), false);
  assert.equal(h.state.carrierHygieneStatus, 'history_unverified');
});

for (const blocker of ['pending', 'readback', 'assistant', 'archivist', 'prune', 'dirty', 'generation', 'timeline', 'unretired', 'route', 'save_uncertain']) {
  test(`pagination recovery waits for ${blocker}`, () => {
    const h = harness(), { state, fx } = h;
    state.carrierHygieneStatus = 'history_unverified'; fx.load = true;
    if (blocker === 'pending') state.ws.ordinary_pending = {};
    if (blocker === 'readback') state.freeReadback = { busy: true };
    if (blocker === 'assistant') state.assistantBusy = true;
    if (blocker === 'archivist') state.archivistBusy = true;
    if (blocker === 'prune') state.injectionPruneBusy = true;
    if (blocker === 'dirty') state.dirty = new Set(['draft']);
    if (blocker === 'generation') fx.busy = true;
    if (blocker === 'timeline') state.ws.timeline_integrity.desynchronized = true;
    if (blocker === 'unretired') state.ws.injections = [{ pruned: false }];
    if (blocker === 'route') fx.doc.location.pathname += '_other';
    if (blocker === 'save_uncertain') state.carrierHygieneStatus = 'save_uncertain';
    h.recover();
    assert.equal(h.recoveryRequests(), 0);
    assert.equal(state.freeHistoryRecovery, undefined, 'blocked work must not consume an attempt');
  });
}

test('busy-clear recheck can schedule once; another turn or epoch can retry', () => {
  const h = harness(); h.state.carrierHygieneStatus = 'history_unverified'; h.fx.load = true;
  h.state.ws.current_turn = 4; h.fx.busy = true; h.recover();
  assert.equal(h.recoveryRequests(), 0);
  h.fx.busy = false; h.recover(); h.recover(); assert.equal(h.recoveryRequests(), 1);
  h.state.ws.current_turn++; h.recover(); assert.equal(h.recoveryRequests(), 2);
  h.state.epoch++; h.recover(); assert.equal(h.recoveryRequests(), 3);
});

test('ambiguous, hidden, and unsupported Load all controls are not recovery opportunities', () => {
  const fx = fixture(), query = fx.doc.querySelectorAll.bind(fx.doc);
  const control = historyLoadControl(fx.doc); assert.ok(control);
  fx.doc.querySelectorAll = selector => selector === 'button' ? [control, control] : query(selector);
  assert.equal(historyLoadControl(fx.doc), null);
  fx.doc.querySelectorAll = query; control.offsetParent = null;
  assert.equal(historyLoadControl(fx.doc), null);
  delete control.offsetParent; fx.doc.location.origin = 'https://unsupported.invalid';
  assert.equal(historyLoadControl(fx.doc), null);
});

test('plain-turn lifecycle adopts additions and next-turn remount without a carrier cleanup', async () => {
  const h=harness(), {fx}=h;
  assert.equal(armHistoryLocalSend(fx.doc,{id:'first',visibleText:'Question'}),true);
  const reply=row('Hazelnut','Answer');
  fx.roots.push(row('Johnny','Question'),reply); fx.generated([reply]);
  assert.equal(hasHistoryCompletenessWitness(fx.doc),false);
  assert.equal(await h.refresh(),true);
  assert.equal(h.state.carrierHygieneStatus,'clean');
  assert.match(h.state.carrierHygieneReason,/12 interactions/);
  assert.equal(armHistoryLocalSend(fx.doc,{id:'second',visibleText:'Next question'}),true);
  reply.isConnected=false; fx.roots[11]=row('Hazelnut','Answer');
  const next=row('Hazelnut','Next answer');
  fx.roots.push(row('Johnny','Next question'),next); fx.generated([next]);
  assert.equal(await h.refresh(),true);
  assert.equal(historyContinuityScope(fx.doc),'user_attested_scenario_opening');
  assert.match(h.state.carrierHygieneReason,/14 interactions/);
  const renders=h.renders(); await h.refresh();
  assert.equal(h.renders(),renders,'unchanged observation must not create a render/mutation loop');
});

test('bare visible history cannot mint clearance or auto-click Load all', async () => {
  const h=harness({attest:false}); h.fx.load=true;
  assert.equal(await h.refresh(),false);
  assert.equal(h.state.carrierHygieneStatus,'history_unverified');
  assert.equal(h.fx.load,true);
  assert.equal(hasHistoryCompletenessWitness(h.fx.doc),false);
});

test('three local dialogue sends survive host quote rendering and reply remounts', async () => {
  const h = harness(), { fx } = h;
  let previous;
  for (let turn = 1; turn <= 3; turn++) {
    const source = `I check ticket ${turn}. "Which basket?" I ask.\n\n"This one?"`;
    assert.equal(armHistoryLocalSend(fx.doc, { id: `quoted-${turn}`, visibleText: source }), true);
    if (previous) {
      previous.isConnected = false;
      fx.roots[fx.roots.indexOf(previous)] = row('Hazelnut', previous.body);
    }
    previous = row('Hazelnut', `Answer ${turn}`);
    fx.roots.push(dialogueRow('Johnny', source), previous); fx.generated([previous]);
    assert.equal(await h.refresh(), true, `clearance after dialogue turn ${turn}`);
  }
});

for (const indentationRendered of [false, true]) test(`context-bearing dialogue survives cleanup and the next reply-batch remount (indentation rendered: ${indentationRendered})`, async () => {
  const h = harness(), { fx } = h;
  let previous;
  for (let turn = 1; turn <= 3; turn++) {
    const source = `"Question ${turn}?" I ask.`;
    const carrier = `<hidden><ext_ctx id="dgce-abcdef${turn}">\n<memory>\nFacts.\n    last supported turn 1 of ${turn}\n</memory>\n\n<deck>\nOptional.\n</deck>\n</ext_ctx></hidden>`;
    assert.equal(armHistoryLocalSend(fx.doc, { id: `carrier-${turn}`, visibleText: source, carrierText: carrier }), true);
    if (previous) {
      previous.isConnected = false;
      fx.roots[fx.roots.indexOf(previous)] = row('Hazelnut', previous.body);
    }
    const displayCarrier = indentationRendered ? carrier.replace('\n    last supported', '\nlast supported') : carrier;
    const player = appendConcealedCarrier(dialogueRow('Johnny', source), displayCarrier);
    previous = row('Hazelnut', `Answer ${turn}`);
    fx.roots.push(player, previous); fx.generated([previous]);
    assert.equal(await settleHistoryContinuity(fx.doc, { attempts: 5, delay: 0 }), true, `settlement ${turn}`);
    assert.equal(historyContinuityDiagnostics(fx.doc).at(-1).anchor_issue, null);
    assert.equal(historyContinuityDiagnostics(fx.doc).at(-1).reply_batch, true);
    const prior = player.textContent, end = beginHistoryReadback(fx.doc, player, prior);
    const cleaned = dialogueRow('Johnny', source);
    fx.roots[fx.roots.indexOf(player)] = cleaned; player.isConnected = false;
    acknowledgeHistoryReadback(fx.doc, player, prior, cleaned); end();
    assert.equal(await h.refresh(), true, `cleaned turn ${turn}`);
  }
});

test('continuity diagnostics are bounded copies containing no submitted story text', async () => {
  const h = harness(), { fx } = h;
  for (let n = 0; n < 6; n++) {
    const text = `private-story-${n}`;
    assert.equal(armHistoryLocalSend(fx.doc, { id: `private-id-${n}`, visibleText: text }), true);
    const reply = row('Hazelnut', `private-reply-${n}`);
    fx.roots.push(row('Johnny', text), reply); fx.generated([reply]);
    assert.equal(await h.refresh(), true);
  }
  const diagnostics = historyContinuityDiagnostics(fx.doc);
  assert.equal(diagnostics.length, 8);
  assert.equal(diagnostics.at(-1).anchor_issue, null);
  assert.equal(diagnostics.at(-1).reply_batch, true);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/);
  diagnostics.at(-1).reply_batch = false;
  assert.equal(historyContinuityDiagnostics(fx.doc).at(-1).reply_batch, true);
});

test('diagnostics distinguish a display mismatch from absent local send arming', async () => {
  const h = harness(), { fx } = h;
  armHistoryLocalSend(fx.doc, { id: 'bound', visibleText: 'Expected text' });
  const reply = row('Hazelnut', 'Reply');
  fx.roots.push(row('Johnny', 'Different text'), reply); fx.generated([reply]);
  assert.equal(await h.refresh(), true); // additive history, not a delivery receipt
  const latest = historyContinuityDiagnostics(fx.doc).at(-1);
  assert.equal(latest.anchor_issue, 'display_mismatch');
  assert.equal(latest.reply_batch, false);
});

for(const mode of ['changed-text','replaced-root','carrier','unretired-record','dirty','save-uncertain','timeline']) {
  test(`plain continuity refuses ${mode}`,async()=>{
    const h=harness();
    if(mode==='changed-text') h.fx.roots[0].textContent+=' altered';
    if(mode==='replaced-root') h.fx.roots[0]=row('Narrator','Opening 0');
    if(mode==='carrier') h.fx.carriers=[{nonce:'dgce-foreign'}];
    if(mode==='unretired-record') h.state.ws.injections=[{pruned:false}];
    if(mode==='dirty') h.state.carrierHygieneStatus='dirty';
    if(mode==='save-uncertain') h.state.carrierHygieneStatus='save_uncertain';
    if(mode==='timeline') h.state.ws.timeline_integrity.desynchronized=true;
    assert.equal(await h.refresh(),false);
    assert.equal(h.renders(),['changed-text','replaced-root','carrier'].includes(mode)?1:0);
  });
}

for(const mode of ['route','epoch','workspace','cleanup','record']) {
  test(`settlement result cannot cross ${mode} movement`,async()=>{
    let release;
    const h=harness({settle:()=>new Promise(resolve=>{release=resolve})});
    const pending=h.refresh();
    if(mode==='route') h.fx.doc.location.pathname+='_other';
    if(mode==='epoch') h.state.epoch++;
    if(mode==='workspace') h.state.ws={...h.state.ws};
    if(mode==='cleanup') h.state.injectionPruneBusy=true;
    if(mode==='record') h.state.ws.injections.push({pruned:false});
    release(true); assert.equal(await pending,false); assert.equal(h.renders(),0);
  });
}

test('settlement exception withholds clearance',async()=>{
  const h=harness({settle:async()=>{throw new Error('fixture')}});
  assert.equal(await h.refresh(),false);
  assert.equal(h.state.carrierHygieneStatus,'history_unverified');
});

test('hidden drawer update invalidates stale DOM while quiet dismissal still preserves drafts',()=>{
  const drawer={hidden:true,querySelector:()=>null,replaceChildren(){this.replaced=(this.replaced??0)+1}};
  const context={root:{getElementById:()=>drawer},state:{epoch:1,tab:'Debug'},drawerResizer:{},
    header:()=>null,nav:()=>null,body:()=>null};
  const api=runInNewContext(`let dismissedDrawer={epoch:1,tab:'Debug'};
    ${extract('render')}\n${extract('toggle')}
    ({render,toggle,reset:()=>{drawer.hidden=true;dismissedDrawer={epoch:1,tab:'Debug'}}})`,{...context,drawer});
  api.toggle(); assert.equal(drawer.replaced,undefined,'quiet dismissal preserves existing draft DOM');
  api.reset(); api.render(); api.toggle();
  assert.equal(drawer.replaced,1,'background update cannot reopen stale turn-0 diagnostics');
});

test('observer and pre-send both invoke continuity settlement independently of carrier presence',()=>{
  assert.ok(extract('observeOwnedCarriersInHost').indexOf('refreshFreeHistoryContinuity()')
    < extract('observeOwnedCarriersInHost').indexOf('if (!present.length) return'));
  assert.ok(extract('prepareOrdinarySubmission').indexOf('await refreshFreeHistoryContinuity()')
    < extract('prepareOrdinarySubmission').indexOf('planInjection(text, candidate)'));
});
