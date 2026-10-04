import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard, validCard, buildPayload, PAYLOAD_LIMIT, cardRevision } from '../vault/core.js';
import { knowledgeScope, knowledgeScopeFields, knowledgeScopeSummary } from '../vault/knowledge-scope.js';
import { createVaultAnalysis } from '../vault/analysis-runtime.js';

const hiddenFact=()=>normalizeCard({id:'world-one',title:'Bridge structure',text:'The old bridge has a hidden support tunnel.',knownBy:[],truthScope:'world'});

test('unknown world facts stay distinct from public knowledge and survive legacy normalization',()=>{
  const card=hiddenFact();
  assert.equal(validCard(card),true); assert.equal(card.public,false);
  assert.equal(knowledgeScope(card),'world');
  assert.match(knowledgeScopeSummary(card),/아직 아무도 모름/);
  assert.deepEqual(normalizeCard(JSON.parse(JSON.stringify(card))),card);
  for(const mode of ['private','world','public'])assert.equal(knowledgeScope({...card,...knowledgeScopeFields(mode)}),mode);
  assert.equal(validCard({...card,...knowledgeScopeFields('private')}),false);
  assert.notEqual(cardRevision([card]),cardRevision([{...card,public:true}]));
});

test('relevant world facts can shape events without granting knowledge or forcing discovery',()=>{
  const card=hiddenFact(), decisions=[{secret_id:card.id,inject:true,mode:'scoped_fact'}];
  const prompt=buildPayload([card],[],decisions);
  assert.ok(prompt.includes(card.text));
  assert.match(prompt,/Known only by: no character/);
  assert.match(prompt,/ordinary continuation and permitted events/);
  assert.match(prompt,/speech, thoughts, plans, targeted questions, or actions/);
  assert.match(prompt,/not an order to create an incident/);
  assert.match(prompt,/A possible outcome is not an inevitable outcome/);
  assert.ok(!buildPayload([card]).includes(card.text),'unjudged fallback keeps the actual fact masked');
  assert.equal(buildPayload([card],[],[{...decisions[0],inject:false}]),'');
  assert.equal(buildPayload([{...card,enabled:false}],[],decisions),'');
  assert.ok(!buildPayload([{...card,public:true}],[],decisions).includes('[WORLD REALITY'));
});

test('world rules occur once and actual rendered payload stays within the limit',()=>{
  const cards=Array.from({length:20},(_,i)=>({...hiddenFact(),id:'world-'+i,text:'\\"'.repeat(500)}));
  const prompt=buildPayload(cards,[],cards.map(card=>({secret_id:card.id,mode:'scoped_fact',inject:true})));
  assert.equal(prompt.split('[WORLD REALITY').length-1,1);
  assert.ok(prompt.length<=PAYLOAD_LIMIT);
});

test('unheld world fact can gain its first learner and roll back to nobody knowing',async()=>{
  const ctx={name1:'Ari',name2:'Mia',chat:[{is_user:false,mes:'Mia reads the engineer report and learns that the old bridge has a hidden support tunnel.'}],
    chatMetadata:{knowledgeVaultV1:{version:1,cards:[hiddenFact()]}},saveMetadata:async()=>{}};
  const runtime=createVaultAnalysis({context:()=>ctx,enabled:()=>true});
  const request=runtime.begin({outputIndex:0,sourceText:ctx.chat[0].mes,outputText:ctx.chat[0].mes});
  assert.equal(request.input.cards[0].truthScope,'world');
  assert.deepEqual(request.input.cards[0].known_actor_ids,[]);
  await runtime.commit(request.token,{vault_results:[{card_id:'world-one',status:'learned',learners:[{actor_id:'character',method:'read',scope:'full',confidence:0.95,evidence:ctx.chat[0].mes}]}]});
  const learned=ctx.chatMetadata.knowledgeVaultV1.cards[0];
  assert.deepEqual(learned.knownBy,['character']); assert.equal(learned.public,false); assert.equal(learned.truthScope,'world');
  ctx.chat[0].mes='Mia walks over the old bridge without examining it.';
  await runtime.reconcile();
  assert.equal(ctx.chatMetadata.knowledgeVaultV1.cards.length,1);
  assert.deepEqual(ctx.chatMetadata.knowledgeVaultV1.cards[0].knownBy,[]);
  const next=runtime.begin({outputIndex:0,sourceText:ctx.chat[0].mes,outputText:ctx.chat[0].mes});
  await runtime.commit(next.token,{vault_results:[{card_id:'world-one',status:'no_change',learners:[]}]});
  assert.deepEqual(ctx.chatMetadata.knowledgeVaultV1.cards[0].knownBy,[]);
});
