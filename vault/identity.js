const FIXED = new Map([
  ['{{char}}', 'character'], ['캐릭터', 'character'], ['character', 'character'],
  ['{{user}}', 'user'], ['유저', 'user'], ['사용자', 'user'], ['페르소나', 'user'], ['user', 'user'],
]);
export const nameKey = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
export function normalizeTag(value) {
  const name = String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
  return FIXED.get(nameKey(name)) || name;
}
export function uniqueTags(values) {
  const tags = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const tag = normalizeTag(value);
    if (tag && !tags.has(nameKey(tag))) tags.set(nameKey(tag), tag);
  }
  return [...tags.values()];
}
export function fingerprint(value) {
  const text = String(value ?? ''); let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${text.length}:${hash >>> 0}`;
}
export const actorId = name => ['user', 'character'].includes(normalizeTag(name)) ? normalizeTag(name) : `npc:${fingerprint(nameKey(name))}`;
export function buildActors(cards, registry = [], { name1 = '', name2 = '', actorNames = [], actorDefinitions = [] } = {}) {
  const actors = new Map();
  const add = (name, aliases = []) => {
    const tag = normalizeTag(name); if (!tag || nameKey(tag) === 'world') return;
    const id = actorId(tag), prior = actors.get(id);
    actors.set(id, { id, name: prior?.name || tag, aliases: uniqueTags([...(prior?.aliases || []), ...aliases]).filter(alias => nameKey(alias) !== nameKey(tag)) });
  };
  add('user', [name1, '{{user}}']); add('character', [name2, '{{char}}']);
  for (const actor of registry) add(actor.name, actor.aliases);
  for (const card of cards) for (const name of card.knownBy) add(name);
  for (const actor of actorDefinitions) {
    const fixed = nameKey(actor.name) === nameKey(name1) ? 'user' : nameKey(actor.name) === nameKey(name2) ? 'character' : actor.name;
    add(fixed, [actor.name, ...(actor.aliases || [])]);
  }
  for (const name of actorNames) if (![nameKey(name1), nameKey(name2)].includes(nameKey(name))) add(name);
  return [...actors.values()];
}
export function resolveActor(value, actors) {
  const id = String(value ?? '');
  const exact = actors.find(actor => actor.id === id); if (exact) return exact;
  const key = nameKey(normalizeTag(value));
  const matches = actors.filter(actor => [actor.name, ...actor.aliases].some(name => nameKey(normalizeTag(name)) === key));
  return matches.length === 1 ? matches[0] : null;
}
