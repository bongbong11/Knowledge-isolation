// index.js — Knowledge Isolation
// SillyTavern extension entry point.
// Registers the generate_interceptor hook and wires up the settings UI.
//
// Pattern follows other working third-party extensions in this ST install
// (e.g. chatl_royal): use the global `SillyTavern.getContext()` accessor
// rather than importing extension_settings/getContext via relative paths,
// since exact file layout differs across ST versions and relative imports
// from extensions/third-party/<name>/ broke (ReferenceError: extension_settings
// is not defined).

import { event_types } from '../../../events.js';

import { EXT_ID, defaultSettings, migrateSettings, newEntry, getActiveEntries } from './settings.js';
import { buildInjectionPayload, injectIntoPrompt } from './pipeline.js';
import { renderSettingsPanel } from './ui.js';

const MODULE_NAME = EXT_ID;

function ctx() {
  return SillyTavern.getContext();
}

function loadSettings() {
  const c = ctx();
  if (!c.extensionSettings[MODULE_NAME]) {
    c.extensionSettings[MODULE_NAME] = defaultSettings();
  } else {
    c.extensionSettings[MODULE_NAME] = migrateSettings(c.extensionSettings[MODULE_NAME]);
  }
  return c.extensionSettings[MODULE_NAME];
}

function saveSettings() {
  ctx().saveSettingsDebounced();
}

/**
 * Builds a short plain-text summary of the last N chat messages,
 * used to give the GM model situational awareness without handing it
 * the entire chat log (keeps GM calls cheap and focused).
 */
function getRecentContextSummary(stContext, turns = 6) {
  try {
    const chat = stContext.chat || [];
    const recent = chat.slice(-turns);
    return recent
      .map(m => `${m.is_user ? 'User' : (m.name || 'Char')}: ${(m.mes || '').slice(0, 280)}`)
      .join('\n');
  } catch (err) {
    console.error(`[${MODULE_NAME}] Failed to summarize recent context:`, err);
    return '';
  }
}

/**
 * The generate_interceptor hook. SillyTavern calls this right before
 * sending the final payload to the main model. We use it to:
 *   1. Find the {{outlet::NAME}} macro in the system prompt
 *   2. Run the World/Char/User pipeline to build the injection payload
 *   3. Substitute it in
 *
 * Signature follows ST's documented interceptor contract:
 * async (chat, contextSize, abort, type) => { ...mutate chat in place... }
 */
async function knowledgeIsolationInterceptor(chat, contextSize, abort, type) {
  const stContext = ctx();
  const settings = stContext.extensionSettings[MODULE_NAME];
  if (!settings || !settings.enabled) return;

  const macro = `{{outlet::${settings.outletName}}}`;
  const target = chat.find(m => typeof m.mes === 'string' && m.mes.includes(macro));
  if (!target) return; // person hasn't placed the macro, or nothing to do

  const recentContext = getRecentContextSummary(stContext);
  const payload = await buildInjectionPayload(stContext, settings, recentContext);

  target.mes = injectIntoPrompt(target.mes, settings.outletName, payload);
}

// Register with ST's global interceptor list (must match manifest.json's
// "generate_interceptor" field).
window.knowledgeIsolationInterceptor = knowledgeIsolationInterceptor;

/**
 * Manual "preview" run — used by the Settings tab's "주입 미리보기" button.
 */
export async function runInjectionPreview(onStepUpdate) {
  const stContext = ctx();
  const settings = stContext.extensionSettings[MODULE_NAME];
  const recentContext = getRecentContextSummary(stContext);

  onStepUpdate?.('world-load', { status: 'active' });
  const activeWorld = getActiveEntries(settings.world.entries);
  onStepUpdate?.('world-load', {
    status: 'done',
    empty: activeWorld.length === 0,
    text: activeWorld.map(e => `• ${e.title}: ${e.content}`).join('\n') || '(no active entries)',
  });

  onStepUpdate?.('gm-call', { status: 'active' });
  let payload;
  try {
    payload = await buildInjectionPayload(stContext, settings, recentContext);
  } catch (err) {
    onStepUpdate?.('gm-call', { status: 'error', text: String(err) });
    return '';
  }
  onStepUpdate?.('gm-call', { status: 'done' });

  onStepUpdate?.('assemble', { status: 'done', text: payload });
  return payload;
}

/**
 * Fetches settings.html and appends it into ST's extensions settings
 * drawer area (mirrors the pattern other extensions in this install use,
 * e.g. chatl_royal builds its drawer HTML inline; some others fetch a file).
 */
async function injectSettingsHtml() {
  if (document.getElementById('knowledge_isolation_settings')) return true;
  try {
    const res = await fetch(`/scripts/extensions/third-party/Knowledge-isolation/settings.html`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const mount = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
    if (!mount) {
      console.error(`[${MODULE_NAME}] Could not find ST extensions settings container.`);
      return false;
    }
    mount.insertAdjacentHTML('beforeend', html);
    return true;
  } catch (err) {
    console.error(`[${MODULE_NAME}] Failed to load settings.html:`, err);
    return false;
  }
}

/**
 * Entry point called once ST itself is fully ready (APP_READY), matching
 * the pattern used by other working extensions in this install rather
 * than firing on jQuery's bare document-ready.
 */
export async function onActivate() {
  console.log(`[${MODULE_NAME}] activate`);

  const settings = loadSettings();
  const ok = await injectSettingsHtml();
  if (!ok) return;

  renderSettingsPanel({
    container: document.getElementById('knowledge_isolation_settings'),
    settings,
    onChange: saveSettings,
    onNewEntry: (layer, overrides) => newEntry(layer, overrides),
    onRunPreview: runInjectionPreview,
  });

  console.log(`[${MODULE_NAME}] ready`);
}

jQuery(async () => {
  const stContext = ctx();
  stContext.eventSource.on(event_types.APP_READY, async () => {
    await onActivate();
  });
});
