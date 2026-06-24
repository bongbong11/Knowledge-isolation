// settings.js — Knowledge Isolation
// Data model + persistence via SillyTavern's extensionSettings.

import { DEFAULT_PROMPTS } from './prompts.js';

export const EXT_ID = 'knowledge-isolation';

// Shape of a single knowledge entry
// {
//   id: string,
//   title: string,
//   content: string,
//   importance: 'high' | 'mid' | 'low',
//   active: boolean,
//   blind: boolean,            // only meaningful for layer === 'char'
//   charAware: boolean,        // only meaningful for layer === 'user'
//   pace: 'never' | 'slow' | 'normal' | 'confession_ready' // char layer only
// }

export function defaultSettings() {
  const prompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
  const activePrompts = {};
  for (const key of Object.keys(prompts)) {
    activePrompts[key] = prompts[key]?.[0]?.id || null;
  }

  return {
    enabled: true,
    outletName: 'KI_Inject',

    gm: {
      modelProfile: '',       // ST Connection Manager profile id, set by user
      callEveryTurn: true,
      dedupeClues: true,
    },

    world: {
      pace: 'normal',         // 'slow' | 'normal' | 'fast'
      redHerring: true,
      antiBias: true,
      entries: [],
    },

    char: {
      entries: [],
    },

    user: {
      entries: [],
    },

    prompts,
    // Which prompt id is "in use" per area (world-gm, clue-gen, bias,
    // char-inject, clue-inject, user-inject, user-inject-aware). Only one
    // can be active per area - toggling one on switches the others off.
    activePrompts,
  };
}

/**
 * Ensures settings object has all expected keys (for upgrades / first run).
 * Call this once on extension load with the raw extensionSettings[EXT_ID].
 */
export function migrateSettings(raw) {
  const defaults = defaultSettings();
  if (!raw || typeof raw !== 'object') return defaults;

  const merged = { ...defaults, ...raw };
  merged.gm = { ...defaults.gm, ...(raw.gm || {}) };
  merged.world = { ...defaults.world, ...(raw.world || {}) };
  merged.char = { ...defaults.char, ...(raw.char || {}) };
  merged.user = { ...defaults.user, ...(raw.user || {}) };
  merged.prompts = { ...defaults.prompts, ...(raw.prompts || {}) };
  merged.activePrompts = { ...defaults.activePrompts, ...(raw.activePrompts || {}) };

  merged.world.entries = Array.isArray(raw.world?.entries) ? raw.world.entries : [];
  merged.char.entries = Array.isArray(raw.char?.entries) ? raw.char.entries : [];
  merged.user.entries = Array.isArray(raw.user?.entries) ? raw.user.entries : [];

  return merged;
}

export function newEntry(layer, overrides = {}) {
  const base = {
    id: `${layer}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    content: '',
    importance: 'high',
    active: true,
  };
  if (layer === 'char') {
    base.blind = false;
    base.pace = 'normal'; // never | slow | normal | confession_ready
  }
  if (layer === 'user') {
    base.charAware = false;
  }
  return { ...base, ...overrides };
}

export function getActiveEntries(layerEntries) {
  return (layerEntries || []).filter(e => e.active);
}
