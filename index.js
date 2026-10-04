import { event_types, setExtensionPrompt } from '../../../../script.js';
import { buildPayload, cardRevision, payloadSelection } from './vault/core.js';
import { createVaultAnalysis } from './vault/analysis-runtime.js';
import { checkPromptReceipt, sameRequestMessages } from './vault/receipt.js';
import { createPopup } from './vault/popup.js';
import { getSettings, readActors, readCards } from './vault/store.js';
import { nameKey } from './vault/identity.js';
import { isRpTurn } from './vault/turn.js';
import { canUseVault } from './vault/access.js';
import { mountVaultLauncher } from './vault/launcher.js';
import { mountVault } from './vault/ui.js';
import { hydrateVaultStorage, vaultStorageState } from './vault/storage-connection.js';
import { createVaultDiagnostics } from './vault/diagnostics.js';

const PROMPT_KEY = 'knowledge-vault-boundary';
const context = () => SillyTavern.getContext();
let pending = null;
let render = () => {};
let popup = null;
let runStatus = { phase: 'idle' };
let registeredPayload = '';
let pendingMessages = null;
let analysisStatus = { phase: 'idle' };
let auditAllowed = true;
let selectionCursor = 0;
const diagnostics = createVaultDiagnostics({context,readCards,isEnabled:()=>canUseVault() && getSettings(context()).enabled});
const analysis = createVaultAnalysis({ context, enabled: () => canUseVault() && auditAllowed && getSettings(context()).enabled && vaultStorageState(context()).status === 'ready',
  onDiagnostic:diagnostics.record,
  onStatus: status => { analysisStatus = status; if (status.phase==='capacity') diagnostics.record('audit',status); render(); } });
function updateRunStatus(status) {
  runStatus = { ...status, at: Date.now() };
  diagnostics.record(['reading','judged'].includes(status.phase)?'selection':'injection',status);
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
  if (!sameRequestMessages(pendingMessages, data?.messages) || !registeredPayload || runStatus.phase !== 'registered') return;
  pendingMessages = null;
  const current = context();
  const receipt = checkPromptReceipt(data, registeredPayload, { userName: current.name1, characterName: current.name2 });
  updateRunStatus({ ...runStatus, receipt: { phase: 'request', status: receipt } });
}

function activeCards() {
  return canUseVault() && getSettings(context()).enabled && vaultStorageState(context()).status === 'ready' ? readCards(context()).filter(card => card.enabled && card.route !== 'disabled') : [];
}
function activeRevision() {
  const cards = activeCards();
  return cards.length ? cardRevision(cards) + JSON.stringify(readActors(context())) : '';
}

// Scene Reader can call these from its existing pre-generation pass. The assessment
// is consumed once; it cannot carry a raw fact into another turn or chat.
globalThis.KnowledgeVaultV1 = Object.freeze({
  version: '0.1.0',
  diagnostics: diagnostics.report,
  isEnabled: () => canUseVault() && getSettings(context()).enabled,
  open: () => canUseVault() && popup?.open() === true,
  refreshAccess: () => {
    if (canUseVault()) return;
    analysis.cancel(); pending = null; clearReceipt(); popup?.close();
    setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0);
  },
  getRevision: activeRevision,
  getSceneInput: () => {
    const cards = activeCards();
    if (!cards.length) return [];
    const ordered = [...cards.slice(selectionCursor), ...cards.slice(0, selectionCursor)];
    selectionCursor = (selectionCursor + 12) % cards.length;
    const selected = ordered.slice(0, 12);
    updateRunStatus({ phase: 'reading', candidateCount: selected.length, unassessedCount: cards.length - selected.length });
    return selected.map(card => ({ secret_id: card.id, title: card.title, text: card.text.slice(0, 2000), knownBy: [...card.knownBy], truthScope: card.truthScope, public:card.public, route: card.route,
      holderAliases: readActors(context()).filter(actor => card.knownBy.some(name=>nameKey(name)===nameKey(actor.name))).map(actor=>({name:actor.name,aliases:actor.aliases.slice(0,10)})) }));
  },
  publishSceneResult: ({ knowledge_vault = [], vault_injections = [] } = {}) => {
    pending = { chatMetadata: context().chatMetadata, revision: activeRevision(), knowledge_vault, vault_injections };
    updateRunStatus({ phase: 'judged', candidateCount: activeCards().length, sceneResults: knowledge_vault, assessedCount: knowledge_vault.length, relevantCount: knowledge_vault.filter(item => item.relevant).length });
  },
  buildPayload: ({ knowledge_vault = [], vault_injections = [] } = {}) => buildPayload(activeCards(), knowledge_vault, vault_injections),
  beginAnalysis: input => analysis.begin({ ...input, preferredIds: runStatus.includedIds || [] }),
  analysisCurrent: analysis.isCurrent,
  repairAnalysis: analysis.repair,
  commitAnalysis: analysis.commit,
  failAnalysis: analysis.fail,
  abandonAnalysis: analysis.abandon,
});

globalThis.KnowledgeVaultBeforeGenerate = async (_chat, _contextSize, _abort, type) => {
  auditAllowed = isRpTurn(context(), type, document.getElementById('send_textarea')?.value || '');
  if (!auditAllowed) { pending = null; clearReceipt(); await setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); updateRunStatus({phase:'skipped'}); return; }
  const current = context();
  if (canUseVault() && getSettings(current).enabled) {
    if (vaultStorageState(current).status === 'failed') {
      pending = null; clearReceipt(); await setExtensionPrompt(PROMPT_KEY,'',1,0,false,0);
      updateRunStatus({phase:'error',error:'금고 저장소 연결 실패 · 금고에서 저장 연결을 재시도해 주세요.'}); return;
    }
    try { await hydrateVaultStorage(current); }
    catch { pending = null; clearReceipt(); await setExtensionPrompt(PROMPT_KEY,'',1,0,false,0); updateRunStatus({phase:'error',error:'금고 저장소 연결 실패 · 기존 데이터 유지'}); return; }
  }
  const result = pending?.chatMetadata === current.chatMetadata && pending.revision === activeRevision() ? pending : null;
  pending = null;
  const cards = readCards(current);
  const enabled = canUseVault() && getSettings(current).enabled;
  const payload = enabled ? buildPayload(cards, result?.knowledge_vault, result?.vault_injections) : '';
  clearReceipt();
  try {
    await setExtensionPrompt(PROMPT_KEY, payload, 1, 0, false, 0);
    registeredPayload = payload;
    const selection = enabled ? payloadSelection(cards, result?.knowledge_vault, result?.vault_injections) : {selected:[],omitted:[]};
    const includedIds = enabled ? selection.selected.map(item => item.card.id) : [];
    updateRunStatus({ phase: 'registered', source: result ? 'scene-reader' : 'fallback', assessedCount: result?.knowledge_vault?.length || 0, relevantCount: result?.knowledge_vault?.filter(item => item.relevant).length || 0, sceneResults: result?.knowledge_vault || [], includedIds, omittedCount: selection.omitted.length, enabled });
  } catch (error) {
    updateRunStatus({ phase: 'error', error: String(error?.message || error) });
    throw error;
  }
};

jQuery(() => {
  const current = context();
  const settings = getSettings(current);
  popup = createPopup({ render: () => render(), canOpen: canUseVault });
  mountVaultLauncher();
  render = mountVault({
    host: popup.panel,
    context,
    settings,
    getRunStatus: () => ({ ...runStatus, analysis: analysisStatus, storage:vaultStorageState(context()) }),
    onStorageRetry: () => loadAndReconcile(),
    onClose: popup.close,
    onSettingsChange: () => { analysis.cancel(); analysisStatus = { phase: settings.enabled ? 'idle' : 'disabled' }; context().saveSettingsDebounced(); pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); if (!settings.enabled) setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
    onCardsChange: () => { analysis.cancel(); pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); },
  });
  const loadAndReconcile = async () => {
    const current = context(), metadata = current.chatMetadata;
    analysis.cancel(); pending = null; clearReceipt(); setExtensionPrompt(PROMPT_KEY,'',1,0,false,0);
    const loading = hydrateVaultStorage(current,{force:true}); render();
    try { await loading; if (metadata !== context().chatMetadata) return; await analysis.reconcile(); }
    catch { if (metadata === context().chatMetadata) { diagnostics.record('storage',{status:'failed',code:'VAULT_STORAGE_FAILED'}); analysisStatus = {phase:'error',code:'storage_failed'}; } }
    render();
  };
  globalThis.SceneReaderHub?.companionStorage?.subscribe?.(() => { void loadAndReconcile(); });
  const reconcile = () => { analysis.reconcile().catch(() => { analysisStatus = { phase: 'error', code: 'storage_failed' }; render(); }); };
  current.eventSource.on(event_types.CHAT_CHANGED, () => { analysis.cancel(); analysisStatus = { phase: 'idle' }; pending = null; clearReceipt(); updateRunStatus({ phase: 'idle' }); setExtensionPrompt(PROMPT_KEY, '', 1, 0, false, 0); void loadAndReconcile(); });
  for (const name of ['MESSAGE_SWIPED', 'MESSAGE_EDITED', 'MESSAGE_DELETED']) if (event_types[name]) current.eventSource.on(event_types[name], reconcile);
  if (event_types.GENERATION_STOPPED) current.eventSource.on(event_types.GENERATION_STOPPED, () => { auditAllowed = false; analysis.cancel(); analysisStatus = { phase: 'cancelled' }; render(); });
  if (event_types.GENERATE_AFTER_DATA) current.eventSource.on(event_types.GENERATE_AFTER_DATA, observeAssembly);
  if (event_types.CHAT_COMPLETION_SETTINGS_READY) current.eventSource.on(event_types.CHAT_COMPLETION_SETTINGS_READY, observeRequest);
  void loadAndReconcile();
});
