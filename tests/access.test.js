import test from 'node:test';
import assert from 'node:assert/strict';
import {canUseVault,requestVaultOpen} from '../vault/access.js';
test('vault UI uses Hub permission without inferring access from installation',()=>{
  assert.equal(canUseVault({}),false);
  assert.equal(canUseVault({SceneReaderHub:{canUseKnowledgeVault:()=>false}}),false);
  assert.equal(canUseVault({SceneReaderHub:{canUseKnowledgeVault:()=>true}}),true);
  assert.equal(canUseVault({SceneReaderHub:{canUseKnowledgeVault:()=>{throw Error('unavailable');}}}),false);
  const messages=[];
  assert.equal(requestVaultOpen({toastr:{info:message=>messages.push(message)}}),false);
  assert.deepEqual(messages,['씬판독기 Hub를 설치·활성화한 뒤 새로고침해 주세요.']);
});
