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

export async function writeCards(context, cards, { resetAudit = false } = {}) {
  if (!context.chatMetadata || typeof context.saveMetadata !== 'function') throw new Error('Open a chat before editing the vault.');
  const previous = context.chatMetadata[CHAT_KEY];
  const next = { ...previous, version: 1, cards: cards.map(normalizeCard).filter(validCard), ...(resetAudit ? {auditReceipts:[]} : {}) };
  context.chatMetadata[CHAT_KEY] = next;
  try { await context.saveMetadata(); }
  catch (error) { if (context.chatMetadata[CHAT_KEY] === next) context.chatMetadata[CHAT_KEY] = previous; throw error; }
}

export function readActors(context) {
  return Array.isArray(context.chatMetadata?.[CHAT_KEY]?.actors) ? context.chatMetadata[CHAT_KEY].actors : [];
}
export async function writeActors(context, actors) {
  if (!context.chatMetadata || typeof context.saveMetadata !== 'function') throw new Error('채팅을 먼저 열어 주세요.');
  const previous = context.chatMetadata[CHAT_KEY];
  const next = { ...previous, version: 1, actors };
  context.chatMetadata[CHAT_KEY] = next;
  try { await context.saveMetadata(); }
  catch (error) { if (context.chatMetadata[CHAT_KEY] === next) context.chatMetadata[CHAT_KEY] = previous; throw error; }
}
export async function writeAudit(context, cards, receiptKeys) {
  if (!context.chatMetadata || typeof context.saveMetadata !== 'function') throw new Error('채팅을 먼저 열어 주세요.');
  const previous = context.chatMetadata[CHAT_KEY];
  const next = { ...previous, version: 1, cards: cards.map(normalizeCard).filter(validCard),
    auditReceipts: [...new Set([...(previous?.auditReceipts || []), ...receiptKeys])].slice(-120) };
  context.chatMetadata[CHAT_KEY] = next;
  try { await context.saveMetadata(); }
  catch (error) { if (context.chatMetadata[CHAT_KEY] === next) context.chatMetadata[CHAT_KEY] = previous; throw error; }
}
