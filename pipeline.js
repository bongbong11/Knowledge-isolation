// pipeline.js — Knowledge Isolation
// Core logic: calling the GM model, assembling injection text,
// and exposing the result to the generate_interceptor hook.

import { getActiveEntries } from './settings.js';

/**
 * Fills {{placeholders}} in a prompt template.
 */
function fillTemplate(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    return vars[key] !== undefined ? vars[key] : '';
  });
}

function entriesToText(entries) {
  if (!entries.length) return '(none)';
  return entries.map(e => `• ${e.title}: ${e.content}`).join('\n');
}

/**
 * Calls the GM model via ST's Connection Manager profile.
 * `stContext` is the object returned by SillyTavern.getContext().
 * `profileName` is the *name* of a saved Connection Manager profile
 * (matches the pattern used by other working extensions in this ST
 * install — profiles are looked up by name, not by some separate id
 * field, and the call goes through ConnectionManagerRequestService).
 *
 * Returns the raw text response from the GM model, or null on failure
 * (including "no profile configured", which is a normal/expected state
 * before the person sets one up).
 */
async function callGmModel(stContext, profileName, promptText) {
  if (!profileName) {
    console.warn('[Knowledge Isolation] No GM model profile configured.');
    return null;
  }
  if (!stContext.ConnectionManagerRequestService) {
    console.error('[Knowledge Isolation] ConnectionManagerRequestService not available.');
    return null;
  }
  try {
    const profiles = stContext.extensionSettings?.['connectionManager']?.profiles || [];
    const profile = profiles.find(p => p.name === profileName);
    if (!profile) {
      console.error(`[Knowledge Isolation] No Connection Manager profile named "${profileName}" found.`);
      return null;
    }

    const response = await stContext.ConnectionManagerRequestService.sendRequest(
      profile.id,
      [{ role: 'user', content: promptText }],
      600,
      { stream: false, extractData: true, includePreset: true, includeInstruct: false },
    );

    if (typeof response === 'string') return response;
    if (typeof response?.content === 'string') return response.content;
    if (response?.choices?.[0]?.message?.content) return response.choices[0].message.content;
    if (response?.content?.[0]?.text) return response.content[0].text;
    return null;
  } catch (err) {
    console.error('[Knowledge Isolation] GM model call failed:', err);
    return null;
  }
}

/**
 * Builds the World GM prompt from settings + recent chat context.
 */
function buildWorldGmPrompt(settings, recentContext) {
  const activeWorld = getActiveEntries(settings.world.entries);
  if (!activeWorld.length) return null;

  const worldGmTemplate = settings.prompts['world-gm']?.[0]?.content || '';
  const clueGenTemplate = settings.prompts['clue-gen']?.[0]?.content || '';
  const biasTemplate = settings.prompts['bias']?.[0]?.content || '';

  const worldTruthText = entriesToText(activeWorld);

  const gmPrompt = fillTemplate(worldGmTemplate, {
    world_truth: worldTruthText,
    recent_context: recentContext || '(no recent context)',
  });

  const cluePrompt = fillTemplate(clueGenTemplate, {
    pace: settings.world.pace,
  });

  const biasPrompt = settings.world.redHerring || settings.world.antiBias ? biasTemplate : '';

  return [gmPrompt, cluePrompt, biasPrompt].filter(Boolean).join('\n\n---\n\n');
}

/**
 * Builds the Char Secret injection block.
 */
function buildCharInjection(settings) {
  const activeChar = getActiveEntries(settings.char.entries);
  if (!activeChar.length) return null;

  const template = settings.prompts['char-inject']?.[0]?.content || '';
  // Use the most permissive pace among active entries for the shared instruction text;
  // per-entry pace nuance can be reflected inline if needed later.
  const pace = activeChar[0]?.pace || 'normal';

  return fillTemplate(template, {
    char_secrets: entriesToText(activeChar),
    char_pace: pace,
  });
}

/**
 * Builds the User Secret injection block.
 * Splits entries into "char unaware" vs "char aware" sets, since they use
 * different prompt templates.
 */
function buildUserInjection(settings) {
  const activeUser = getActiveEntries(settings.user.entries);
  if (!activeUser.length) return null;

  const unaware = activeUser.filter(e => !e.charAware);
  const aware = activeUser.filter(e => e.charAware);

  const blocks = [];

  if (unaware.length) {
    const template = settings.prompts['user-inject']?.[0]?.content || '';
    blocks.push(fillTemplate(template, { user_secrets: entriesToText(unaware) }));
  }
  if (aware.length) {
    const template = settings.prompts['user-inject-aware']?.[0]?.content || '';
    blocks.push(fillTemplate(template, { user_secrets: entriesToText(aware) }));
  }

  return blocks.length ? blocks.join('\n\n') : null;
}

/**
 * Builds the GM event clue injection block (after calling the GM model).
 */
function buildClueInjection(settings, gmEventText) {
  if (!gmEventText) return null;
  const template = settings.prompts['clue-inject']?.[0]?.content || '';
  return fillTemplate(template, { gm_event: gmEventText });
}

/**
 * Main entry point. Produces the full text that should be placed at the
 * {{outlet::NAME}} location in the main model's system prompt.
 *
 * `stContext` — result of SillyTavern getContext()
 * `settings`  — this extension's settings object
 * `recentContext` — short string summary of the last few chat turns,
 *                   used to give the GM model situational awareness.
 */
export async function buildInjectionPayload(stContext, settings, recentContext) {
  if (!settings.enabled) return '';

  const parts = [];

  // 1. World layer -> GM model call -> clue injection
  const worldGmPrompt = buildWorldGmPrompt(settings, recentContext);
  if (worldGmPrompt) {
    const gmEvent = await callGmModel(stContext, settings.gm.modelProfile, worldGmPrompt);
    const clueBlock = buildClueInjection(settings, gmEvent);
    if (clueBlock) parts.push(clueBlock);
  }

  // 2. Char Secret layer -> direct injection (no GM call needed)
  const charBlock = buildCharInjection(settings);
  if (charBlock) parts.push(charBlock);

  // 3. User Secret layer -> direct injection (no GM call needed)
  const userBlock = buildUserInjection(settings);
  if (userBlock) parts.push(userBlock);

  return parts.join('\n\n─────────────\n\n');
}

/**
 * Replaces {{outlet::NAME}} in a system prompt string with the assembled
 * injection payload. If the outlet macro isn't found, returns the prompt
 * unchanged (and logs a warning) — this is the "did the person forget to
 * place the macro" safety net.
 */
export function injectIntoPrompt(systemPrompt, outletName, payload) {
  const macro = `{{outlet::${outletName}}}`;
  if (!systemPrompt.includes(macro)) {
    console.warn(`[Knowledge Isolation] Outlet macro "${macro}" not found in system prompt. Nothing was injected.`);
    return systemPrompt;
  }
  return systemPrompt.split(macro).join(payload || '');
}

export const __test__ = {
  fillTemplate,
  entriesToText,
  buildWorldGmPrompt,
  buildCharInjection,
  buildUserInjection,
  buildClueInjection,
};
