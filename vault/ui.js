import { normalizeCard, normalizeHolder, resolveRoute, ROUTES } from './core.js';
import { readCards, writeCards } from './store.js';

const LABELS = { auto: '자동', world: '세계관', user: '유저', character: '캐릭터', npc: 'NPC', shared: '공유 제한', disabled: '주입 안 함' };
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const button = (label, action, title = label) => {
  const element = node('button', 'kv-button', label);
  element.type = 'button'; element.title = title; element.addEventListener('click', action);
  return element;
};

export function mountVault({ host, context, settings, onSettingsChange, onCardsChange, onClose }) {
  const root = node('section', 'kv-root'); root.id = 'kv-root';
  const header = node('div', 'kv-header');
  header.append(node('strong', '', '🔐 정보금고 / Knowledge Vault'));
  const enabled = node('input'); enabled.type = 'checkbox'; enabled.checked = settings.enabled;
  enabled.addEventListener('change', () => { settings.enabled = enabled.checked; onSettingsChange(); });
  const enabledLabel = node('label', 'kv-on', '사용'); enabledLabel.prepend(enabled); header.append(enabledLabel);
  header.append(button('×', onClose, '닫기'));
  root.append(header);
  const hint = node('p', 'kv-hint', '현재 채팅에만 저장 · 목록에 없는 인물은 모름 · 씬 판정 전에는 원문 가림');
  root.append(hint);
  const message = node('div', 'kv-message'); root.append(message);
  const list = node('div', 'kv-list'); root.append(list);
  const add = button('+ 추가', () => editCard(null)); add.classList.add('kv-add'); root.append(add);
  const editor = node('form', 'kv-editor'); editor.hidden = true; root.append(editor);
  host.append(root);

  async function persist(cards) {
    try { await writeCards(context(), cards); message.textContent = ''; onCardsChange(); render(); }
    catch (error) { message.textContent = `저장 실패: ${error.message}`; }
  }

  function render() {
    list.replaceChildren();
    const cards = readCards(context());
    if (!context().chatMetadata) { list.append(node('div', 'kv-empty', '채팅을 열면 정보금고를 사용할 수 있습니다.')); add.disabled = true; return; }
    add.disabled = false;
    if (!cards.length) list.append(node('div', 'kv-empty', '저장된 카드가 없습니다.'));
    for (const card of cards) {
      const row = node('div', 'kv-row');
      const top = node('div', 'kv-row-top');
      const toggle = node('input'); toggle.type = 'checkbox'; toggle.checked = card.enabled; toggle.title = '카드 사용';
      toggle.addEventListener('change', () => persist(cards.map(item => item.id === card.id ? { ...item, enabled: toggle.checked } : item)));
      const name = node('span', 'kv-name', card.title); name.title = card.title;
      const select = node('select', 'kv-route'); select.title = '주입 위치'; select.setAttribute('aria-label', `${card.title} 주입 위치`);
      for (const route of ROUTES) { const option = node('option', '', LABELS[route]); option.value = route; select.append(option); }
      select.value = card.route;
      select.addEventListener('change', () => persist(cards.map(item => item.id === card.id ? { ...item, route: select.value } : item)));
      top.append(toggle, name, select);
      if (card.route === 'auto') top.append(node('small', 'kv-resolved', `→ ${LABELS[resolveRoute(card)]}`));
      row.append(top);
      const tags = [...(card.truthScope === 'world' ? ['세계'] : []), ...card.knownBy.map(x => x === 'user' ? '유저' : x === 'character' ? '캐릭터' : x)];
      row.append(node('div', 'kv-tags', `아는 대상: ${tags.join(', ')}`));
      const actions = node('div', 'kv-actions');
      actions.append(button('수정', () => editCard(card)));
      actions.append(button('삭제', () => { if (window.confirm(`“${card.title}” 카드를 삭제할까요?`)) persist(cards.filter(item => item.id !== card.id)); }));
      row.append(actions); list.append(row);
    }
  }

  function editCard(existing) {
    editor.replaceChildren(); editor.hidden = false;
    const card = existing || normalizeCard({ title: '', text: '', knownBy: [], enabled: true });
    const title = node('input'); title.required = true; title.maxLength = 120; title.value = card.title; title.placeholder = '저장 이름';
    const text = node('textarea'); text.required = true; text.maxLength = 2000; text.rows = 4; text.value = card.text; text.placeholder = '제한할 사실 (최대 2000자)';
    const tags = [...card.knownBy];
    const chips = node('div', 'kv-chips');
    const tagInput = node('input'); tagInput.placeholder = '유저 / 캐릭터 / 인물명 입력 후 Enter'; tagInput.setAttribute('aria-label', '아는 대상 추가');
    const world = node('input'); world.type = 'checkbox'; world.checked = card.truthScope === 'world';
    const worldLabel = node('label', 'kv-world', '세계 사실'); worldLabel.prepend(world);
    function showChips() {
      chips.replaceChildren();
      for (const tag of tags) chips.append(button(`${tag === 'user' ? '유저' : tag === 'character' ? '캐릭터' : tag} ×`, () => { tags.splice(tags.indexOf(tag), 1); showChips(); }, '아는 대상 제거'));
    }
    function addTag() {
      const tag = normalizeHolder(tagInput.value.replace(/,$/, ''));
      tagInput.value = '';
      if (tag === 'world') { world.checked = true; return; }
      if (tag && !tags.some(x => x.toLocaleLowerCase() === tag.toLocaleLowerCase())) tags.push(tag);
      showChips();
    }
    tagInput.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); addTag(); } });
    tagInput.addEventListener('blur', addTag);
    showChips();
    const footer = node('div', 'kv-form-actions');
    const save = node('button', 'kv-button', '저장'); save.type = 'submit';
    footer.append(save, button('취소', () => { editor.hidden = true; editor.replaceChildren(); }));
    editor.append(node('label', '', '이름'), title, node('label', '', '내용'), text, node('label', '', '아는 대상'), chips, tagInput, worldLabel, footer);
    editor.onsubmit = async event => {
      event.preventDefault(); addTag();
      const updated = normalizeCard({ ...card, title: title.value, text: text.value, knownBy: tags, truthScope: world.checked ? 'world' : 'private' });
      if (!updated.knownBy.length && updated.truthScope !== 'world') { message.textContent = '아는 대상 또는 세계 사실을 선택하세요.'; return; }
      const cards = readCards(context());
      await persist(existing ? cards.map(item => item.id === card.id ? updated : item) : [...cards, updated]);
      if (!message.textContent) { editor.hidden = true; editor.replaceChildren(); }
    };
    title.focus();
  }
  render();
  return render;
}
