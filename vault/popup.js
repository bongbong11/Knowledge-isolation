const STORAGE_KEY = 'knowledge-vault-popup-geometry-v1';
const compactViewport = viewport => viewport.width <= 600 || viewport.height <= 500;

export function clampGeometry(value, viewport) {
  const widthLimit = Math.max(1, viewport.width - 16);
  const heightLimit = Math.max(1, viewport.height - 16);
  if(compactViewport(viewport))return {left:8,top:8,width:widthLimit,height:heightLimit};
  const minWidth = Math.min(360, widthLimit);
  const minHeight = Math.min(280, heightLimit);
  const width = Math.min(widthLimit, Math.max(minWidth, Number(value?.width) || Math.min(900, widthLimit)));
  const height = Math.min(heightLimit, Math.max(minHeight, Number(value?.height) || Math.min(740, heightLimit)));
  const left = Math.min(Math.max(8, Number(value?.left) || (viewport.width - width) / 2), Math.max(8, viewport.width - width - 8));
  const top = Math.min(Math.max(8, Number(value?.top) || viewport.height * .08), Math.max(8, viewport.height - height - 8));
  return { left, top, width, height };
}

export function createPopup({ render, canOpen = () => false }) {
  const panel = document.createElement('dialog');
  panel.id = 'kv-popup'; panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '정보금고');
  panel.setAttribute('aria-modal', 'true');
  const resizeHandle = document.createElement('button');
  resizeHandle.type = 'button'; resizeHandle.className = 'kv-resize-handle';
  resizeHandle.title = '창 크기 조절 · 두 번 누르면 기본 크기';
  resizeHandle.setAttribute('aria-label', resizeHandle.title);
  resizeHandle.textContent = '⤡';
  panel.append(resizeHandle);
  document.body.append(panel);

  const viewport = () => ({ width: window.visualViewport?.width || window.innerWidth, height: window.visualViewport?.height || window.innerHeight });
  let geometry, preferredGeometry;
  try { preferredGeometry = JSON.parse(localStorage.getItem(STORAGE_KEY)); }
  catch { preferredGeometry = null; }
  function applyGeometry(next, save = false) {
    geometry = clampGeometry(next, viewport());
    Object.assign(panel.style, {
      transform: 'none', left: `${geometry.left}px`, top: `${geometry.top}px`,
      width: `${geometry.width}px`, height: `${geometry.height}px`,
      minWidth: `${Math.min(360,geometry.width)}px`, minHeight: `${Math.min(280,geometry.height)}px`,
    });
    if (save && !compactViewport(viewport())) { preferredGeometry={...geometry};try { localStorage.setItem(STORAGE_KEY, JSON.stringify(preferredGeometry)); } catch { /* Storage is optional. */ } }
  }
  applyGeometry(preferredGeometry);

  let gesture = null;
  function startGesture(event, kind) {
    if(compactViewport(viewport()))return;
    if (event.button !== 0 || (kind === 'move' && event.pointerType === 'touch')) return;
    event.preventDefault();
    event.stopPropagation();
    const captureTarget = kind === 'resize' ? resizeHandle : panel;
    gesture = { kind, pointerId: event.pointerId, x: event.clientX, y: event.clientY, start: { ...geometry }, captureTarget };
    captureTarget.setPointerCapture(event.pointerId);
  }
  panel.addEventListener('pointerdown', event => {
    if (event.target === resizeHandle) return startGesture(event, 'resize');
    if (!event.target.closest('.kv-header') || event.target.closest('button, input, select, label')) return;
    startGesture(event, 'move');
  });
  panel.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    if (gesture.kind === 'move') applyGeometry({ ...gesture.start, left: gesture.start.left + dx, top: gesture.start.top + dy });
    else applyGeometry({ ...gesture.start,
      width: Math.min(window.innerWidth - gesture.start.left - 8, gesture.start.width + dx),
      height: Math.min(window.innerHeight - gesture.start.top - 8, gesture.start.height + dy),
    });
  });
  function finishGesture(event) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const captureTarget = gesture.captureTarget;
    gesture = null; applyGeometry(geometry, true);
    if (captureTarget.hasPointerCapture(event.pointerId)) captureTarget.releasePointerCapture(event.pointerId);
  }
  panel.addEventListener('pointerup', finishGesture);
  panel.addEventListener('pointercancel', finishGesture);
  resizeHandle.addEventListener('dblclick', event => { event.preventDefault(); applyGeometry(null, true); });
  resizeHandle.addEventListener('keydown', event => {
    const step = event.shiftKey ? 50 : 20;
    const change = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[event.key];
    if (!change) return;
    event.preventDefault();
    applyGeometry({ ...geometry, width: geometry.width + change[0], height: geometry.height + change[1] }, true);
  });
  const fitViewport=()=>applyGeometry(preferredGeometry);
  window.addEventListener('resize', fitViewport);
  window.visualViewport?.addEventListener('resize', fitViewport);

  const close = () => { if (panel.open) panel.close(); panel.hidden = true; };
  const open = () => {
    if (!canOpen()) return false;
    fitViewport();
    render(); panel.hidden = false;
    if (!panel.open) panel.showModal();
    panel.querySelector('.kv-header button')?.focus();
    return true;
  };
  panel.addEventListener('cancel', event => { event.preventDefault(); close(); });
  panel.addEventListener('close', () => { panel.hidden = true; });
  panel.addEventListener('click', event => {
    if (event.target !== panel) return;
    const rect = panel.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close();
  });
  return { panel, close, open };
}
