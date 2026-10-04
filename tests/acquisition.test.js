import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard, buildPayload, PAYLOAD_LIMIT } from '../vault/core.js';
import { actorId, buildActors, resolveActor } from '../vault/identity.js';
import { outputIdentity, sceneDate, validateAcquisitions, reconcileCards, applyAcquisitions } from '../vault/acquisition.js';
import { createVaultAnalysis } from '../vault/analysis-runtime.js';
const fact = 'The cellar has a second exit.';
function fixture() {
  const output = 'Dominic told Mia that the cellar has a second exit. Mia heard and understood him.\n<Scene_Info><small>Date: 2025.04.25 (Friday)</small></Scene_Info>';
  const ctx = { name1:'Ari', name2:'Mia', chat:[{is_user:true,mes:'I ask about the cellar.'},{is_user:false,mes:output}],
    chatMetadata:{knowledgeVaultV1:{version:1,cards:[normalizeCard({id:'one',title:'Exit',text:fact,knownBy:['Dominic']})],actors:[{name:'Dominic',aliases:['Dom','도미닉']}] }}, saveMetadata:async()=>{} };
  let enabled = true; const states=[];
  const runtime = createVaultAnalysis({context:()=>ctx,enabled:()=>enabled,onStatus:state=>states.push(state)});
  const begin = () => runtime.begin({outputIndex:1,sourceText:output,outputText:output});
  const result = {vault_results:[{card_id:'one',status:'learned',learners:[{actor_id:'character',method:'told',scope:'full',confidence:0.95,evidence:'Dominic told Mia that the cellar has a second exit. Mia heard and understood him.'}]}]};
  return {ctx,runtime,begin,result,states,disable:()=>{enabled=false;runtime.cancel();}};
}
test('case variants share identity, registered aliases resolve, collisions do not', () => {
  const card=normalizeCard({title:'Fact',text:fact,knownBy:['Dominic','DOMINIC','dominic']});
  assert.equal(card.knownBy.length,1);
  assert.equal(actorId('  DOMINIC '),actorId('Dominic'));
  const actors=buildActors([card],[{name:'Dominic',aliases:['Dom','도미닉']},{name:'Dorian',aliases:['Dom']}],{name1:'Ari',name2:'Mia'});
  assert.equal(resolveActor('도미닉',actors).name,'Dominic');
  assert.equal(resolveActor('Dom',actors),null);
  assert.equal(resolveActor('she',actors),null);
  assert.equal(resolveActor('Mia',actors).id,'character');
});
test('scene date comes only from valid dated info blocks', () => {
  assert.equal(sceneDate('Date: 2025.04.25'),null);
  assert.equal(sceneDate('<Scene_Info>Date: 2025.02.30</Scene_Info>'),null);
  assert.equal(sceneDate('<Scene_Info>Date: 2025.04.25</Scene_Info>'),'2025-04-25');
  assert.equal(sceneDate('<Scene_Info>Date: 2025.04.25</Scene_Info><Scene_Info>Date: 2025.04.26</Scene_Info>'),'2025-04-26');
});
test('full knowledge adds a derived tag and history once, then persists deduplication', async () => {
  const f=fixture(), request=f.begin();
  const result=await f.runtime.commit(request.token,f.result);
  assert.equal(result.learnedCount,1);
  const card=f.ctx.chatMetadata.knowledgeVaultV1.cards[0];
  assert.deepEqual(card.knownBy,['Dominic','character']);
  assert.deepEqual(card.manualKnownBy,['Dominic']);
  assert.equal(card.text,fact); assert.equal(card.acquisitions[0].date,'2025-04-25');
  assert.equal(f.begin(),null,'same output cannot be audited twice');
  const restored=createVaultAnalysis({context:()=>f.ctx,enabled:()=>true});
  assert.equal(restored.begin({outputIndex:1,sourceText:f.ctx.chat[1].mes,outputText:f.ctx.chat[1].mes}),null,'dedup survives reload');
});
test('partial, ambiguous, missing and fabricated evidence never grant a whole fact', async () => {
  for(const mode of ['partial','uncertain','missing','fabricated','low_confidence']) {
    const f=fixture(), request=f.begin(); const result=structuredClone(f.result);
    if(mode==='partial'){result.vault_results[0].status='partial';result.vault_results[0].learners[0].scope='partial';}
    if(mode==='uncertain')result.vault_results[0].status='uncertain';
    if(mode==='missing')result.vault_results=[];
    if(mode==='fabricated')result.vault_results[0].learners[0].evidence='Mia read a secret letter in another room.';
    if(mode==='low_confidence')result.vault_results[0].learners[0].confidence=0.5;
    const outcome=await f.runtime.commit(request.token,result);
    assert.deepEqual(f.ctx.chatMetadata.knowledgeVaultV1.cards[0].knownBy,['Dominic'],mode);
    if(mode!=='partial')assert.equal(outcome.status,'partial',mode);
  }
});
test('name resolution needs explicit evidence for a newly named learner', () => {
  const f=fixture(), card=f.ctx.chatMetadata.knowledgeVaultV1.cards[0];
  const source='Dominic told Elliot Hayes about the second cellar exit. Elliot Hayes understood.';
  const request={cards:[card],actors:buildActors([card]),identity:outputIdentity(f.ctx.chat,1),sourceText:source,date:null};
  const raw={vault_results:[{card_id:'one',status:'learned',learners:[{actor_name:'Elliot Hayes',method:'told',scope:'full',confidence:0.9,evidence:source}]}]};
  assert.equal(validateAcquisitions(raw,request).changes[0].actorName,'Elliot Hayes');
  raw.vault_results[0].learners[0].actor_name='he';
  assert.equal(validateAcquisitions(raw,request).changes.length,0);
});
test('swipe, edit, earlier user edit and deletion retract only derived tags', async () => {
  for (const mode of ['swipe','edit','user_edit','delete']) {
    const f=fixture(), request=f.begin(); await f.runtime.commit(request.token,f.result);
    if(mode==='delete')f.ctx.chat.splice(1,1);
    else if(mode==='user_edit')f.ctx.chat[0].mes='A different scene.';
    else f.ctx.chat[1].mes='Mia leaves without hearing the secret.';
    await f.runtime.reconcile();
    assert.deepEqual(f.ctx.chatMetadata.knowledgeVaultV1.cards[0].knownBy,['Dominic']);
  }
});
test('another valid acquisition keeps its tag and manual holders are never retracted', () => {
  const f=fixture(), card=f.ctx.chatMetadata.knowledgeVaultV1.cards[0];
  f.ctx.chat.push({is_user:false,mes:'Mia reads the exit plan.'});
  const records=[{cardId:'one',id:'first',actorName:'character',scope:'full',sourceIdentity:outputIdentity(f.ctx.chat,1)},
    {cardId:'one',id:'second',actorName:'character',scope:'full',sourceIdentity:outputIdentity(f.ctx.chat,2)}];
  const changed=applyAcquisitions([card],records);
  f.ctx.chat.pop();
  assert.deepEqual(reconcileCards(changed,f.ctx.chat)[0].knownBy,['Dominic','character']);
});

test('returning to an earlier swipe can restore its evidence through a fresh audit', async () => {
  const f=fixture(), original=f.ctx.chat[1].mes;
  await f.runtime.commit(f.begin().token,f.result);
  f.ctx.chat[1].mes='Mia leaves without hearing anything.';
  await f.runtime.reconcile();
  f.ctx.chat[1].mes=original;
  await f.runtime.reconcile();
  const retry=f.begin();
  assert.ok(retry,'retracted evidence must not stay marked as already saved');
  await f.runtime.commit(retry.token,f.result);
  assert.deepEqual(f.ctx.chatMetadata.knowledgeVaultV1.cards[0].knownBy,['Dominic','character']);
  assert.equal(f.ctx.chatMetadata.knowledgeVaultV1.cards[0].acquisitions.length,1);
});
test('disable, chat switch, source edits, cancelled leases and save failure cannot apply late data', async () => {
  for(const mode of ['off','chat','source','cancel','storage']) {
    const f=fixture(), request=f.begin(), old=f.ctx.chatMetadata;
    if(mode==='off')f.disable();
    if(mode==='chat')f.ctx.chatMetadata={knowledgeVaultV1:{cards:[]}};
    if(mode==='source')f.ctx.chat[1].mes='Nothing was disclosed.';
    if(mode==='cancel')f.runtime.abandon(request.token);
    if(mode==='storage')f.ctx.saveMetadata=async()=>{throw Error('disk unavailable');};
    if(mode==='storage')await assert.rejects(f.runtime.commit(request.token,f.result));
    else assert.equal((await f.runtime.commit(request.token,f.result)).status,'cancelled');
    assert.deepEqual(old.knowledgeVaultV1.cards[0].knownBy,['Dominic']);
  }
});
test('missing output cards get one bounded repair; uncertainty is not retry bait', () => {
  const f=fixture(), request=f.begin();
  const repair=f.runtime.repair(request.token,{vault_results:[]});
  assert.deepEqual(repair.cardIds,['one']);
  assert.equal(f.runtime.repair(request.token,{vault_results:[]}),null);
  const g=fixture(), next=g.begin();
  assert.equal(g.runtime.repair(next.token,{vault_results:[{card_id:'one',status:'uncertain',learners:[]}]}),null);
});
test('scoped fact is actionable while shared rules occur once and payload stays bounded', () => {
  const cards=Array.from({length:20},(_,i)=>normalizeCard({id:'id-'+i,title:'Exit',text:'\\'.repeat(2000),knownBy:['character']}));
  const choices=cards.map(card=>({secret_id:card.id,inject:true,mode:'scoped_fact'}));
  const payload=buildPayload(cards,[],choices);
  assert.ok(payload.length<=PAYLOAD_LIMIT);
  assert.equal(payload.split('These are author-level reference facts').length-1,1);
  assert.ok(payload.includes('Knowing a fact does not mean knowing who else knows'));
  assert.ok(payload.includes('Fact data:'));
});

test('truncated source stays partially unconfirmed even when every returned card is valid', async () => {
  const f=fixture();
  const request=f.runtime.begin({outputIndex:1,sourceText:f.ctx.chat[1].mes,outputText:f.ctx.chat[1].mes,sourceTruncated:true});
  const outcome=await f.runtime.commit(request.token,f.result);
  assert.equal(outcome.status,'partial'); assert.equal(outcome.unresolvedCount,1);
});

test('preferred cards cannot permanently starve other enabled cards', async () => {
  const f=fixture();
  f.ctx.chatMetadata.knowledgeVaultV1.cards=Array.from({length:24},(_,i)=>normalizeCard({id:'card-'+i,title:'Fact '+i,text:fact,knownBy:['Dominic']}));
  const seen=new Set();
  for(let i=0;i<6;i++) {
    f.ctx.chat.push({is_user:false,mes:'Completed output '+i});
    const request=f.runtime.begin({outputIndex:f.ctx.chat.length-1,sourceText:'Completed output '+i,outputText:'Completed output '+i,
      preferredIds:Array.from({length:12},(_,n)=>'card-'+n)});
    request.input.cards.forEach(card=>seen.add(card.id));
    const outcome=await f.runtime.commit(request.token,{vault_results:request.input.cards.map(card=>({card_id:card.id,status:'no_change',learners:[]}))});
    assert.equal(outcome.status,'partial'); assert.equal(outcome.unresolvedCount,12);
  }
  assert.equal(seen.size,24);
});
