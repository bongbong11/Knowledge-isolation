import { normalizeCard, validCard } from './core.js';
import { updateVaultStorage, VAULT_CHAT_KEY } from './storage-connection.js';

export const SETTINGS_KEY = 'knowledge-vault';
export const CHAT_KEY = VAULT_CHAT_KEY;

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
  const snapshot = cards.map(normalizeCard).filter(validCard);
  await updateVaultStorage(context,()=>({version:1,cards:snapshot,...(resetAudit ? {auditReceipts:[]} : {})}));
}

export function readActors(context) {
  return Array.isArray(context.chatMetadata?.[CHAT_KEY]?.actors) ? context.chatMetadata[CHAT_KEY].actors : [];
}
export async function writeActors(context, actors) {
  const snapshot = structuredClone(actors);
  await updateVaultStorage(context,()=>({version:1,actors:snapshot}));
}
export async function writeAudit(context, cards, receiptKeys) {
  const snapshot = cards.map(normalizeCard).filter(validCard), keys = [...receiptKeys];
  await updateVaultStorage(context,previous=>({version:1,cards:snapshot,
    auditReceipts:[...new Set([...(previous.auditReceipts || []),...keys])].slice(-120)}));
}
