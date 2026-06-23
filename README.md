# Knowledge Isolation

SillyTavern extension for managing three separate knowledge layers in a
roleplay scenario, with real context isolation (not just prompt-level
"pretend you don't know"):

- **World Truth** — known to neither the character nor the persona. Read
  only by a separate GM model (configured via Connection Manager). The
  GM model converts it into observable scene events/clues, and only
  those clues — never the raw truth — reach the main roleplay model.
- **Char Secret** — known to the character and the world, hidden from the
  persona (you). Optionally stored blind so even you don't see the raw
  text in the UI. Supports a leak pace (never / slow / normal /
  confession-ready) for gradual reveals.
- **User Secret** — known only to the persona. The character has zero
  knowledge by default; optionally flippable to "character secretly
  aware" mode, which behaves like a Char Secret instead.

## How injection works

Knowledge is **not** pasted directly into your preset. Instead:

1. Place `{{outlet::YOUR_OUTLET_NAME}}` anywhere in your system prompt
   (outlet name configurable in Settings, default `KI_Inject`).
2. A `generate_interceptor` hook runs right before the main model
   generates a response. It finds that macro and replaces it with the
   assembled injection payload for that turn.
3. World Truth never enters the main model's context directly — only
   the GM model's processed output does. Char/User Secrets are injected
   as system-layer text with explicit "must not reveal" framing.

## Status

This is a first pass / scaffold:
- ✅ Settings UI (entries, pacing, prompt editor, outlet config)
- ✅ Pipeline logic for assembling the injection payload
- ✅ Manual preview (Settings > 주입 미리보기) for testing without
  burning a real turn
- ⚠️ GM model calls use `ConnectionManagerRequestService`, which must
  exist in your ST version — verify against your installed ST's API
  before relying on this in a real session
- ⚠️ Not yet tested end-to-end inside a live SillyTavern instance

## Install

Copy this folder into:

```
SillyTavern/public/scripts/extensions/third-party/knowledge-isolation/
```

Reload SillyTavern, enable the extension from Extensions settings, and
set a GM model profile under Knowledge Isolation > Settings.

## File layout

- `manifest.json` — extension metadata for ST
- `index.js` — entry point, registers the interceptor, boots the UI
- `ui.js` — all DOM rendering for the settings panel
- `pipeline.js` — GM model calls + injection payload assembly
- `prompts.js` — default/seed prompt templates per pipeline stage
- `settings.js` — settings data model + persistence helpers
- `settings.html` — mount point fragment for ST's extensions drawer
- `style.css` — scoped styles for the settings panel
