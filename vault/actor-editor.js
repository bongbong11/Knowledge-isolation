import { actorId, uniqueTags } from './identity.js';
import { readActors, writeActors } from './store.js';

export function editActorAliases(host, name, context, onChange) {
  host.replaceChildren();
  const actor = readActors(context()).find(item => actorId(item.name) === actorId(name));
  const label = document.createElement('label'); label.textContent = `${name}의 별명·다른 표기`;
  const input = document.createElement('input'); input.value = (actor?.aliases || []).join(', ');
  input.placeholder = '예: Dom, 도미닉'; input.setAttribute('aria-label', label.textContent);
  const note = document.createElement('small'); note.textContent = '쉼표로 구분하세요. 그·그녀 같은 대명사는 등록하지 않습니다.';
  const save = document.createElement('button'); save.type = 'button'; save.className = 'kv-button'; save.textContent = '별칭 저장';
  const message = document.createElement('small');
  save.addEventListener('click', async () => {
    const aliases = uniqueTags(input.value.split(',')).filter(alias => !['he','she','they','him','her','그','그녀','그들'].includes(alias.toLowerCase()));
    const actors = readActors(context()).filter(item => actorId(item.name) !== actorId(name));
    try { await writeActors(context(), [...actors, { id: actorId(name), name, aliases }]); host.replaceChildren(); onChange(); }
    catch { message.textContent = '별칭을 저장하지 못했습니다. 다시 시도해 주세요.'; }
  });
  host.append(label, input, note, save, message); input.focus();
}
