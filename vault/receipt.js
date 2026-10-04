function promptText(data) {
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map(item => {
    if (typeof item?.content === 'string') return item.content;
    if (Array.isArray(item?.content)) return item.content.filter(part => part?.type === 'text').map(part => part.text || '').join('\n');
    return '';
  }).join('\n');
  if (!data || typeof data !== 'object') return '';
  return [promptText(data.prompt), promptText(data.input), promptText(data.messages), promptText(data.chat)].filter(Boolean).join('\n');
}

export function checkPromptReceipt(data, payload, { userName = '', characterName = '' } = {}) {
  if (!payload) return 'not_expected';
  const text = promptText(data).replaceAll('\r\n', '\n');
  if (!text) return 'unavailable';
  const expected = payload.replaceAll('\r\n', '\n');
  if (text.includes(expected)) return 'confirmed';
  const rendered = expected.replace(/\{\{user\}\}/gi, () => userName || '{{user}}')
    .replace(/\{\{char\}\}/gi, () => characterName || '{{char}}');
  if (text.includes(rendered)) return 'confirmed';
  return /\{\{[^}]+\}\}/.test(rendered) ? 'unverifiable' : 'missing';
}
