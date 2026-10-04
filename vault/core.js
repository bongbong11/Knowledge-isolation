export const ROUTES = ['auto', 'world', 'user', 'character', 'npc', 'shared', 'disabled'];

const RESERVED = new Map([
  ['유저', 'user'], ['사용자', 'user'], ['{{user}}', 'user'],
  ['캐릭터', 'character'], ['{{char}}', 'character'],
  ['세계', 'world'], ['world', 'world'],
]);

export function normalizeHolder(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name) return '';
  return RESERVED.get(name.toLowerCase()) || name;
}

export function normalizeCard(value = {}) {
  const raw = Array.isArray(value.knownBy) ? value.knownBy : [];
  const holders = [...new Set(raw.map(normalizeHolder).filter(Boolean))];
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
  };
}

export function validCard(card) {
  return Boolean(card.title && card.text && (card.knownBy.length || card.truthScope === 'world'));
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
    .map(({ id, title, text, knownBy, truthScope, route }) => ({ id, title, text, knownBy, truthScope, route })));
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

const HEADER = `[INFORMATION VAULT — HARD KNOWLEDGE BOUNDARY]
Each restricted item is known ONLY by its listed holders. Everyone else, including every unlisted character, NPC, and viewpoint, does not know it. Author-level context is not character knowledge.
Non-holders must not speak, think, remember, recognize, correctly guess, explain, anticipate, or act on a restricted fact. They may notice only observable clues and uncertainty. A holder list changes only when the user edits the card.`;

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

export function buildPayload(cards, sceneResults = [], decisions = []) {
  const sections = new Map();
  for (const { card, route, scene, choice } of selectedCards(cards, sceneResults, decisions)) {
    const rawAllowed = choice?.mode === 'raw_boundary' && canSendRaw(card, scene);
    const holders = card.knownBy.map(displayHolder);
    const known = holders.length ? holders.join(', ') : 'no character';
    const lines = [
      `[ITEM ${card.id}]`,
      card.truthScope === 'world' ? 'This is a world truth; world truth does not grant character knowledge.' : 'This is a restricted fact.',
      `Known only by: ${known}.`,
      'Everyone not listed above, including all unlisted NPCs and viewpoints, does not know this item.',
      'Non-holders must not state, recall, correctly identify, or act on it without explicit in-scene disclosure or conclusive observable evidence.',
    ];
    if (rawAllowed) lines.push(`Restricted fact: ${card.text}`);
    else lines.push('The restricted fact is withheld from this generation. Do not invent its content.');
    if (!sections.has(route)) sections.set(route, []);
    sections.get(route).push(lines.join('\n'));
  }
  if (!sections.size) return '';
  return [HEADER, ...Object.entries(SECTION).filter(([route]) => sections.has(route)).map(([route, title]) => `[${title}]\n${sections.get(route).join('\n\n')}`)].join('\n\n');
}
