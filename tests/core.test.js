import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCard, resolveRoute, buildPayload, canSendRaw } from '../vault/core.js';

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
  assert.ok(masked.includes('Everyone not listed above'));
  assert.ok(!masked.includes('Hidden fact'));
});

test('raw payload requires complete listed participants and explicit mode', () => {
  const card = normalizeCard({ id: 'one', title: 'Secret', text: 'Hidden fact', knownBy: ['user', 'Mia'] });
  const scene = { secret_id: 'one', relevant: true, scene_access: 'holders_only', participantsComplete: true, participants: ['user', 'Mia'] };
  assert.equal(canSendRaw(card, scene), true);
  assert.ok(!buildPayload([card], [scene]).includes('Hidden fact'));
  assert.ok(buildPayload([card], [scene], [{ secret_id: 'one', inject: true, mode: 'raw_boundary' }]).includes('Hidden fact'));
});
