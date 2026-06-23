// index.js — Knowledge Isolation
// SillyTavern extension entry point.
// Registers the generate_interceptor hook and wires up the settings UI.

import { EXT_ID, defaultSettings, migrateSettings, newEntry, getActiveEntries } from './settings.js';
import { buildInjectionPayload, injectIntoPrompt } from './pipeline.js';
import { renderSettingsPanel } from './ui.js';

// ST exposes these globals in the extension scripting environment.
/* global extension_settings, saveSettingsDebounced, getContext */

function loadSettings() {
  if (!extension_settings[EXT_ID]) {
    extension_settings[EXT_ID] = defaultSettings();
  } else {
    extension_settings[EXT_ID] = migrateSettings(extension_settings[EXT_ID]);
  }
  return extension_settings[EXT_ID];
}

function saveSettings() {
  saveSettingsDebounced();
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
    console.error('[Knowledge Isolation] Failed to summarize recent context:', err);
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
  const settings = extension_settings[EXT_ID];
  if (!settings || !settings.enabled) return;

  const stContext = getContext();

  // Find the system prompt entry that contains our outlet macro.
  const macro = `{{outlet::${settings.outletName}}}`;
  const target = chat.find(m => typeof m.mes === 'string' && m.mes.includes(macro));
  if (!target) {
    // Nothing to do — person hasn't placed the macro, or it already ran.
    return;
  }

  const recentContext = getRecentContextSummary(stContext);
  const payload = await buildInjectionPayload(stContext, settings, recentContext);

  target.mes = injectIntoPrompt(target.mes, settings.outletName, payload);
}

// Register with ST's global interceptor list. ST looks for a function
// whose name matches manifest.json's "generate_interceptor" field (or,
// in newer ST versions, a function exported here and referenced by name).
window.knowledgeIsolationInterceptor = knowledgeIsolationInterceptor;

/**
 * Manual "preview" run — used by the Settings tab's "주입 미리보기" button.
 * Does the same thing as the interceptor, but returns the payload directly
 * for display instead of mutating chat, and reports per-stage status so the
 * UI can render the step-by-step pipeline view.
 */
export async function runInjectionPreview(onStepUpdate) {
  const settings = extension_settings[EXT_ID];
  const stContext = getContext();
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
 * Bootstraps the settings UI inside ST's extensions settings panel.
 */
function init() {
  const settings = loadSettings();
  renderSettingsPanel({
    container: document.getElementById('knowledge_isolation_settings'),
    settings,
    onChange: saveSettings,
    onNewEntry: (layer, overrides) => newEntry(layer, overrides),
    onRunPreview: runInjectionPreview,
  });
}

// ST extensions are typically bootstrapped on jQuery's document-ready,
// since ST's own UI is still jQuery-based as of this writing.
jQuery(async () => {
  init();
});
