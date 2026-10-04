import { event_types, setExtensionPrompt } from '../../../../script.js';
import { buildPayload } from './vault/core.js';
import { getSettings, readCards } from './vault/store.js';
import { mountVault } from './vault/ui.js';

const PROMPT_KEY = 'knowledge-vault-boundary';
const context = () => SillyTavern.getContext();
let pending = null;
let render = () => {};

function activeCards() {
  return getSettings(context()).enabled ? readCards(context()).filter(card => card.enabled && card.route !== 'disabled') : [];
}

// Scene Reader can call these from its existing pre-generation pass. The assessment
// is consumed once; it cannot carry a raw fact into another turn or chat.
globalThis.KnowledgeVaultV1 = Object.freeze({
  version: '0.1.0',
  getSceneInput: () => activeCards().map(card => ({ secret_id: card.id, title: card.title, text: card.text.slice(0, 2000), knownBy: [...card.knownBy], truthScope: card.truthScope, route: card.route })),
  publishSceneResult: ({ knowledge_vault = [], vault_injections = [] } = {}) => {
    pending = { chatMetadata: context().chatMetadata, knowledge_vault, vault_injections };
  },
  buildPayload: ({ knowledge_vault = [], vault_injections = [] } = {}) => buildPayload(activeCards(), knowledge_vault, vault_injections),
});

globalThis.KnowledgeVaultBeforeGenerate = async (_chat, _contextSize, _abort, type) => {
  if (type === 'quiet') return;
  const current = context();
  const result = pending?.chatMetadata === current.chatMetadata ? pending : null;
  pending = null;
  const payload = getSettings(current).enabled ? buildPayload(readCards(current), result?.knowledge_vault, result?.vault_injections) : '';
  await setExtensionPrompt(PROMPT_KEY, payload, 1, 0, false, 0);
};

jQuery(() => {
  const current = context();
  const settings = getSettings(current);
  render = mountVault({
    context,
    settings,
    onSettingsChange: () => { context().saveSettingsDebounced(); if (!settings.enabled) setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
    onCardsChange: () => { pending = null; setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
  });
  current.eventSource.on(event_types.CHAT_CHANGED, () => { pending = null; setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); render(); });
});
