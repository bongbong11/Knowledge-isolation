import { normalizeTag, uniqueTags } from './identity.js';
import { WORLD_FACT_RULES } from './knowledge-scope.js';
import { KNOWLEDGE_BOUNDARY, KNOWLEDGE_OUTPUT_CHECK } from './knowledge-boundary.js';
export const ROUTES = ['auto', 'world', 'user', 'character', 'npc', 'shared', 'disabled'];

const RESERVED = new Map([
  ['유저', 'user'], ['사용자', 'user'], ['페르소나', 'user'], ['{{user}}', 'user'],
  ['캐릭터', 'character'], ['{{char}}', 'character'],
  ['세계', 'world'], ['world', 'world'],
]);

export function normalizeHolder(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  return RESERVED.get(name.toLowerCase()) || normalizeTag(name);
}

export function normalizeCard(value = {}) {
  const raw = Array.isArray(value.knownBy) ? value.knownBy : [];
  const holders = uniqueTags(raw.map(normalizeHolder).filter(Boolean));
  const truthScope = value.truthScope === 'world' || holders.includes('world') ? 'world' : 'private';
  const id = String(value.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80)
    || globalThis.crypto?.randomUUID?.() || `vault-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id,
    title: String(value.title ?? '').trim(),
    text: String(value.text ?? '').trim(),
    knownBy: holders.filter(name => name !== 'world'),
    truthScope,
    route: ROUTES.includes(value.route) ? value.route : 'auto',
    enabled: value.enabled !== false,
    public: value.public === true,
    manualKnownBy: uniqueTags(Array.isArray(value.manualKnownBy) ? value.manualKnownBy : holders.filter(name => name !== 'world')),
    acquisitions: Array.isArray(value.acquisitions) ? value.acquisitions.filter(item => item && typeof item === 'object') : [],
  };
}

export function validCard(card) {
  return Boolean(card.title && card.text && (card.knownBy.length || card.truthScope === 'world' || card.public));
}

export function resolveRoute(card) {
  if (!card.enabled || card.route === 'disabled') return 'disabled';
  if (card.route !== 'auto') return card.route;
  if (card.truthScope === 'world' && !card.knownBy.length) return 'world';
  if (card.truthScope === 'world' || card.knownBy.length > 1) return 'shared';
  if (card.knownBy[0] === 'user') return 'user';
  if (card.knownBy[0] === 'character') return 'character';
  return 'npc';
}

export function displayHolder(holder) {
  return holder === 'user' ? '{{user}}' : holder === 'character' ? '{{char}}' : holder;
}

// Optional cache key for sibling extensions. It carries no authority to edit cards.
export function cardRevision(cards) {
  return JSON.stringify((Array.isArray(cards) ? cards : []).map(normalizeCard).filter(validCard)
    .filter(card => card.enabled && card.route !== 'disabled')
    .map(({ id, title, text, knownBy, truthScope, route, public: isPublic }) => ({ id, title, text, knownBy, truthScope, route, public: isPublic })));
}

// A route selects a prompt section; it never grants anyone access to the fact.
export function canSendRaw(card, scene) {
  if (!scene || scene.scene_access !== 'holders_only' || scene.participantsComplete !== true) return false;
  if (!Array.isArray(scene.participants) || !scene.participants.length) return false;
  const holders = new Set(card.knownBy.map(name => name.toLocaleLowerCase()));
  return scene.participants.every(name => holders.has(normalizeHolder(name).toLocaleLowerCase()));
}

const SECTION = {
  world: 'WORLD TRUTH', user: 'USER KNOWLEDGE', character: 'CHARACTER KNOWLEDGE',
  npc: 'NPC KNOWLEDGE', shared: 'SHARED RESTRICTED KNOWLEDGE',
};

export function selectedCards(cards, sceneResults = [], decisions = []) {
  const scenes = new Map((Array.isArray(sceneResults) ? sceneResults : []).filter(x => x?.secret_id).map(x => [String(x.secret_id), x]));
  const choices = new Map((Array.isArray(decisions) ? decisions : []).filter(x => x?.secret_id).map(x => [String(x.secret_id), x]));
  const selected = [];
  for (const raw of Array.isArray(cards) ? cards : []) {
    const card = normalizeCard(raw);
    if (!validCard(card)) continue;
    const choice = choices.get(card.id);
    if (choice?.inject === false) continue;
    const route = resolveRoute(card);
    if (route === 'disabled') continue;
    const scene = scenes.get(card.id);
    if (scene?.relevant === false) continue;
    selected.push({ card, route, scene, choice });
  }
  return selected;
}

export const PAYLOAD_LIMIT = 10000;
export function payloadSelection(cards, sceneResults = [], decisions = []) {
  const selected = [], omitted = [];
  for (const item of selectedCards(cards, sceneResults, decisions)) {
    if (selected.length >= 12 || renderPayload([...selected, item]).length > PAYLOAD_LIMIT) omitted.push(item.card.id);
    else selected.push(item);
  }
  return { selected, omitted };
}
function renderPayload(selected) {
  const sections = new Map();
  let worldReality = false;
  for (const { card, route, scene, choice } of selected) {
    const rawAllowed = choice?.mode === 'scoped_fact' || (choice?.mode === 'raw_boundary' && canSendRaw(card, scene));
    if (rawAllowed && card.truthScope === 'world' && !card.public) worldReality = true;
    const holders = card.knownBy.map(displayHolder);
    const known = holders.length ? holders.join(', ') : 'no character';
    const lines = [
      `[ITEM ${card.id}]`,
      card.public ? 'Access: public background fact; use only where plausible.' : `Known only by: ${known}.`,
    ];
    if (card.truthScope === 'world' && !card.public) lines.push('Reality: objective world fact, not public knowledge.');
    if (rawAllowed) lines.push(`Fact data: ${JSON.stringify(card.text)}`);
    else lines.push('The restricted fact is withheld from this generation. Do not invent its content.');
    if (!sections.has(route)) sections.set(route, []);
    sections.get(route).push(lines.join('\n'));
  }
  if (!sections.size) return '';
  return [KNOWLEDGE_BOUNDARY, ...(worldReality ? [WORLD_FACT_RULES] : []), ...Object.entries(SECTION).filter(([route]) => sections.has(route)).map(([route, title]) => `[${title}]\n${sections.get(route).join('\n\n')}`), KNOWLEDGE_OUTPUT_CHECK].join('\n\n');
}
export function buildPayload(cards, sceneResults = [], decisions = []) {
  return renderPayload(payloadSelection(cards, sceneResults, decisions).selected);
}
