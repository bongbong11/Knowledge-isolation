import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrateVaultStorage,updateVaultStorage,vaultStorageState} from '../vault/storage-connection.js';

const fixture = () => {
    const legacy={version:1,cards:[{id:'one',text:'synthetic'}],actors:[{name:'NPC'}],auditReceipts:['audit']};
    const ctx={chatMetadata:{knowledgeVaultV1:legacy},saveMetadata:async()=>{}};
    let saved, fail=false;
    const host={SillyTavern:{getContext:()=>ctx},SceneReaderHub:{companionStorage:{version:1,
        async load(_name,{legacy}){if(fail)throw Error('storage failure');saved ??= structuredClone(legacy);return structuredClone(saved);},
        async save(_name,value){if(fail)throw Error('storage failure');saved=structuredClone(value);return structuredClone(saved);},
    }}};
    return {ctx,host,legacy,get saved(){return saved;},set saved(value){saved=value;},set fail(value){fail=value;}};
};
test('server migration keeps cards, aliases, receipts and a readable compatibility marker',async()=>{
    const f=fixture();await hydrateVaultStorage(f.ctx,{host:f.host});
    assert.deepEqual(f.saved,f.legacy);
    assert.equal(f.ctx.chatMetadata.knowledgeVaultV1.storage,'scene-reader');
    assert.equal(vaultStorageState(f.ctx).status,'ready');
});
test('concurrent field edits serialize without erasing cards or aliases',async()=>{
    const f=fixture();await hydrateVaultStorage(f.ctx,{host:f.host});
    await Promise.all([updateVaultStorage(f.ctx,()=>({cards:[{id:'two'}]}),{host:f.host}),updateVaultStorage(f.ctx,()=>({actors:[{name:'Second'}]}),{host:f.host})]);
    assert.deepEqual(f.saved.cards,[{id:'two'}]);assert.deepEqual(f.saved.actors,[{name:'Second'}]);assert.deepEqual(f.saved.auditReceipts,['audit']);
});
test('server failure never silently saves new data only to chat metadata',async()=>{
    const f=fixture();await hydrateVaultStorage(f.ctx,{host:f.host});const before=structuredClone(f.ctx.chatMetadata);f.fail=true;
    await assert.rejects(updateVaultStorage(f.ctx,()=>({cards:[]}),{host:f.host}));
    assert.deepEqual(f.ctx.chatMetadata,before);assert.equal(vaultStorageState(f.ctx).status,'failed');
    f.fail=false;await updateVaultStorage(f.ctx,()=>({cards:[]}),{host:f.host});assert.deepEqual(f.saved.cards,[]);
});
test('restoring a backup without vault data cannot migrate the stale compatibility mirror again',async()=>{
    const f=fixture();await hydrateVaultStorage(f.ctx,{host:f.host});f.saved=undefined;
    await hydrateVaultStorage(f.ctx,{host:f.host,force:true});
    assert.deepEqual(f.ctx.chatMetadata.knowledgeVaultV1.cards,[]);assert.equal(f.saved,undefined);
});
test('slow loading after the same context object switches chats cannot replace the new metadata',async()=>{
    const f=fixture();let release;f.host.SceneReaderHub.companionStorage.load=()=>new Promise(resolve=>{release=resolve;});
    const loading=hydrateVaultStorage(f.ctx,{host:f.host});
    const newMetadata={knowledgeVaultV1:{cards:[{id:'new-chat'}]}};f.ctx.chatMetadata=newMetadata;release(f.legacy);
    await assert.rejects(loading,{code:'STORAGE_STALE_CHAT'});assert.equal(f.ctx.chatMetadata,newMetadata);
});
test('invalid server records retain the legacy cards and expose a storage failure',async()=>{
    const f=fixture();f.saved={version:2,cards:'invalid'};
    await assert.rejects(hydrateVaultStorage(f.ctx,{host:f.host}),{code:'VAULT_STORAGE_INVALID'});
    assert.deepEqual(f.ctx.chatMetadata.knowledgeVaultV1,f.legacy);assert.equal(vaultStorageState(f.ctx).status,'failed');
});
