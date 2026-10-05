import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard, resolveRoute, buildPayload, canSendRaw, cardRevision, selectedCards } from '../vault/core.js';
import { checkPromptReceipt, sameRequestMessages } from '../vault/receipt.js';
import { clampGeometry } from '../vault/popup.js';

test('mobile geometry fills the viewport regardless of old saved size',()=>{
  for(const viewport of [{width:390,height:844},{width:320,height:640},{width:844,height:390},{width:390,height:270}]){
    const rect=clampGeometry({left:10,top:20,width:360,height:280},viewport);
    assert.equal(rect.width,viewport.width-16);assert.equal(rect.height,viewport.height-16);
    assert.equal(rect.left,8);assert.equal(rect.top,8);
  }
});

test('overlapping holders and world truth keep separate access and routing', () => {
  const card = normalizeCard({ id: 'one', title: 'Secret', text: 'Hidden fact', knownBy: ['세계', '유저', 'Mia', 'Mia'] });
  assert.deepEqual(card.knownBy, ['user', 'Mia']);
  assert.equal(card.truthScope, 'world');
  assert.equal(resolveRoute(card), 'shared');
  assert.equal(resolveRoute({ ...card, route: 'npc' }), 'npc');
  assert.equal(resolveRoute({ ...card, route: 'disabled' }), 'disabled');
});

test('unverified or mixed scenes never expose raw secret', () => {
  const card = normalizeCard({ id: 'one', title: 'Secret', text: 'Hidden fact', knownBy: ['user', 'Mia'] });
  assert.equal(canSendRaw(card, { scene_access: 'holders_only', participantsComplete: false, participants: ['user'] }), false);
  assert.equal(canSendRaw(card, { scene_access: 'mixed', participantsComplete: true, participants: ['user', 'Duke'] }), false);
  const masked = buildPayload([card], [{ secret_id: 'one', relevant: true, scene_access: 'mixed' }], [{ secret_id: 'one', inject: true, mode: 'raw_boundary' }]);
  assert.ok(masked.includes('Known only by: {{user}}, Mia.'));
  assert.ok(masked.includes('Unlisted characters and NPCs'));
  assert.ok(!masked.includes('Hidden fact'));
});

test('raw payload requires complete listed participants and explicit mode', () => {
  const card = normalizeCard({ id: 'one', title: 'Secret', text: 'Hidden fact', knownBy: ['user', 'Mia'] });
  const scene = { secret_id: 'one', relevant: true, scene_access: 'holders_only', participantsComplete: true, participants: ['user', 'Mia'] };
  assert.equal(canSendRaw(card, scene), true);
  assert.ok(!buildPayload([card], [scene]).includes('Hidden fact'));
  assert.ok(buildPayload([card], [scene], [{ secret_id: 'one', inject: true, mode: 'raw_boundary' }]).includes('Hidden fact'));
});

test('status card selection matches the registered boundary payload', () => {
  const cards = [
    normalizeCard({ id: 'one', title: 'One', text: 'Fact one', knownBy: ['user'] }),
    normalizeCard({ id: 'two', title: 'Two', text: 'Fact two', knownBy: ['Mia'] }),
    normalizeCard({ id: 'off', title: 'Off', text: 'Fact off', knownBy: ['Mia'], enabled: false }),
  ];
  const scenes = [{ secret_id: 'one', relevant: false }];
  const decisions = [{ secret_id: 'one', inject: false }];
  const selected = selectedCards(cards, scenes, decisions).map(item => item.card.id);
  const payload = buildPayload(cards, scenes, decisions);
  assert.deepEqual(selected, ['two']);
  assert.ok(payload.includes('[ITEM two]'));
  assert.ok(!payload.includes('[ITEM one]'));
  assert.ok(!payload.includes('[ITEM off]'));
});

test('prompt receipt distinguishes registered text from final request content', () => {
  const payload = 'Known only by: {{user}}, {{char}}.';
  const names = { userName: 'Ari', characterName: 'Mia' };
  assert.equal(checkPromptReceipt({ messages: [{ content: 'Known only by: Ari, Mia.' }] }, payload, names), 'confirmed');
  assert.equal(checkPromptReceipt({ messages: [{ content: 'Other instructions' }] }, payload, names), 'missing');
  assert.equal(checkPromptReceipt({ messages: [] }, payload, names), 'unavailable');
});

test('request receipt follows a filtered host array but rejects unrelated requests', () => {
  const system = { role: 'system', content: 'Vault boundary' };
  const user = { role: 'user', content: 'Synthetic input' };
  const original = [system, null, user];
  assert.equal(sameRequestMessages(original, original), true);
  assert.equal(sameRequestMessages(original, original.filter(Boolean)), true);
  assert.equal(sameRequestMessages(original, [{ ...system }, { ...user }]), false);
  assert.equal(sameRequestMessages(original, [user]), false);
  assert.equal(sameRequestMessages(null, []), false);
});

test('future scene-reader cache key changes with active vault facts', () => {
  const card = normalizeCard({ id: 'one', title: 'Code', text: '7314', knownBy: ['Olivia'] });
  assert.equal(cardRevision([card]), cardRevision([{ ...card }]));
  assert.notEqual(cardRevision([card]), cardRevision([{ ...card, text: '7301' }]));
  assert.notEqual(cardRevision([card]), cardRevision([{ ...card, knownBy: ['Duke'] }]));
  assert.equal(cardRevision([{ ...card, enabled: false }]), '[]');
});

test('persona alias and popup geometry remain usable on a small screen', () => {
  assert.deepEqual(normalizeCard({ id: 'one', title: 'Fact', text: 'Secret', knownBy: ['페르소나'] }).knownBy, ['user']);
  const rect = clampGeometry({ left: 900, top: 900, width: 700, height: 540 }, { width: 390, height: 650 });
  assert.ok(rect.width <= 374 && rect.height <= 634);
  assert.ok(rect.left + rect.width <= 382 && rect.top + rect.height <= 642);
});
