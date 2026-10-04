// In-memory, chat-scoped diagnostics. Never retain facts, names or model prose.
const pick = (value, choices) => choices.includes(value) ? value : 'unknown';
const count = value => Number.isFinite(value) ? Math.max(0, Math.min(1000000, Math.floor(value))) : 0;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value : null;
const codes = ['PROFILE_UNAVAILABLE','PROFILE_AUDIT_FAILED','PROFILE_INVALID_RESPONSE','PROFILE_TIMEOUT','PROFILE_AUTH_FAILED','PROFILE_FORBIDDEN','PROFILE_RATE_LIMIT','PROFILE_SERVER_ERROR','PROFILE_NETWORK_ERROR','PROFILE_CANCELLED','PROFILE_BILLING','PROFILE_REQUEST_TOO_LARGE','PROFILE_NOT_FOUND','PROFILE_REQUEST_REJECTED','VAULT_STORAGE_FAILED','storage_failed','analysis_failed','NETWORK_TIMEOUT','NETWORK_ERROR','HTTP_401','HTTP_403','HTTP_429','HTTP_500','INVALID_JSON'];
export function createVaultDiagnostics({ context, readCards, isEnabled, now = () => new Date().toISOString() }) {
  const chats = new WeakMap();
  const empty = () => ({ events: [], cards: new Map(), actors: new Map(), sequence: 0, dropped: 0, lastFailure: null });
  function state() {
    const key = context().chatMetadata;
    if (!key || typeof key !== 'object') return empty();
    if (!chats.has(key)) chats.set(key, empty());
    return chats.get(key);
  }
  function ref(map, value, prefix) {
    if (!value) return null;
    if (!map.has(value) && map.size >= 4096) return null;
    if (!map.has(value)) map.set(value, `${prefix}${map.size + 1}`);
    return map.get(value);
  }
  function acquisition(item, s) {
    return { actorRef: ref(s.actors, item.actorName || item.actorId, 'actor-'), sceneDate: date(item.date),
      method: pick(item.method, ['told','observed','read','reported']), scope: pick(item.scope, ['full','partial']),
      evidencePresent: typeof item.evidence === 'string' && item.evidence.length > 0 };
  }
  function record(stage, data = {}) {
    try {
      const s = state();
      const event = { seq: ++s.sequence, at: now(), stage: pick(stage, ['selection','injection','audit','validation','storage','lifecycle']),
        module: stage === 'validation' ? 'vault/acquisition.js' : ['audit','storage'].includes(stage) ? 'vault/analysis-runtime.js' : 'index.js',
        status: pick(data.status || data.phase, ['idle','reading','judged','registered','skipped','error','analyzing','checked','capacity','cancelled','repair','success','partial','saved','failed','no_change','learned','uncertain','invalid','rollback']),
        code: data.code ? pick(data.code, codes) : null,
        auditRef: /^vault-audit-\d+$/.test(data.token || '') ? data.token : null };
      for (const key of ['candidateCount','unassessedCount','assessedCount','relevantCount','omittedCount','checkedCount','learnedCount','partialCount','unresolvedCount','changedCount','outputIndex','durationMs']) if (key in data) event[key] = count(data[key]);
      if (typeof data.enabled === 'boolean') event.enabled = data.enabled;
      if (data.cardId) event.cardRef = ref(s.cards, data.cardId, 'card-');
      if (data.reason) event.reason = pick(data.reason, ['missing_or_invalid_result','uncertain','learner_validation_failed','actor_unresolved','invalid_method_or_scope','confidence_rejected','evidence_rejected','scope_mismatch','too_many_learners','no_new_holder','accepted','source_truncated','stale','disabled','duplicate','no_cards','no_source','capacity']);
      if (data.receipt) event.receipt = { phase: pick(data.receipt.phase,['assembly','request']), status:pick(data.receipt.status,['confirmed','missing','unavailable','not_expected']) };
      if (Array.isArray(data.includedIds)) event.includedCards = data.includedIds.slice(0,12).map(id=>ref(s.cards,id,'card-'));
      if (Array.isArray(data.sceneResults)) event.selections = data.sceneResults.slice(0,12).map(item=>({cardRef:ref(s.cards,item.secret_id,'card-'),relevant:item.relevant===true}));
      if (Array.isArray(data.changes)) event.acquisitions = data.changes.slice(0,8).map(item=>acquisition(item,s));
      if (data.sceneDate !== undefined) event.sceneDate = date(data.sceneDate);
      s.events.push(event);
      if (s.events.length > 120) { s.events.shift(); s.dropped++; }
      if (['error','failed','invalid'].includes(event.status) || event.receipt?.status === 'missing') s.lastFailure = event;
    } catch { /* Diagnostics must never affect a generation or save. */ }
  }
  function report() {
    const s = state(), cards = readCards(context());
    const snapshot = { reportVersion: 1, enabled: isEnabled() === true, eventLimit:120, droppedEvents:s.dropped,
      cardCount:cards.length, omittedCards:Math.max(0,cards.length-120),
      cards:cards.slice(0,120).map((card,index)=>({ cardRef:ref(s.cards,card.id,'card-'), cardPosition:index+1,
        enabled:card.enabled && card.route !== 'disabled', public:card.public===true,
        scope:pick(card.truthScope,['world','private']), holderCount:card.knownBy.length,
        savedAcquisitionCount:card.acquisitions.length, omittedAcquisitions:Math.max(0,card.acquisitions.length-20),
        acquisitions:card.acquisitions.slice(-20).map(item=>acquisition(item,s)) })),
      lastFailure:s.lastFailure, events:s.events };
    return JSON.parse(JSON.stringify(snapshot));
  }
  return { record, report };
}
