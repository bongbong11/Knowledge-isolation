import { normalizeCard, normalizeHolder } from './core.js';
import { readCards, writeCards } from './store.js';
import { uniqueTags } from './identity.js';
import { acquisitionLabel } from './acquisition.js';
import { editActorAliases } from './actor-editor.js';
import { KNOWLEDGE_SCOPES, knowledgeScope, knowledgeScopeFields, knowledgeScopeSummary } from './knowledge-scope.js';
import { createMascotIcon } from './mascot.js';

const holderLabel = value => value === 'user' ? '페르소나' : value === 'character' ? '캐릭터' : value;
const node = (tag, className, value) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
};
const button = (label, action, title = label) => {
  const element = node('button', 'kv-button', label);
  element.type = 'button'; element.title = title; element.addEventListener('click', action);
  return element;
};

export function mountVault({ host, context, settings, getRunStatus, onSettingsChange, onCardsChange, onClose }) {
  let selectedId = null;
  let renderedMetadata = context().chatMetadata;
  const root = node('section', 'kv-root'); root.id = 'kv-root';
  const header = node('div', 'kv-header');
  const title = node('strong', 'kv-title');
  title.append(createMascotIcon(), node('span', '', '정보금고 / Knowledge Vault 0.1.10'));
  header.append(title);
  const headerActions = node('div', 'kv-header-actions');
  const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => { settings.enabled = enabled.checked; onSettingsChange(); });
  const enabledLabel = node('label', 'kv-on', '사용'); enabledLabel.prepend(enabled);
  headerActions.append(enabledLabel, button('×', onClose, '닫기'));
  header.append(headerActions);
  root.append(header, node('p', 'kv-hint', '당신의 비밀을 지켜드립니다.'));

  const runBox = node('section', 'kv-run');
  const cardSummary = node('strong', 'kv-run-summary');
  const runSummary = node('div', 'kv-run-summary');
  runSummary.setAttribute('role', 'status'); runSummary.setAttribute('aria-live', 'polite');
  const receiptSummary = node('div', 'kv-run-note');
  const analysisSummary = node('div', 'kv-run-note');
  runBox.append(cardSummary, runSummary, receiptSummary, analysisSummary);
  root.append(runBox);

  const toolbar = node('div', 'kv-toolbar');
  toolbar.append(node('strong', '', '저장된 지식 카드'));
  const add = button('＋ 카드 추가', () => editCard(null));
  toolbar.append(add); root.append(toolbar);
  const message = node('div', 'kv-message'); message.setAttribute('role', 'alert'); root.append(message);
  const browser = node('div', 'kv-browser');
  const list = node('div', 'kv-list'); list.setAttribute('aria-label', '저장된 지식 카드');
  const detail = node('div', 'kv-detail');
  const view = node('div', 'kv-view');
  const editor = node('form', 'kv-editor'); editor.hidden = true;
  detail.append(view, editor); browser.append(list, detail); root.append(browser); host.append(root);

  async function persist(cards, nextId = selectedId) {
    try {
      await writeCards(context(), cards);
      selectedId = nextId;
      message.textContent = '';
      onCardsChange();
      render();
      return true;
    } catch (error) {
      message.textContent = `저장 실패: ${error.message}`;
      return false;
    }
  }

  function leaveEditor() {
    if (editor.hidden) return true;
    if (!window.confirm('작성 중인 변경을 버릴까요?')) return false;
    editor.hidden = true; editor.replaceChildren();
    return true;
  }
  function selectCard(id) {
    if (selectedId === id && editor.hidden) return;
    if (!leaveEditor()) return;
    selectedId = id; render();
  }
  function cardStatus(card, status) {
    if (!settings.enabled || !card.enabled || card.route === 'disabled') return '꺼짐';
    if (status.phase === 'registered') return status.includedIds.includes(card.id) ? '경계 등록' : '이번 턴 제외';
    if (status.phase === 'judged') {
      const result = status.sceneResults.find(item => item.secret_id === card.id);
      if (result) return result.relevant ? '관련' : '이번 턴 제외';
    }
    return '판독 대기';
  }
  function renderStatus(cards, status) {
    const activeCount = settings.enabled ? cards.filter(card => card.enabled && card.route !== 'disabled').length : 0;
    cardSummary.textContent = `현재 채팅 카드 ${cards.length}개 · 판독 대상 ${activeCount}개`;
    const time = status.at ? ` · ${new Date(status.at).toLocaleTimeString()}` : '';
    if (status.phase === 'reading') runSummary.textContent = `씬판독기 연결됨 · 카드 ${status.candidateCount}개 판독 요청됨 · 완료 확인 전${time}`;
    else if (status.phase === 'judged') runSummary.textContent = `씬판독기 판독 완료 · ${status.assessedCount}개 중 ${status.relevantCount}개 관련 · 생성 시 등록 대기${time}`;
    else if (status.phase === 'registered' && !status.enabled) runSummary.textContent = `정보금고 꺼짐 · 경계 해제${time}`;
    else if (status.phase === 'registered') {
      const source = status.source === 'scene-reader' ? `씬판독기 판독 ${status.assessedCount}개 · 관련 ${status.relevantCount}개` : activeCount ? '씬판독기 판정 없음 · 정보 내용은 가림' : '정보금고 판독 대상 카드 없음';
      runSummary.textContent = `${source} · ${status.includedIds.length ? `정보 ${status.includedIds.length}개 준비` : '이번 장면에 추가할 정보 없음'}${status.omittedCount ? ` · 길이 제한으로 ${status.omittedCount}개 제외` : ''}${time}`;
    } else if (status.phase === 'error') runSummary.textContent = `경계 등록 실패: ${status.error}${time}`;
    else if (status.phase === 'skipped') runSummary.textContent = '이번 입력은 금고 판독 대상이 아닙니다.';
    else runSummary.textContent = '아직 실행 기록 없음 · 카드를 저장하고 메시지를 생성하세요.';
    const receipt = status.receipt;
    if (receipt?.phase === 'request' && receipt.status === 'confirmed') receiptSummary.textContent = '전송 요청에 정보금고 경계 포함 확인';
    else if (receipt?.phase === 'request' && receipt.status === 'missing') receiptSummary.textContent = '전송 요청에서 정보금고 경계 미확인';
    else if (receipt?.phase === 'assembly' && receipt.status === 'confirmed') receiptSummary.textContent = '주입문 조립에 포함 확인 · 전송 요청 확인 대기';
    else if (receipt?.phase === 'assembly' && receipt.status === 'missing') receiptSummary.textContent = '주입문 조립에서 정보금고 경계 미확인';
    else if (receipt) receiptSummary.textContent = '전송 내용 확인 불가 · 사용 중인 생성 경로에서 내용을 읽지 못했습니다.';
    else receiptSummary.textContent = '경계 등록은 전송 확인과 다릅니다. 확인 가능한 생성 경로에서는 전송 상태도 여기에 표시됩니다.';
    const audit = status.analysis || {};
    analysisSummary.textContent = !settings.enabled ? '지식 습득 확인: 사용 안 함' : audit.phase === 'analyzing' ? `지식 습득 확인 중 · ${audit.checkedCount}개` : audit.phase === 'checked' ? `지식 습득 확인 · 새 습득 ${audit.learnedCount}개 · 일부 습득 ${audit.partialCount}개${audit.unresolvedCount ? ` · 미확인 ${audit.unresolvedCount}개` : ''}` : audit.phase === 'error' ? audit.code === 'PROFILE_UNAVAILABLE' ? '지식 습득 확인: 씬판독기 설정에서 확장 연결모델을 선택하세요.' : '지식 습득 확인 실패 · 기존 지식은 유지합니다.' : audit.phase === 'cancelled' ? '지식 습득 확인 중단 · 기존 지식 유지' : audit.phase === 'capacity' ? '지식 습득 확인: 카드 길이가 처리 범위를 넘었습니다.' : '지식 습득 확인: 완성된 응답을 기다립니다.';
  }

  function render() {
    if (context().chatMetadata !== renderedMetadata) {
      renderedMetadata = context().chatMetadata;
      selectedId = null;
      editor.hidden = true;
      editor.replaceChildren();
    }
    const cards = readCards(context());
    const status = getRunStatus();
    renderStatus(cards, status);
    list.replaceChildren(); view.replaceChildren();
    if (!context().chatMetadata) {
      list.append(node('div', 'kv-empty', '채팅을 열면 정보금고를 사용할 수 있습니다.'));
      view.append(node('div', 'kv-empty', '현재 채팅을 선택해 주세요.'));
      add.disabled = true; return;
    }
    add.disabled = false;
    if (!cards.some(card => card.id === selectedId)) selectedId = cards[0]?.id || null;
    if (!cards.length) {
      list.append(node('div', 'kv-empty', '저장된 카드가 없습니다.'));
      view.append(node('div', 'kv-empty', '＋ 카드 추가로 비밀을 등록하세요.'));
    }
    for (const card of cards) {
      const row = node('div', 'kv-row');
      if (card.id === selectedId) row.classList.add('active');
      const top = node('div', 'kv-row-top');
      const toggle = node('input'); toggle.type = 'checkbox'; toggle.checked = card.enabled; toggle.title = '카드 사용';
      toggle.disabled = !editor.hidden;
      toggle.setAttribute('aria-label', `${card.title} 사용`);
      toggle.addEventListener('change', () => persist(cards.map(item => item.id === card.id ? { ...item, enabled: toggle.checked, route: item.route === 'disabled' && toggle.checked ? 'auto' : item.route } : item), card.id));
      const name = button(card.title, () => selectCard(card.id), '카드 내용 보기'); name.classList.add('kv-name');
      top.append(toggle, name); row.append(top);
      const meta = node('div', 'kv-row-meta');
      const holders = card.knownBy.map(holderLabel);
      meta.append(node('span', '', card.public ? '세계 공개 정보' : card.truthScope === 'world' ? knowledgeScopeSummary(card) + (holders.length ? ` · ${holders.join(', ')}` : '') : holders.join(', ')));
      meta.append(node('small', 'kv-card-status', cardStatus(card, status)));
      row.append(meta); list.append(row);
    }
    const selected = cards.find(card => card.id === selectedId);
    if (selected) {
      const head = node('div', 'kv-detail-head');
      head.append(node('strong', '', selected.title), node('small', 'kv-card-status', cardStatus(selected, status)));
      view.append(head, node('div', 'kv-fact', selected.text));
      const holders = node('div', 'kv-detail-holders'); holders.append(node('strong', '', '아는 대상'));
      if (selected.public || selected.truthScope === 'world') holders.append(node('span', 'kv-holder-chip', knowledgeScopeSummary(selected)));
      const aliasHost = node('div', 'kv-alias-editor');
      for (const holder of selected.knownBy) {
        if (['user','character'].includes(holder)) holders.append(node('span', 'kv-holder-chip', holderLabel(holder)));
        else holders.append(button(holder, () => editActorAliases(aliasHost, holder, context, () => { onCardsChange(); render(); }), `${holder} 별칭 설정`));
      }
      view.append(holders);
      view.append(aliasHost);
      if (selected.acquisitions.length) {
        const history = node('details', 'kv-history'); history.append(node('summary', '', `습득 이력 ${selected.acquisitions.length}개`));
        for (const item of selected.acquisitions) history.append(node('div', '', acquisitionLabel(item, holderLabel(item.actorName))));
        view.append(history);
      }
      const actions = node('div', 'kv-actions');
      actions.append(button('수정', () => editCard(selected)));
      actions.append(button('삭제', async () => {
        if (!window.confirm(`“${selected.title}” 카드를 삭제할까요?`)) return;
        await persist(cards.filter(item => item.id !== selected.id), null);
      }));
      view.append(actions);
    }
    view.hidden = !editor.hidden;
  }

  function editCard(existing) {
    if (!context().chatMetadata || !leaveEditor()) return;
    editor.replaceChildren(); editor.hidden = false; view.hidden = true;
    const card = existing || normalizeCard({ title: '', text: '', knownBy: [], enabled: true });
    const head = node('div', 'kv-detail-head');
    head.append(node('strong', '', existing ? '카드 수정' : '새 카드'));
    head.append(button('×', () => { editor.hidden = true; editor.replaceChildren(); render(); }, '편집 닫기'));
    const title = node('input'); title.required = true; title.maxLength = 120; title.value = card.title; title.placeholder = '카드 이름';
    const fact = node('textarea'); fact.required = true; fact.maxLength = 2000; fact.rows = 5; fact.value = card.text; fact.placeholder = '이야기 속 사실이나 비밀 (최대 2000자)';
    const tags = [...card.manualKnownBy];
    const presets = node('div', 'kv-presets');
    const character = button('＋ 캐릭터', () => addHolder('character'));
    const persona = button('＋ 페르소나', () => addHolder('user'));
    presets.append(character, persona);
    const chips = node('div', 'kv-chips');
    const tagRow = node('div', 'kv-tag-row');
    const tagInput = node('input'); tagInput.placeholder = 'NPC 영어 이름'; tagInput.setAttribute('aria-label', '다른 아는 대상');
    tagRow.append(tagInput, button('추가', addTag));
    const scope = node('select', 'kv-scope'); scope.setAttribute('aria-label', '정보 범위');
    for (const [value, definition] of Object.entries(KNOWLEDGE_SCOPES)) {
      const option = node('option', '', definition.label); option.value = value; scope.append(option);
    }
    scope.value = knowledgeScope(card);
    const scopeNote = node('small', 'kv-run-note');
    const updateScopeNote = () => { scopeNote.textContent = KNOWLEDGE_SCOPES[scope.value].note; };
    scope.addEventListener('change', updateScopeNote); updateScopeNote();
    const footer = node('div', 'kv-form-actions');
    const save = node('button', 'kv-button kv-primary', '저장'); save.type = 'submit';
    footer.append(save, button('취소', () => { editor.hidden = true; editor.replaceChildren(); render(); }));

    function showChips() {
      chips.replaceChildren();
      for (const tag of tags) chips.append(button(`${holderLabel(tag)} ×`, () => { tags.splice(tags.indexOf(tag), 1); showChips(); }, '아는 대상 제거'));
      character.disabled = tags.includes('character'); persona.disabled = tags.includes('user');
    }
    function addHolder(value) {
      const tag = normalizeHolder(value);
      if (tag === 'world') { scope.value = 'world'; updateScopeNote(); return; }
      if (tag && !tags.some(item => item.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
      showChips();
    }
    function addTag() {
      const value = tagInput.value.replace(/,$/, ''); tagInput.value = ''; addHolder(value);
    }
    tagInput.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); }
    });
    showChips();
    editor.append(head, node('label', '', '이름'), title, node('label', '', '정보 내용'), fact,
      node('label', '', '정보 범위'), scope, scopeNote,
      node('label', '', '아는 대상'), presets, chips, tagRow, footer);
    if (card.acquisitions.length) editor.insertBefore(node('small', 'kv-run-note', '장면에서 추가된 태그는 습득 이력으로 관리합니다. 정보 내용을 바꾸면 이전 습득 기록을 다시 사용하지 않습니다.'), footer);
    editor.onsubmit = async event => {
      event.preventDefault(); addTag();
      const changedFact = card.text !== fact.value.trim();
      const acquisitions = changedFact ? [] : card.acquisitions;
      const updated = normalizeCard({ ...card, title: title.value, text: fact.value, knownBy: uniqueTags([...tags, ...acquisitions.filter(item => item.scope === 'full').map(item => item.actorName)]), manualKnownBy: tags, acquisitions,
        ...knowledgeScopeFields(scope.value), route: 'auto' });
      if (!updated.knownBy.length && updated.truthScope !== 'world') { message.textContent = '인물별 비밀은 아는 대상을 선택하세요. 아무도 모르는 사실은 정보 범위를 세계의 실제 사실로 선택하세요.'; return; }
      const cards = readCards(context());
      const saved = await persist(existing ? cards.map(item => item.id === card.id ? updated : item) : [...cards, updated], updated.id);
      if (saved) { editor.hidden = true; editor.replaceChildren(); render(); }
    };
    render();
    title.focus();
  }
  render();
  return render;
}
