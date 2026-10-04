// The companion UI keeps a metadata-shaped view for existing readers. Once the
// server bridge is present, only confirmed server writes update that view.
const loads = new WeakMap(), queues = new WeakMap(), states = new WeakMap();
export const VAULT_CHAT_KEY = 'knowledgeVaultV1';
const empty = () => ({version:1,cards:[],actors:[],auditReceipts:[]});
const bridgeFor = host => host.SceneReaderHub?.companionStorage?.version === 1 ? host.SceneReaderHub.companionStorage : null;
const stillCurrent = (ctx,metadata,host) => ctx.chatMetadata === metadata && (!host.SillyTavern?.getContext || host.SillyTavern.getContext().chatMetadata === metadata);
export function vaultStorageState(context) { return {...(states.get(context.chatMetadata) || {status:'pending'})}; }

export async function hydrateVaultStorage(ctx, {host = globalThis, force = false} = {}) {
    const metadata = ctx.chatMetadata, bridge = bridgeFor(host);
    if (!metadata) throw new Error('채팅을 먼저 열어 주세요.');
    if (!bridge) {
        if (metadata[VAULT_CHAT_KEY]?.storage === 'scene-reader') {
            states.set(metadata,{status:'failed',code:'VAULT_STORAGE_UNAVAILABLE'});
            throw new Error('금고의 서버 저장 연결을 사용할 수 없습니다. 씬판독기를 함께 업데이트해 주세요.');
        }
        states.set(metadata,{status:'ready'});
        return metadata[VAULT_CHAT_KEY] || empty();
    }
    if (loads.has(metadata)) return loads.get(metadata);
    if (!force && states.get(metadata)?.status === 'ready') return metadata[VAULT_CHAT_KEY];
    const original = metadata[VAULT_CHAT_KEY];
    states.set(metadata,{status:'loading'});
    const task = (async () => {
        try {
            const data = await bridge.load(VAULT_CHAT_KEY,{metadata,legacy:original?.storage === 'scene-reader' ? undefined : original});
            if (!stillCurrent(ctx,metadata,host)) throw Object.assign(new Error('채팅이 바뀌었습니다.'),{code:'STORAGE_STALE_CHAT'});
            if (data != null && (typeof data !== 'object' || Array.isArray(data) || (data.version !== undefined && data.version !== 1)
                || ['cards','actors','auditReceipts'].some(key=>data[key] !== undefined && !Array.isArray(data[key])))) {
                throw Object.assign(new Error('금고 저장 형식을 확인하지 못했습니다. 기존 데이터는 유지합니다.'),{code:'VAULT_STORAGE_INVALID'});
            }
            const next = {...empty(),...(data || {}),storage:'scene-reader'};
            metadata[VAULT_CHAT_KEY] = next;
            // Keep the old format readable on rollback. The marker prevents an
            // older server backup from resurrecting a stale migration source.
            if (original && original.storage !== 'scene-reader' && typeof ctx.saveMetadata === 'function') {
                try { await ctx.saveMetadata(); }
                catch { states.set(metadata,{status:'ready',code:'VAULT_LEGACY_MARKER_FAILED'}); return next; }
            }
            states.set(metadata,{status:'ready'});
            return next;
        } catch (error) {
            states.set(metadata,{status:'failed',code:error.code || 'VAULT_STORAGE_FAILED'});
            throw error;
        }
    })();
    loads.set(metadata,task);
    try { return await task; } finally { if (loads.get(metadata) === task) loads.delete(metadata); }
}

export function updateVaultStorage(ctx, patch, {host = globalThis} = {}) {
    const metadata = ctx.chatMetadata;
    if (!metadata) return Promise.reject(new Error('채팅을 먼저 열어 주세요.'));
    const previousTask = queues.get(metadata) || Promise.resolve();
    const task = previousTask.catch(()=>{}).then(async () => {
        const bridge = bridgeFor(host);
        if (bridge || metadata[VAULT_CHAT_KEY]?.storage === 'scene-reader') await hydrateVaultStorage(ctx,{host});
        if (!stillCurrent(ctx,metadata,host)) throw Object.assign(new Error('채팅이 바뀌어 저장을 중단했습니다.'),{code:'STORAGE_STALE_CHAT'});
        const previous = metadata[VAULT_CHAT_KEY];
        const next = {...(previous || empty()),...patch(previous || empty())};
        try {
            if (bridge) {
                const saved = await bridge.save(VAULT_CHAT_KEY,next,{metadata});
                if (!stillCurrent(ctx,metadata,host)) throw Object.assign(new Error('채팅이 바뀌었습니다.'),{code:'STORAGE_STALE_CHAT'});
                metadata[VAULT_CHAT_KEY] = {...saved,storage:'scene-reader'};
            } else {
                if (typeof ctx.saveMetadata !== 'function') throw new Error('저장 연결을 확인해 주세요.');
                metadata[VAULT_CHAT_KEY] = next;
                try { await ctx.saveMetadata(); }
                catch (error) { if (metadata[VAULT_CHAT_KEY] === next) metadata[VAULT_CHAT_KEY] = previous; throw error; }
            }
            states.set(metadata,{status:'ready'});
        } catch (error) { states.set(metadata,{status:'failed',code:error.code || 'VAULT_STORAGE_FAILED'}); throw error; }
    });
    queues.set(metadata,task);
    void task.finally(()=>{if (queues.get(metadata) === task) queues.delete(metadata);}).catch(()=>{});
    return task;
}
