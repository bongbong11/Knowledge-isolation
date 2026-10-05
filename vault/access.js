export function canUseVault(host = globalThis) {
  try { return host.SceneReaderHub?.canUseKnowledgeVault?.() === true; }
  catch { return false; }
}

export function requestVaultOpen(host = globalThis) {
  if (typeof host.SceneReaderHub?.openKnowledgeVault === 'function') return host.SceneReaderHub.openKnowledgeVault();
  host.toastr?.info('씬판독기 Hub를 설치·활성화한 뒤 새로고침해 주세요.');
  return false;
}
