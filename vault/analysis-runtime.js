import { cardRevision } from './core.js';
import { ACQUISITION_SYSTEM, applyAcquisitions, identityCurrent, outputIdentity, reconcileCards, sceneDate, validateAcquisitions } from './acquisition.js';
import { buildActors, fingerprint } from './identity.js';
import { CHAT_KEY, readActors, readCards, writeAudit, writeCards } from './store.js';
import {knowledgeSourceScope,knowledgeReceiptKey} from './storyline-scope.js';

// The vault owns leases, evidence validation and metadata. The host owns the model request.
export function createVaultAnalysis({ context, enabled, onStatus = () => {}, onDiagnostic = () => {} }) {
  const note = (stage, data, request) => { try { if (!request || request.metadata === context().chatMetadata) onDiagnostic(stage,data); } catch {} };
  const leases = new Map(), completed = new WeakMap();
  let sequence = 0, epoch = 0, cursor = 0, tail = Promise.resolve();
  const enqueue = task => { const next = tail.catch(() => {}).then(task); tail = next; return next; };
  const revision = ctx => fingerprint(cardRevision(readCards(ctx)) + JSON.stringify(readActors(ctx)));
  function cancel() { for (const [token,request] of leases) note('audit',{status:'cancelled',token},request); epoch++; leases.clear(); }
  async function reconcile() {
    cancel();
    const ctx = context(), metadata = ctx.chatMetadata;
    await enqueue(async () => {
      if (metadata !== context().chatMetadata) return;
      const cards = readCards(ctx), updated = reconcileCards(cards, ctx.chat || [],knowledgeSourceScope(ctx));
      if (JSON.stringify(cards) !== JSON.stringify(updated)) {
        try { await writeCards(ctx, updated, {resetAudit:true}); }
        catch (error) { note('storage',{status:'failed',code:'VAULT_STORAGE_FAILED'},{metadata}); throw error; }
        note('storage',{status:'rollback',changedCount:cards.reduce((n,c,i)=>n+c.acquisitions.length-updated[i].acquisitions.length,0)},{metadata});
        completed.delete(metadata);
      }
      onStatus({ phase: 'idle' });
    });
  }
  function begin({ outputIndex, sourceText, sourceTruncated = false, outputText, actorNames = [], actorDefinitions = [], preferredIds = [] } = {}) {
    if (!enabled()) return null;
    const ctx = context(), identity = outputIdentity(ctx.chat, outputIndex);
    if (!identity || !sourceText?.trim()) { note('audit',{status:'skipped',reason:'no_source'}); return null; }
    const cards = readCards(ctx).filter(card => card.enabled && card.route !== 'disabled' && !card.public);
    if (!cards.length) { note('audit',{status:'skipped',reason:'no_cards'}); return null; }
    const scope=knowledgeSourceScope(ctx);if(scope.chatRef)identity.originChatRef=scope.chatRef;
    const rev = revision(ctx), key = `${knowledgeReceiptKey(identity)}:${rev}`;
    if (ctx.chatMetadata?.[CHAT_KEY]?.auditReceipts?.includes(key) || completed.get(ctx.chatMetadata)?.has(key) || [...leases.values()].some(item => item.metadata === ctx.chatMetadata && item.key === key)) { note('audit',{status:'skipped',reason:'duplicate',outputIndex}); return null; }
    const rotated = [...cards.slice(cursor), ...cards.slice(0, cursor)]; cursor = (cursor + 4) % cards.length;
    // Prefer injected cards while reserving room for rotating through the rest.
    const preferred = rotated.filter(card => preferredIds.includes(card.id)).slice(0, cards.length > 12 ? 8 : 12);
    const preferredSet = new Set(preferred.map(card => card.id));
    const ordered = [...preferred, ...rotated.filter(card => !preferredSet.has(card.id))];
    const selected = [], omitted = []; let chars = 0;
    for (const card of ordered) {
      if (selected.length >= 12 || chars + card.text.length > 18000) omitted.push(card.id);
      else { selected.push(card); chars += card.text.length; }
    }
    if (!selected.length) { onStatus({ phase: 'capacity', unresolvedCount: cards.length }); return null; }
    const actors = buildActors(cards, readActors(ctx), { name1: ctx.name1, name2: ctx.name2, actorNames, actorDefinitions });
    const token = `vault-audit-${++sequence}`;
    const request = { cards: selected, actors, identity, sourceText, sourceTruncated, date: sceneDate(outputText), metadata: ctx.chatMetadata, revision: rev, key, epoch, omitted, startedAt:Date.now() };
    leases.set(token, request); if (leases.size > 8) leases.delete(leases.keys().next().value);
    onStatus({ phase: 'analyzing', checkedCount: selected.length, unresolvedCount: omitted.length });
    note('audit',{status:'analyzing',token,outputIndex,sceneDate:request.date,checkedCount:selected.length,omittedCount:omitted.length,...(sourceTruncated?{reason:'source_truncated'}:{})},request);
    return { token, system: ACQUISITION_SYSTEM, input: { cards: selected.map(({ id, text, knownBy, truthScope }) => ({ id, fact: text, truthScope, known_actor_ids: actors.filter(actor => knownBy.some(name => actor.name.toLowerCase() === name.toLowerCase())).map(actor => actor.id) })), actors }, count: selected.length };
  }
  function isCurrent(token) {
    const request = leases.get(token), ctx = context();
    return Boolean(request && enabled() && request.epoch === epoch && ctx.chatMetadata === request.metadata && revision(ctx) === request.revision && identityCurrent(request.identity, ctx.chat));
  }
  function repair(token, result) {
    if (!isCurrent(token)) return null;
    const request = leases.get(token);
    if (request.repaired) return null;
    const entries = Array.isArray(result?.vault_results) ? result.vault_results : [];
    const cards = request.cards.filter(card => {
      const matches = entries.filter(item => item?.card_id === card.id), item = matches[0];
      return matches.length !== 1 || !['no_change','learned','partial','uncertain'].includes(item.status) || !Array.isArray(item.learners)
        || item.learners.some(learner => !learner || typeof learner.evidence !== 'string' || typeof learner.confidence !== 'number' || !learner.method || !learner.scope || (!learner.actor_id && !learner.actor_name));
    });
    if (!cards.length) return null;
    request.repaired = true;
    note('audit',{status:'repair',token,checkedCount:cards.length},request);
    return { cardIds: cards.map(card => card.id), system: ACQUISITION_SYSTEM,
      input: { cards: cards.map(({id,text,knownBy,truthScope}) => ({id,fact:text,knownBy,truthScope})), actors: request.actors } };
  }
  async function commit(token, result) {
    return enqueue(async () => {
      if (!isCurrent(token)) { const request=leases.get(token); if(request)note('audit',{status:'cancelled',token,reason:'stale'},request); leases.delete(token); return { status: 'cancelled' }; }
      const request = leases.get(token), checked = validateAcquisitions(result, request);
      for (const entry of checked.diagnostics) note('validation',{...entry,token,sceneDate:request.date,changes:checked.changes.filter(item=>item.cardId===entry.cardId)},request);
      const cards = applyAcquisitions(readCards(context()), checked.changes);
      const afterKey = `${knowledgeReceiptKey(request.identity)}:${fingerprint(cardRevision(cards) + JSON.stringify(readActors(context())))}`;
      try { await writeAudit(context(), cards, [request.key, afterKey]); }
      catch (error) { note('storage',{status:'failed',token,code:'VAULT_STORAGE_FAILED'},request); throw error; }
      note('storage',{status:'saved',token,changedCount:checked.changes.length,durationMs:Date.now()-request.startedAt},request);
      leases.delete(token);
      const seen = completed.get(request.metadata) || new Set(); seen.add(request.key);
      // Tag changes alter the revision; suppress duplicate processing of the same output.
      seen.add(`${knowledgeReceiptKey(request.identity)}:${revision(context())}`);
      if (seen.size > 120) seen.delete(seen.values().next().value); completed.set(request.metadata, seen);
      const status = { status: checked.unresolved.length || request.omitted.length || request.sourceTruncated ? 'partial' : 'success',
        checkedCount: checked.checked.length, learnedCount: checked.changes.filter(item => item.scope === 'full').length,
        partialCount: checked.changes.filter(item => item.scope === 'partial').length,
        unresolvedCount: request.sourceTruncated ? request.cards.length + request.omitted.length : checked.unresolved.length + request.omitted.length };
      onStatus({ phase: 'checked', ...status });
      note('audit',{...status,token,durationMs:Date.now()-request.startedAt},request);
      return status;
    });
  }
  function fail(token, code = 'analysis_failed') {
    const request=leases.get(token);
    if(request)note('audit',{status:'failed',token,code},request);
    leases.delete(token); onStatus({ phase: 'error', code });
  }
  function abandon(token) { const request=leases.get(token); if (leases.delete(token)) { note('audit',{status:'cancelled',token},request); onStatus({ phase: 'cancelled' }); } }
  return { begin, isCurrent, repair, commit, fail, abandon, cancel, reconcile };
}
