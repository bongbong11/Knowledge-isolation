// prompts.js — Knowledge Isolation
// Default/built-in prompt templates for each pipeline stage.
// These are seed prompts; users can edit, duplicate, or replace them
// from the Settings tab > Prompt Editor.

export const DEFAULT_PROMPTS = {
  // ── GM model: reads World Truth, produces scene-level events/clues ──
  'world-gm': [
    {
      id: 'default',
      name: '기본 World GM',
      content: [
        'You are the Game Master for a roleplay scenario.',
        'You alone have access to the World Truth below. The main roleplay model does NOT have access to it.',
        '',
        'WORLD TRUTH:',
        '{{world_truth}}',
        '',
        'RECENT SCENE CONTEXT:',
        '{{recent_context}}',
        '',
        'Your job: generate ONE short, observable scene event or environmental detail (1-3 sentences)',
        'that is consistent with the World Truth but does NOT state it directly.',
        'Write it as a piece of narration/stage direction — not dialogue, not a character\'s internal thought.',
        'It should read like something a narrator notices in the environment, not something a character announces.',
        '',
        'Respond with the event text only. No preamble, no explanation, no JSON.'
      ].join('\n')
    }
  ],

  // ── Clue generation format/pacing ──
  'clue-gen': [
    {
      id: 'default',
      name: '기본 Clue Generator',
      content: [
        'Generate exactly ONE clue for this turn.',
        'The clue must be physical, observable, and deniable — never state its meaning or implication.',
        'Let the reader/player interpret it themselves.',
        '',
        'Pacing mode: {{pace}}',
        '- SLOW: the clue is ambient and easy to miss. Background detail only.',
        '- NORMAL: the clue is clear but requires the reader to notice it.',
        '- FAST: the clue is prominent and hard to ignore.',
        '',
        'Output: one short paragraph, no labels, no meta-commentary.'
      ].join('\n')
    }
  ],

  // ── Anti-bias / red herring enforcement for the GM model ──
  'bias': [
    {
      id: 'default',
      name: '기본 Bias Prevention',
      content: [
        'CRITICAL RULE: You know the full truth. Do not let your clues drift toward revealing it too quickly.',
        '',
        'Every 3rd clue you generate must implicate a DIFFERENT, INNOCENT party (a red herring).',
        'Never repeat the same suspect or culprit-adjacent detail two turns in a row.',
        'Distribute suspicion across multiple plausible parties over the course of the scenario.',
        '',
        'If you notice yourself repeating a pattern (same suspect, same kind of evidence),',
        'deliberately break it on the next generation.'
      ].join('\n')
    }
  ],

  // ── Char Secret injection format (goes into main model system context) ──
  'char-inject': [
    {
      id: 'default',
      name: '기본 Char Secret Injection',
      content: [
        '[CHARACTER KNOWLEDGE — SYSTEM LAYER]',
        '{{char}} privately knows the following. This knowledge shapes behavior, tension, and subtext,',
        'but must NOT surface directly in dialogue, narration, or internal monologue — not even as a hint',
        'that could be decoded by {{user}}.',
        '',
        'Leak pace: {{char_pace}}',
        '- NEVER: {{char}} never reveals this under any circumstance. Pure background motivation only.',
        '- SLOW: rare, subtle cracks only — a flinch, a pause, a word that almost slips out.',
        '- NORMAL: gradual, natural reveals tied to story progression and trust built.',
        '- CONFESSION_READY: {{char}} may choose to voluntarily confess this if pressure/trust has built enough.',
        '',
        'KNOWN BY {{char}}:',
        '{{char_secrets}}'
      ].join('\n')
    }
  ],

  // ── GM event -> main model injection format ──
  'clue-inject': [
    {
      id: 'default',
      name: '기본 Clue Injection Format',
      content: [
        '[SCENE EVENT — WORLD LAYER]',
        'The following just happened or is present in the world. Weave it naturally into the scene',
        'through {{char}}\'s perception, action, or the environment. Do not announce it as significant.',
        'Do not let {{char}} comment on its meaning unless the scene has earned that insight.',
        '',
        'EVENT:',
        '{{gm_event}}'
      ].join('\n')
    }
  ],

  // ── User Secret injection format ──
  'user-inject': [
    {
      id: 'default',
      name: '기본 User Secret Injection',
      content: [
        '[PERSONA KNOWLEDGE — USER LAYER]',
        '{{char}} has ZERO prior knowledge of the following. If {{user}} reveals any part of it,',
        '{{char}} reacts as someone hearing it for the very first time — no recognition, no foreshadowing.',
        '',
        'KNOWN ONLY BY {{user}}:',
        '{{user_secrets}}'
      ].join('\n')
    }
  ],

  // ── User Secret, but character is aware and hiding it (alt mode) ──
  'user-inject-aware': [
    {
      id: 'default',
      name: '기본 User Secret (Char Aware) Injection',
      content: [
        '[PERSONA KNOWLEDGE — USER LAYER, CHARACTER AWARE]',
        '{{char}} privately knows the following about {{user}}, but has chosen not to disclose this knowledge.',
        'If {{user}} brings it up, {{char}} does NOT react as if hearing it for the first time —',
        'instead, {{char}} reacts as someone whose hidden awareness has just been surfaced or confronted.',
        'This may produce guilt, relief, defensiveness, or tension depending on {{char}}\'s sheet.',
        '',
        'KNOWN BY {{user}} AND SECRETLY BY {{char}}:',
        '{{user_secrets}}'
      ].join('\n')
    }
  ],
};

export function getPromptSet(key) {
  return DEFAULT_PROMPTS[key] ? JSON.parse(JSON.stringify(DEFAULT_PROMPTS[key])) : [];
}
