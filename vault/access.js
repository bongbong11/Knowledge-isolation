export function canUseVault(host = globalThis) {
  try { return host.SceneReaderHub?.canUseKnowledgeVault?.() === true; }
  catch { return false; }
}

export function requestVaultOpen(host = globalThis) {
  if (typeof host.SceneReaderHub?.openKnowledgeVault === 'function') return host.SceneReaderHub.openKnowledgeVault();
  host.toastr?.info('쉿, 업데이트 중');
  return false;
}
