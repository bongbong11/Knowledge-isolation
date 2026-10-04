import test from 'node:test';
import assert from 'node:assert/strict';
import {createVaultDiagnostics} from '../vault/diagnostics.js';
import {createVaultAnalysis} from '../vault/analysis-runtime.js';
import {normalizeCard} from '../vault/core.js';
import {readCards} from '../vault/store.js';
function fixture() {
  const text='Mara told Quinn the hidden access phrase. Quinn heard and understood.';
  const ctx={name1:'Mara',name2:'Quinn',chat:[{is_user:false,mes:text}],chatMetadata:{knowledgeVaultV1:{cards:[normalizeCard({id:'private-id',title:'PRIVATE_TITLE',text:'PRIVATE_FACT',knownBy:['Mara']})]}},saveMetadata:async()=>{}};
  const log=createVaultDiagnostics({context:()=>ctx,readCards,isEnabled:()=>true});
  const runtime=createVaultAnalysis({context:()=>ctx,enabled:()=>true,onDiagnostic:log.record});
  const begin=()=>runtime.begin({outputIndex:0,sourceText:text,outputText:text+'<Scene_Info>Date: 2025.01.02</Scene_Info>'});
  const result={vault_results:[{card_id:'private-id',status:'learned',learners:[{actor_id:'character',method:'told',scope:'full',confidence:0.95,evidence:text}]}]};
  return {ctx,log,runtime,begin,result};
}
test('anonymous acquisition diagnostics distinguish validation, durable save and restored history',async()=>{
  const f=fixture();await f.runtime.commit(f.begin().token,f.result);
  const report=f.log.report(), card=report.cards[0];
  assert.equal(card.cardPosition,1);assert.equal(card.savedAcquisitionCount,1);
  assert.equal(card.acquisitions[0].sceneDate,'2025-01-02');assert.equal(card.acquisitions[0].method,'told');
  assert.ok(report.events.find(e=>e.stage==='validation'&&e.status==='learned'));
  assert.ok(report.events.find(e=>e.stage==='storage'&&e.status==='saved'));
  const serialized=JSON.stringify(report);
  for(const secret of ['Mara','Quinn','private-id','PRIVATE_TITLE','PRIVATE_FACT','hidden access phrase'])assert.ok(!serialized.includes(secret),secret);
  const restored=createVaultDiagnostics({context:()=>f.ctx,readCards,isEnabled:()=>false}).report();
  assert.equal(restored.events.length,0);assert.equal(restored.cards[0].savedAcquisitionCount,1);
  assert.equal(restored.enabled,false);
});
test('failed save retains failure without claiming saved data; malformed evidence has a reason',async()=>{
  const f=fixture();f.ctx.saveMetadata=async()=>{throw Error('PRIVATE_STORAGE_ERROR');};
  await assert.rejects(f.runtime.commit(f.begin().token,f.result));
  const report=f.log.report();assert.equal(report.lastFailure.code,'VAULT_STORAGE_FAILED');
  assert.equal(report.cards[0].savedAcquisitionCount,0);assert.ok(!report.events.some(e=>e.status==='saved'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_STORAGE_ERROR'));
  const g=fixture();g.result.vault_results[0].learners[0].evidence='Fabricated evidence outside source.';
  await g.runtime.commit(g.begin().token,g.result);
  assert.equal(g.log.report().lastFailure.reason,'evidence_rejected');
  assert.equal(g.log.report().cards[0].savedAcquisitionCount,0);
});
test('bounded events retain failures, are immutable, and remain scoped to their chat',()=>{
  const f=fixture(), first=f.ctx.chatMetadata;
  f.log.record('audit',{status:'failed',code:'PROFILE_TIMEOUT',error:'PRIVATE_ERROR',text:'PRIVATE_FACT'});
  for(let i=0;i<150;i++)f.log.record('audit',{status:'success'});
  const report=f.log.report();assert.equal(report.events.length,120);assert.equal(report.droppedEvents,31);
  assert.equal(report.lastFailure.code,'PROFILE_TIMEOUT');report.lastFailure.code='changed';
  assert.equal(f.log.report().lastFailure.code,'PROFILE_TIMEOUT');
  f.ctx.chatMetadata={knowledgeVaultV1:{cards:[]}};assert.equal(f.log.report().events.length,0);
  f.ctx.chatMetadata=first;assert.equal(f.log.report().events.length,120);
});
test('diagnostic callback failures cannot alter knowledge saves',async()=>{
  const f=fixture();const runtime=createVaultAnalysis({context:()=>f.ctx,enabled:()=>true,onDiagnostic:()=>{throw Error('broken logger');}});
  const request=runtime.begin({outputIndex:0,sourceText:f.ctx.chat[0].mes,outputText:''});
  assert.equal((await runtime.commit(request.token,f.result)).learnedCount,1);
});
test('late cancelled work cannot attach diagnostic events to another chat',async()=>{
  const f=fixture(), request=f.begin();f.runtime.cancel();
  f.ctx.chatMetadata={knowledgeVaultV1:{cards:[]}};
  assert.equal((await f.runtime.commit(request.token,f.result)).status,'cancelled');
  f.runtime.fail(request.token,'PROFILE_TIMEOUT');
  assert.equal(f.log.report().events.length,0);
});
