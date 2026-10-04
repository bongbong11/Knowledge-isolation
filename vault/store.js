import { normalizeCard, validCard } from './core.js';

export const SETTINGS_KEY = 'knowledge-vault';
export const CHAT_KEY = 'knowledgeVaultV1';

export function getSettings(context) {
  const current = context.extensionSettings[SETTINGS_KEY];
  if (!current || current.version !== 1) context.extensionSettings[SETTINGS_KEY] = { version: 1, enabled: true };
  return context.extensionSettings[SETTINGS_KEY];
}

export function readCards(context) {
  const data = context.chatMetadata?.[CHAT_KEY];
  return Array.isArray(data?.cards) ? data.cards.map(normalizeCard).filter(validCard) : [];
}

export async function writeCards(context, cards) {
  if (!context.chatMetadata || typeof context.saveMetadata !== 'function') throw new Error('Open a chat before editing the vault.');
  context.chatMetadata[CHAT_KEY] = { version: 1, cards: cards.map(normalizeCard).filter(validCard) };
  await context.saveMetadata();
}
