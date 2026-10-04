import { event_types, setExtensionPrompt } from '../../../../script.js';
import { buildPayload, cardRevision, selectedCards } from './vault/core.js';
import { checkPromptReceipt } from './vault/receipt.js';
import { getSettings, readCards } from './vault/store.js';
import { mountVault } from './vault/ui.js';

const PROMPT_KEY = 'knowledge-vault-boundary';
const context = () => SillyTavern.getContext();
let pending = null;
let render = () => {};
let runStatus = { phase: 'idle' };
let registeredPayload = '';
let pendingMessages = null;
function updateRunStatus(status) {
  runStatus = { ...status, at: Date.now() };
  render();
}
function clearReceipt() { registeredPayload = ''; pendingMessages = null; }

function observeAssembly(data, dryRun) {
  if (dryRun || !registeredPayload || runStatus.phase !== 'registered') return;
  const messages = Array.isArray(data?.prompt) ? data.prompt : Array.isArray(data?.messages) ? data.messages : null;
  pendingMessages = messages;
  const current = context();
  const receipt = checkPromptReceipt(data, registeredPayload, { userName: current.name1, characterName: current.name2 });
  updateRunStatus({ ...runStatus, receipt: { phase: 'assembly', status: receipt } });
}

function observeRequest(data) {
  if (!pendingMessages || data?.messages !== pendingMessages || !registeredPayload || runStatus.phase !== 'registered') return;
  pendingMessages = null;
  const current = context();
  const receipt = checkPromptReceipt(data, registeredPayload, { userName: current.name1, characterName: current.name2 });
  updateRunStatus({ ...runStatus, receipt: { phase: 'request', status: receipt } });
}

function createPopup() {
  const backdrop = document.createElement('div');
  backdrop.id = 'kv-backdrop';
  backdrop.hidden = true;
  const panel = document.createElement('div');
  panel.id = 'kv-popup';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '정보금고');
  panel.setAttribute('aria-modal', 'true');
  document.body.append(backdrop, panel);
  const close = () => { backdrop.hidden = true; panel.hidden = true; };
  const open = () => { render(); backdrop.hidden = false; panel.hidden = false; panel.querySelector('button')?.focus(); };
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) close(); });

  const launcher = document.createElement('div');
  launcher.id = 'kv-wand-button';
  launcher.className = 'list-group-item flex-container flexGap5 interactable';
  launcher.setAttribute('role', 'button');
  launcher.setAttribute('tabindex', '0');
  launcher.setAttribute('aria-label', '정보금고 열기');
  launcher.innerHTML = '<span aria-hidden="true">🔐</span><span>정보금고</span>';
  launcher.addEventListener('click', () => panel.hidden ? open() : close());
  launcher.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); panel.hidden ? open() : close(); } });
  const menu = document.getElementById('extensionsMenu');
  if (menu) menu.append(launcher);
  else { launcher.classList.add('kv-launcher-fixed'); document.body.append(launcher); }
  return { panel, close };
}

function activeCards() {
  return getSettings(context()).enabled ? readCards(context()).filter(card => card.enabled && card.route !== 'disabled') : [];
}

// Scene Reader can call these from its existing pre-generation pass. The assessment
// is consumed once; it cannot carry a raw fact into another turn or chat.
globalThis.KnowledgeVaultV1 = Object.freeze({
  version: '0.1.0',
  getRevision: () => getSettings(context()).enabled ? cardRevision(readCards(context())) : '',
  getSceneInput: () => {
    const cards = activeCards();
    updateRunStatus({ phase: 'reading', candidateCount: cards.length });
    return cards.map(card => ({ secret_id: card.id, title: card.title, text: card.text.slice(0, 2000), knownBy: [...card.knownBy], truthScope: card.truthScope, route: card.route }));
  },
  publishSceneResult: ({ knowledge_vault = [], vault_injections = [] } = {}) => {
    pending = { chatMetadata: context().chatMetadata, knowledge_vault, vault_injections };
    updateRunStatus({ phase: 'judged', candidateCount: activeCards().length, sceneResults: knowledge_vault, assessedCount: knowledge_vault.length, relevantCount: knowledge_vault.filter(item => item.relevant).length });
  },
  buildPayload: ({ knowledge_vault = [], vault_injections = [] } = {}) => buildPayload(activeCards(), knowledge_vault, vault_injections),
});

globalThis.KnowledgeVaultBeforeGenerate = async (_chat, _contextSize, _abort, type) => {
  if (type === 'quiet') { clearReceipt(); return; }
  const current = context();
  const result = pending?.chatMetadata === current.chatMetadata ? pending : null;
  pending = null;
  const cards = readCards(current);
  const enabled = getSettings(current).enabled;
  const payload = enabled ? buildPayload(cards, result?.knowledge_vault, result?.vault_injections) : '';
  clearReceipt();
  try {
    await setExtensionPrompt(PROMPT_KEY, payload, 1, 0, false, 0);
    registeredPayload = payload;
    const includedIds = enabled ? selectedCards(cards, result?.knowledge_vault, result?.vault_injections).map(item => item.card.id) : [];
    updateRunStatus({ phase: 'registered', source: result ? 'scene-reader' : 'fallback', assessedCount: result?.knowledge_vault?.length || 0, relevantCount: result?.knowledge_vault?.filter(item => item.relevant).length || 0, sceneResults: result?.knowledge_vault || [], includedIds, enabled });
  } catch (error) {
    updateRunStatus({ phase: 'error', error: String(error?.message || error) });
    throw error;
  }
};

jQuery(() => {
  const current = context();
  const settings = getSettings(current);
  const popup = createPopup();
  render = mountVault({
    host: popup.panel,
    context,
    settings,
    getRunStatus: () => runStatus,
    onClose: popup.close,
    onSettingsChange: () => { context().saveSettingsDebounced(); pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); if (!settings.enabled) setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
    onCardsChange: () => { pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
  });
  current.eventSource.on(event_types.CHAT_CHANGED, () => { pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); });
  if (event_types.GENERATE_AFTER_DATA) current.eventSource.on(event_types.GENERATE_AFTER_DATA, observeAssembly);
  if (event_types.CHAT_COMPLETION_SETTINGS_READY) current.eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, observeRequest);
});
