// Standalone turn filtering; never changes the user's stored message.
export function rpPortion(value) {
  const text = String(value || '');
  if (/^\s*(?:ooc|out\s+of\s+character|오오씨|사담)\s*:/i.test(text)) return '';
  let result = '', cursor = 0;
  const openings = /[\[(](?:ooc|out\s+of\s+character|오오씨|사담)\s*:/gi;
  for (let match; (match = openings.exec(text));) {
    result += text.slice(cursor, match.index);
    const stack = [text[match.index] === '(' ? ')' : ']']; let end = -1;
    for (let i = openings.lastIndex; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '(') stack.push(')');
      else if (text[i] === '[') stack.push(']');
      else if (text[i] === stack.at(-1)) { stack.pop(); if (!stack.length) { end = i + 1; break; } }
    }
    if (end < 0) return '';
    cursor = end; openings.lastIndex = end;
  }
  return (result + text.slice(cursor)).trim();
}
export function isRpTurn(context, type, composer = '') {
  if (type === 'quiet') return false;
  const latest = (context.chat || []).findLast(message => message?.is_user && !message.is_system && !message.hidden && !message.is_hidden);
  if (String(composer).trim() && !['swipe','regenerate','continue'].includes(type)) return Boolean(rpPortion(composer));
  return !latest?.extra?.ooc_chat && (!latest || Boolean(rpPortion(latest.mes)));
}
