import test from 'node:test';
import assert from 'node:assert/strict';
import { isRpTurn, rpPortion } from '../vault/turn.js';

test('quiet and standalone OOC never use vault selection or acquisition', () => {
  const ctx={chat:[{is_user:true,mes:'I enter the room.'}]};
  assert.equal(isRpTurn(ctx,'quiet'),false);
  assert.equal(isRpTurn(ctx,'normal','OOC: revise the last reply'),false);
  assert.equal(isRpTurn({chat:[{is_user:true,mes:'(OOC: explain the setting)'}]},'normal'),false);
  assert.equal(isRpTurn({chat:[{is_user:true,mes:'I enter.',extra:{ooc_chat:true}}]},'regenerate'),false);
  assert.equal(isRpTurn(ctx,'normal','[OOC: malformed'),false);
});

test('mixed RP stays usable and OOC is removed without altering stored messages', () => {
  const text='I enter. (OOC: do not count [this nested remark]) I ask her name.';
  assert.equal(rpPortion(text),'I enter.  I ask her name.');
  const ctx={chat:[{is_user:true,mes:text}]};
  assert.equal(isRpTurn(ctx,'normal'),true);
  assert.equal(isRpTurn(ctx,'regenerate','OOC: unrelated draft'),true);
  assert.equal(ctx.chat[0].mes,text);
});
