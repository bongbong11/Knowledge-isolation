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
import { openFloatingPanel, toggleFloatingPanel } from './ui.js';

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
 * Returns Connection Manager profiles, used to populate the GM model
 * dropdown in the floating panel's Settings tab.
 */
function getConnectionProfiles() {
  const stContext = ctx();
  return stContext.extensionSettings?.['connectionManager']?.profiles || [];
}

/**
 * Adds a minimal entry to ST's Extensions settings drawer — just a note
 * and a button to open the real UI, since the real UI is a standalone
 * floating panel (not trapped inline in the drawer).
 */
function injectDrawerEntry() {
  if (document.getElementById('ki-ext-settings')) return;
  const html = `<div class="inline-drawer" id="ki-ext-settings">
    <div class="inline-drawer-toggle inline-drawer-header">
      <b>🔐 Knowledge Isolation</b>
      <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    <div class="inline-drawer-content">
      <div style="padding:8px;display:flex;flex-direction:column;gap:8px">
        <button id="ki-open-panel-btn" class="menu_button" style="width:100%">🔐 패널 열기</button>
        <div style="font-size:0.76rem;color:var(--SmartThemeQuoteColor,#aaa)">
          World/Char/User 지식 항목과 GM 모델 설정은 별도 플로팅 패널에서 관리합니다.
          매직스틱(🪄) 메뉴에서도 열 수 있습니다.
        </div>
      </div>
    </div>
  </div>`;
  const mount = document.getElementById('extensions_settings2') ?? document.getElementById('extensions_settings');
  mount?.insertAdjacentHTML('beforeend', html);
  document.getElementById('ki-open-panel-btn')?.addEventListener('click', () => openPanel());
}

/**
 * Adds a button to the wand (extensions) menu, or falls back to a
 * floating button if that menu container isn't found — same fallback
 * pattern used by chatl_royal.
 */
function injectWandButton() {
  if (document.getElementById('ki-wand-btn')) return;
  const btn = document.createElement('div');
  btn.id = 'ki-wand-btn';
  btn.title = 'Knowledge Isolation';
  btn.classList.add('list-group-item', 'flex-container', 'flexGap5', 'interactable');
  btn.innerHTML = '<span>🔐</span><span>Knowledge Isolation</span>';

  const target = document.getElementById('extensionsMenu');
  if (target) {
    target.appendChild(btn);
  } else {
    btn.style.cssText = 'cursor:pointer;padding:8px;position:fixed;bottom:70px;right:20px;z-index:9000;background:#1a1a24;border:2px solid #42425a;border-radius:50%;width:46px;height:46px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 4px 16px rgba(0,0,0,.3)';
    btn.innerHTML = '🔐';
    document.body.appendChild(btn);
  }
  btn.addEventListener('click', togglePanel);
}

function openPanel() {
  const settings = ctx().extensionSettings[MODULE_NAME];
  openFloatingPanel({
    settings,
    onChange: saveSettings,
    onNewEntry: (layer, overrides) => newEntry(layer, overrides),
    onRunPreview: runInjectionPreview,
    getConnectionProfiles,
  });
}

function togglePanel() {
  toggleFloatingPanel({
    settings: ctx().extensionSettings[MODULE_NAME],
    onChange: saveSettings,
    onNewEntry: (layer, overrides) => newEntry(layer, overrides),
    onRunPreview: runInjectionPreview,
    getConnectionProfiles,
  });
}

/**
 * Entry point called once ST itself is fully ready (APP_READY), matching
 * the pattern used by other working extensions in this install rather
 * than firing on jQuery's bare document-ready.
 */
export async function onActivate() {
  console.log(`[${MODULE_NAME}] activate`);

  loadSettings();
  injectDrawerEntry();
  injectWandButton();

  console.log(`[${MODULE_NAME}] ready`);
}

jQuery(async () => {
  const stContext = ctx();
  stContext.eventSource.on(event_types.APP_READY, async () => {
    await onActivate();
  });
});
