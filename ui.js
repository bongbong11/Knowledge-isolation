// ui.js — Knowledge Isolation
// Renders the settings panel UI and wires it to the settings object.
// This is the "real" version of the HTML mockup: same visual structure,
// but every control reads/writes the actual settings object and persists
// via the onChange callback (which calls saveSettingsDebounced in ST).

const LAYER_META = {
  world: { icon: '🌐', label: 'World Truth', cls: 'ei-w', blind: false },
  char:  { icon: '🎭', label: 'Char Secret',  cls: 'ei-c', blind: true  },
  user:  { icon: '👤', label: 'User Secret',  cls: 'ei-u', blind: false },
};

const PROMPT_AREAS = [
  { key: 'world-gm',    name: 'World GM',                 desc: 'GM 모델이 World Truth를 읽고 씬 이벤트를 생성하는 방식.' },
  { key: 'clue-gen',    name: 'Clue Generator',            desc: '단서 형식과 공개 속도 정의.' },
  { key: 'bias',        name: 'Bias Prevention',           desc: '단서 편향 방지와 레드헤링 강제 생성.' },
  { key: 'char-inject', name: 'Char Secret Injection',     desc: '캐릭터 비밀을 메인 모델에 주입하는 포맷.' },
  { key: 'clue-inject', name: 'Clue Injection Format',     desc: 'GM이 생성한 단서를 메인 모델 컨텍스트에 삽입하는 포맷.' },
  { key: 'user-inject', name: 'User Secret Injection',     desc: '페르소나 비밀을 유저 레이어에 주입하는 방식.' },
];

let STATE = null;   // settings object reference
let ONCHANGE = null;
let ONNEWENTRY = null;
let ONRUNPREVIEW = null;
let activeLayerTab = 'world';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function persist() {
  ONCHANGE?.();
}

// ─────────────────────────────────────────────────────────────
// Entry list rendering (World / Char / User tabs share this)
// ─────────────────────────────────────────────────────────────

function renderEntryList(layer) {
  const meta = LAYER_META[layer];
  const entries = STATE[layer].entries;
  const list = el('div', { class: 'ki-entry-list' });

  if (!entries.length) {
    list.appendChild(el('div', { class: 'ki-entry-empty' }, '항목이 없습니다. 새로 생성하세요.'));
  }

  entries.forEach((entry) => {
    list.appendChild(renderEntryCard(layer, entry, meta));
  });

  return list;
}

function impLabel(v) {
  return v === 'high' ? '중요도 높음' : v === 'mid' ? '중요도 중간' : '중요도 낮음';
}
function impClass(v) {
  return v === 'high' ? 'tag-high' : v === 'mid' ? 'tag-mid' : 'tag-low';
}
function paceLabel(v) {
  return { never: '영원히 비공개', slow: '천천히 흘림', normal: '자연스럽게 흘림', confession_ready: '직접 고백 가능' }[v] || v;
}

function renderEntryCard(layer, entry, meta) {
  const isBlind = layer === 'char' && entry.blind;
  const titleText = isBlind ? '[블라인드]' : (entry.title || '(제목 없음)');
  const contentText = isBlind ? '[내용 숨김]' : (entry.content || '(내용 없음)');

  const card = el('div', { class: 'ki-entry' + (entry.active ? '' : ' inactive') });

  const tags = [el('span', { class: `ki-tag ${impClass(entry.importance)}` }, impLabel(entry.importance))];
  if (layer === 'char') {
    tags.push(el('span', { class: 'ki-tag tag-fixed' }, paceLabel(entry.pace)));
  }
  if (layer === 'user' && entry.charAware) {
    tags.push(el('span', { class: 'ki-tag tag-mid' }, '캐릭터도 인지(숨김)'));
  }

  const header = el('div', { class: 'ki-entry-header' }, [
    el('div', { class: 'ki-entry-left' }, [
      el('div', { class: `ki-entry-icon ${meta.cls}` }, meta.icon),
      el('div', { class: 'ki-entry-meta' }, [
        el('div', { class: 'ki-entry-title' + (isBlind ? ' blinded' : '') }, titleText),
        el('div', { class: 'ki-entry-tags' }, tags),
      ]),
    ]),
    el('div', { class: 'ki-entry-actions' }, [
      el('div', {
        class: 'ki-entry-toggle' + (entry.active ? ' on' : ''),
        onclick: (e) => { e.stopPropagation(); entry.active = !entry.active; persist(); rerenderLayer(layer); },
      }),
      el('div', { class: 'ki-entry-expand', onclick: (e) => { e.stopPropagation(); body.classList.toggle('open'); } }, '▾'),
      el('div', {
        class: 'ki-entry-del',
        onclick: (e) => {
          e.stopPropagation();
          STATE[layer].entries = STATE[layer].entries.filter(x => x.id !== entry.id);
          persist();
          rerenderLayer(layer);
        },
      }, '×'),
    ]),
  ]);
  header.addEventListener('click', () => body.classList.toggle('open'));

  const body = el('div', { class: 'ki-entry-body' }, [
    el('div', { class: 'ki-entry-content' + (isBlind ? ' blinded' : '') }, contentText),
  ]);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function rerenderLayer(layer) {
  const mount = document.getElementById(`ki-list-${layer}`);
  if (!mount) return;
  mount.innerHTML = '';
  mount.appendChild(renderEntryList(layer));
}

// ─────────────────────────────────────────────────────────────
// Create-entry modal
// ─────────────────────────────────────────────────────────────

function openCreateModal(layer) {
  const meta = LAYER_META[layer];
  const overlay = el('div', { class: 'ki-modal-overlay open' });

  const titleInput = el('input', { class: 'ki-input', type: 'text', placeholder: '항목 제목을 입력하세요' });
  const contentInput = el('textarea', { class: 'ki-textarea', placeholder: '세부 내용을 입력하세요...' });

  let importance = 'high';
  let blind = true;
  let pace = 'normal';
  let charAware = false;

  const impGroup = el('div', { class: 'ki-sel-group' });
  ['high', 'mid', 'low'].forEach((v) => {
    const btn = el('button', {
      class: 'ki-sel-btn' + (v === importance ? ` sel-${v}` : ''),
      onclick: () => { importance = v; refreshSel(impGroup, v); },
    }, v === 'high' ? '🔴 높음' : v === 'mid' ? '🟡 중간' : '⚪ 낮음');
    impGroup.appendChild(btn);
  });

  const extraRow = el('div', { class: 'ki-extra-row' });
  if (layer === 'char') {
    const blindRow = el('div', { class: 'ki-toggle-row' }, [
      el('span', { class: 'ki-toggle-label' }, '🙈 블라인드 저장 (유저도 내용 못 봄)'),
      el('div', {
        class: 'ki-toggle on',
        onclick: (e) => { blind = !blind; e.target.classList.toggle('on'); },
      }),
    ]);
    const paceGroup = el('div', { class: 'ki-sel-group' });
    ['never', 'slow', 'normal', 'confession_ready'].forEach((v) => {
      const btn = el('button', {
        class: 'ki-sel-btn' + (v === pace ? ' sel-fixed' : ''),
        onclick: () => { pace = v; refreshSel(paceGroup, v, 'sel-fixed'); },
      }, paceLabel(v));
      paceGroup.appendChild(btn);
    });
    extraRow.appendChild(el('div', { class: 'ki-field-label' }, '공개 속도'));
    extraRow.appendChild(paceGroup);
    extraRow.appendChild(blindRow);
  }
  if (layer === 'user') {
    const awareRow = el('div', { class: 'ki-toggle-row' }, [
      el('span', { class: 'ki-toggle-label' }, '👁 캐릭터도 알지만 숨김'),
      el('div', {
        class: 'ki-toggle',
        onclick: (e) => { charAware = !charAware; e.target.classList.toggle('on'); },
      }),
    ]);
    extraRow.appendChild(awareRow);
  }

  function refreshSel(group, val, prefix = 'sel-') {
    Array.from(group.children).forEach((btn, i) => {
      btn.className = 'ki-sel-btn';
    });
    // Re-apply selection class to the clicked one is handled by caller via class list;
    // simplest robust approach: rebuild classes based on val match using dataset.
  }

  const modal = el('div', { class: 'ki-modal' }, [
    el('div', { class: 'ki-modal-header' }, [
      el('div', { class: 'ki-modal-title' }, `${meta.label} 항목 생성`),
      el('div', { class: 'ki-modal-close', onclick: () => overlay.remove() }, '×'),
    ]),
    el('div', { class: 'ki-modal-body' }, [
      el('div', { class: 'ki-field-label' }, '제목'),
      titleInput,
      el('div', { class: 'ki-field-label' }, '내용'),
      contentInput,
      el('div', { class: 'ki-field-label' }, '중요도'),
      impGroup,
      extraRow,
    ]),
    el('div', { class: 'ki-modal-footer' }, [
      el('button', { class: 'ki-btn-ghost', onclick: () => overlay.remove() }, '취소'),
      el('button', {
        class: 'ki-btn-primary',
        onclick: () => {
          const title = titleInput.value.trim();
          if (!title) { titleInput.focus(); return; }
          const overrides = {
            title,
            content: contentInput.value.trim(),
            importance,
          };
          if (layer === 'char') { overrides.blind = blind; overrides.pace = pace; }
          if (layer === 'user') { overrides.charAware = charAware; }
          const entry = ONNEWENTRY(layer, overrides);
          STATE[layer].entries.push(entry);
          persist();
          rerenderLayer(layer);
          overlay.remove();
        },
      }, '저장'),
    ]),
  ]);

  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────
// World-specific controls (pace / red herring / anti-bias)
// ─────────────────────────────────────────────────────────────

function renderWorldControls() {
  const wrap = el('div', {});
  wrap.appendChild(el('div', { class: 'ki-field-label' }, '단서 공개 속도'));

  const paceGroup = el('div', { class: 'ki-pace-group' });
  ['slow', 'normal', 'fast'].forEach((v) => {
    const btn = el('button', {
      class: 'ki-pace-btn' + (STATE.world.pace === v ? ' on' : ''),
      onclick: () => {
        STATE.world.pace = v;
        persist();
        Array.from(paceGroup.children).forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
      },
    }, v === 'slow' ? '🐢 Slow' : v === 'normal' ? '🚶 Normal' : '🏃 Fast');
    paceGroup.appendChild(btn);
  });
  wrap.appendChild(paceGroup);

  wrap.appendChild(toggleRow('레드헤링 강제 생성', STATE.world.redHerring, (v) => { STATE.world.redHerring = v; persist(); }));
  wrap.appendChild(toggleRow('단서 편향 방지', STATE.world.antiBias, (v) => { STATE.world.antiBias = v; persist(); }));

  return wrap;
}

function toggleRow(label, value, onChange) {
  const toggle = el('div', { class: 'ki-toggle' + (value ? ' on' : '') });
  toggle.addEventListener('click', () => {
    const next = !toggle.classList.contains('on');
    toggle.classList.toggle('on', next);
    onChange(next);
  });
  return el('div', { class: 'ki-toggle-row' }, [
    el('span', { class: 'ki-toggle-label' }, label),
    toggle,
  ]);
}

// ─────────────────────────────────────────────────────────────
// Settings tab: GM model, outlet config, preview, prompt editor
// ─────────────────────────────────────────────────────────────

function renderSettingsTab(opts) {
  const wrap = el('div', {});

  // GM model
  wrap.appendChild(el('div', { class: 'ki-section-title' }, 'GM 모델 설정'));
  const modelInput = el('input', {
    class: 'ki-input',
    type: 'text',
    value: STATE.gm.modelProfile,
    placeholder: '예: Gemini-GM (Connection Manager에 저장된 프로필 이름)',
  });
  modelInput.addEventListener('change', () => { STATE.gm.modelProfile = modelInput.value.trim(); persist(); });
  wrap.appendChild(el('div', { class: 'ki-field-label' }, 'GM 모델 프로필 이름 (Connection Manager)'));
  wrap.appendChild(modelInput);

  wrap.appendChild(toggleRow('GM 모델 매 턴 호출', STATE.gm.callEveryTurn, (v) => { STATE.gm.callEveryTurn = v; persist(); }));
  wrap.appendChild(toggleRow('단서 중복 방지', STATE.gm.dedupeClues, (v) => { STATE.gm.dedupeClues = v; persist(); }));

  wrap.appendChild(el('div', { class: 'ki-model-notice' },
    '⚠️ 메인 RP 모델과 다른 별도 모델이 반드시 필요합니다. ST Connection Manager에서 GM용 프로필을 별도로 설정하세요.'));

  // Outlet
  wrap.appendChild(el('div', { class: 'ki-section-title' }, '아웃렛 주입 설정'));
  const outletInput = el('input', { class: 'ki-input', type: 'text', value: STATE.outletName });
  outletInput.addEventListener('change', () => { STATE.outletName = outletInput.value.trim() || 'KI_Inject'; persist(); renderOutletHint(); });
  wrap.appendChild(el('div', { class: 'ki-field-label' }, '아웃렛 이름'));
  wrap.appendChild(outletInput);

  const hint = el('div', { class: 'ki-outlet-hint', id: 'ki-outlet-hint' });
  wrap.appendChild(hint);
  function renderOutletHint() {
    hint.innerHTML = '';
    hint.appendChild(document.createTextNode('시스템프롬프트 안에 아래 매크로를 넣으면 해당 위치에 전체 지식이 주입됩니다.'));
    hint.appendChild(el('br')); hint.appendChild(el('br'));
    hint.appendChild(el('code', {}, `{{outlet::${STATE.outletName}}}`));
  }
  renderOutletHint();

  const previewBtn = el('button', { class: 'ki-preview-btn' }, '주입 미리보기 (GM 시뮬레이션)');
  previewBtn.addEventListener('click', () => openPreviewModal(opts.onRunPreview));
  wrap.appendChild(previewBtn);

  // Prompt management
  wrap.appendChild(el('div', { class: 'ki-section-title' }, '프롬프트 관리'));
  const promptTrigger = el('div', { class: 'ki-prompt-trigger' }, [
    el('span', {}, '📝 프롬프트 편집'),
    el('span', {}, '→'),
  ]);
  promptTrigger.addEventListener('click', () => openPromptAreaModal());
  wrap.appendChild(promptTrigger);

  return wrap;
}

function openPreviewModal(onRunPreview) {
  const overlay = el('div', { class: 'ki-modal-overlay open' });
  const body = el('div', { class: 'ki-modal-body' });
  const modal = el('div', { class: 'ki-modal' }, [
    el('div', { class: 'ki-modal-header' }, [
      el('div', { class: 'ki-modal-title' }, '주입 미리보기 — GM 시뮬레이션'),
      el('div', { class: 'ki-modal-close', onclick: () => overlay.remove() }, '×'),
    ]),
    body,
    el('div', { class: 'ki-modal-footer' }, [
      el('button', { class: 'ki-btn-ghost', onclick: () => overlay.remove() }, '닫기'),
    ]),
  ]);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);

  const steps = {};
  function stepRow(id, label) {
    const row = el('div', { class: 'ki-pipeline-step', id: `ki-step-${id}` }, [
      el('div', { class: 'ki-step-label' }, label),
      el('div', { class: 'ki-step-status' }, '대기 중'),
    ]);
    steps[id] = row;
    return row;
  }
  body.appendChild(stepRow('world-load', 'World Truth 로드'));
  body.appendChild(stepRow('gm-call', 'GM 모델 호출 + 주입 조립'));
  body.appendChild(stepRow('assemble', '최종 주입 내용'));

  const resultBox = el('div', { class: 'ki-final-inject', style: 'display:none' });
  body.appendChild(resultBox);

  onRunPreview((stepId, info) => {
    const row = steps[stepId];
    if (!row) return;
    const statusEl = row.querySelector('.ki-step-status');
    if (info.status === 'active') statusEl.textContent = '처리 중...';
    if (info.status === 'done') statusEl.textContent = info.empty ? '항목 없음' : '완료';
    if (info.status === 'error') statusEl.textContent = '오류';
    if (info.text) {
      let pre = row.querySelector('.ki-step-content');
      if (!pre) {
        pre = el('div', { class: 'ki-step-content' });
        row.appendChild(pre);
      }
      pre.textContent = info.text;
    }
    if (stepId === 'assemble' && info.text !== undefined) {
      resultBox.style.display = 'block';
      resultBox.innerHTML = '';
      resultBox.appendChild(el('div', { class: 'ki-fi-label' }, `{{outlet::${STATE.outletName}}} 위치에 주입되는 내용`));
      resultBox.appendChild(el('div', { class: 'ki-fi-content' }, info.text || '(주입 내용 없음)'));
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Prompt editor: area select -> saved list -> edit
// ─────────────────────────────────────────────────────────────

function openPromptAreaModal() {
  const overlay = el('div', { class: 'ki-modal-overlay open' });
  const list = el('div', { class: 'ki-prompt-area-list' });
  PROMPT_AREAS.forEach((area) => {
    const item = el('div', { class: 'ki-prompt-area-item' }, [
      el('div', { class: 'ki-pai-info' }, [
        el('div', { class: 'ki-pai-name' }, area.name),
        el('div', { class: 'ki-pai-desc' }, area.desc),
      ]),
      el('div', {}, '→'),
    ]);
    item.addEventListener('click', () => { overlay.remove(); openPromptListModal(area); });
    list.appendChild(item);
  });

  const modal = el('div', { class: 'ki-modal' }, [
    el('div', { class: 'ki-modal-header' }, [
      el('div', { class: 'ki-modal-title' }, '프롬프트 영역 선택'),
      el('div', { class: 'ki-modal-close', onclick: () => overlay.remove() }, '×'),
    ]),
    el('div', { class: 'ki-modal-body' }, [list]),
  ]);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function openPromptListModal(area) {
  const overlay = el('div', { class: 'ki-modal-overlay open' });
  const listMount = el('div', { class: 'ki-prompt-saved-list' });

  function refresh() {
    listMount.innerHTML = '';
    const prompts = STATE.prompts[area.key] || [];
    if (!prompts.length) {
      listMount.appendChild(el('div', { class: 'ki-prompt-saved-empty' }, '저장된 프롬프트가 없습니다.'));
      return;
    }
    prompts.forEach((p, i) => {
      const body = el('div', { class: 'ki-psi-body' }, [el('div', { class: 'ki-psi-content' }, p.content)]);
      const header = el('div', { class: 'ki-psi-header' }, [
        el('div', { class: 'ki-psi-name' }, p.name),
        el('div', { class: 'ki-psi-actions' }, [
          el('button', { class: 'ki-psi-use', onclick: (e) => { e.stopPropagation(); alert(`"${p.name}" 프롬프트가 적용되었습니다.`); } }, '사용'),
          el('button', { class: 'ki-psi-edit', onclick: (e) => { e.stopPropagation(); overlay.remove(); openPromptEditModal(area, i); } }, '수정'),
          el('div', { class: 'ki-psi-del', onclick: (e) => { e.stopPropagation(); STATE.prompts[area.key].splice(i, 1); persist(); refresh(); } }, '×'),
        ]),
      ]);
      header.addEventListener('click', () => body.classList.toggle('open'));
      const item = el('div', { class: 'ki-prompt-saved-item' }, [header, body]);
      listMount.appendChild(item);
    });
  }
  refresh();

  const createBtn = el('button', { class: 'ki-create-btn' }, '+ 새 프롬프트 작성');
  createBtn.addEventListener('click', () => { overlay.remove(); openPromptEditModal(area, -1); });

  const modal = el('div', { class: 'ki-modal' }, [
    el('div', { class: 'ki-modal-header' }, [
      el('div', { class: 'ki-modal-title' }, area.name),
      el('div', { class: 'ki-modal-close', onclick: () => overlay.remove() }, '×'),
    ]),
    el('div', { class: 'ki-modal-body' }, [
      el('div', { class: 'ki-prompt-desc-box' }, area.desc),
      el('div', { class: 'ki-section-label' }, '저장된 프롬프트'),
      listMount,
      createBtn,
    ]),
  ]);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function openPromptEditModal(area, idx) {
  const existing = idx >= 0 ? STATE.prompts[area.key][idx] : null;
  const overlay = el('div', { class: 'ki-modal-overlay open' });
  const nameInput = el('input', { class: 'ki-input', type: 'text', value: existing?.name || '' });
  const contentInput = el('textarea', { class: 'ki-textarea-lg', value: existing?.content || '' });
  contentInput.value = existing?.content || '';

  const modal = el('div', { class: 'ki-modal' }, [
    el('div', { class: 'ki-modal-header' }, [
      el('div', { class: 'ki-modal-title' }, idx === -1 ? `${area.name} — 새 프롬프트` : `${area.name} — 수정`),
      el('div', { class: 'ki-modal-close', onclick: () => overlay.remove() }, '×'),
    ]),
    el('div', { class: 'ki-modal-body' }, [
      el('div', { class: 'ki-field-label' }, '프롬프트 이름'),
      nameInput,
      el('div', { class: 'ki-field-label' }, '프롬프트 내용'),
      contentInput,
    ]),
    el('div', { class: 'ki-modal-footer' }, [
      el('button', { class: 'ki-btn-ghost', onclick: () => overlay.remove() }, '취소'),
      el('button', {
        class: 'ki-btn-primary',
        onclick: () => {
          const name = nameInput.value.trim();
          if (!name) { nameInput.focus(); return; }
          const entry = { id: existing?.id || `${area.key}_${Date.now()}`, name, content: contentInput.value.trim() };
          if (!STATE.prompts[area.key]) STATE.prompts[area.key] = [];
          if (idx >= 0) STATE.prompts[area.key][idx] = entry;
          else STATE.prompts[area.key].push(entry);
          persist();
          overlay.remove();
          openPromptListModal(area);
        },
      }, '저장'),
    ]),
  ]);
  overlay.appendChild(modal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

// ─────────────────────────────────────────────────────────────
// Top-level panel: header (ext on/off), tabs, tab content
// ─────────────────────────────────────────────────────────────

export function renderSettingsPanel({ container, settings, onChange, onNewEntry, onRunPreview }) {
  if (!container) {
    console.error('[Knowledge Isolation] Settings container not found.');
    return;
  }
  STATE = settings;
  ONCHANGE = onChange;
  ONNEWENTRY = onNewEntry;
  ONRUNPREVIEW = onRunPreview;

  container.innerHTML = '';
  container.classList.add('ki-root');

  // Header with ext on/off
  const extToggle = el('div', { class: 'ki-ext-toggle' + (STATE.enabled ? ' on' : '') });
  const extLabel = el('span', { class: 'ki-ext-status' + (STATE.enabled ? ' on' : '') }, STATE.enabled ? 'ON' : 'OFF');
  extToggle.addEventListener('click', () => {
    STATE.enabled = !STATE.enabled;
    extToggle.classList.toggle('on', STATE.enabled);
    extLabel.textContent = STATE.enabled ? 'ON' : 'OFF';
    extLabel.classList.toggle('on', STATE.enabled);
    persist();
  });
  const header = el('div', { class: 'ki-header' }, [
    el('div', { class: 'ki-header-title' }, '🔐 Knowledge Isolation'),
    el('div', { class: 'ki-header-right' }, [extLabel, extToggle]),
  ]);

  // Tabs
  const tabsBar = el('div', { class: 'ki-tabs' });
  const contentMount = el('div', { class: 'ki-content' });

  const tabs = [
    { key: 'world', label: 'World' },
    { key: 'char', label: 'Char' },
    { key: 'user', label: 'User' },
    { key: 'settings', label: '⚙️' },
  ];

  function renderTabContent(key) {
    contentMount.innerHTML = '';
    if (key === 'settings') {
      contentMount.appendChild(renderSettingsTab({ onRunPreview: ONRUNPREVIEW }));
      return;
    }
    const meta = LAYER_META[key];
    contentMount.appendChild(el('div', { class: 'ki-layer-badge' }, meta.label));
    if (key === 'world') contentMount.appendChild(renderWorldControls());
    contentMount.appendChild(el('div', { class: 'ki-section-label' }, '항목 목록'));
    const listMount = el('div', { id: `ki-list-${key}` });
    listMount.appendChild(renderEntryList(key));
    contentMount.appendChild(listMount);
    const createBtn = el('button', { class: 'ki-create-btn' }, '+ 새 항목 생성');
    createBtn.addEventListener('click', () => openCreateModal(key));
    contentMount.appendChild(createBtn);
  }

  tabs.forEach((t) => {
    const tabEl = el('div', { class: 'ki-tab' }, t.label);
    tabEl.addEventListener('click', () => {
      Array.from(tabsBar.children).forEach(c => c.classList.remove('active'));
      tabEl.classList.add('active');
      renderTabContent(t.key);
    });
    if (t.key === activeLayerTab) tabEl.classList.add('active');
    tabsBar.appendChild(tabEl);
  });

  container.appendChild(header);
  container.appendChild(tabsBar);
  container.appendChild(contentMount);
  renderTabContent(activeLayerTab);
}
