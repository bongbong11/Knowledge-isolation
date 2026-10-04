// World reality and character awareness are independent; keep the existing fields.
export const KNOWLEDGE_SCOPES = Object.freeze({
  private: { label: '인물별 비밀', note: '이 정보를 아는 캐릭터·페르소나·NPC를 선택하세요.' },
  world: { label: '세계의 실제 사실', note: '아는 사람 없이 저장할 수 있어요. 일반 진행·사건의 배경으로 쓰되, 발견 전에는 인물이 모릅니다.' },
  public: { label: '세계 공개 정보', note: '배경상 공개된 정보예요. 인물마다 실제로 아는 범위는 다를 수 있습니다.' },
});
export const knowledgeScope = card => card.public === true ? 'public' : card.truthScope === 'world' ? 'world' : 'private';
export const knowledgeScopeFields = scope => ({ truthScope: scope === 'world' || scope === 'public' ? 'world' : 'private', public: scope === 'public' });
export function knowledgeScopeSummary(card) {
  const scope = knowledgeScope(card);
  return KNOWLEDGE_SCOPES[scope].label + (scope === 'world' && !card.knownBy.length ? ' · 아직 아무도 모름' : '');
}

export const WORLD_FACT_RULES = `[WORLD REALITY — NOT CHARACTER AWARENESS]
World facts remain objectively true even when nobody knows them or characters believe the opposite. Use them as background constraints and plausible causes in ordinary continuation and permitted events when materially relevant. A fact's existence does not establish that an event has already happened.
An unknown fact may have a physical consequence without anyone understanding its cause. Narrate only appropriate observable effects; do not announce the hidden explanation or put it into an unknowing person's speech, thoughts, plans, targeted questions, or actions. Preserve their established beliefs until an actual discovery or information path supports a change. Do not fabricate intuition or a lucky correct guess to bypass this boundary.
This is reusable background, not an order to create an incident, force disclosure, accelerate time, or dictate the persona's choices. Follow the current scene, permitted event opportunities, pacing, world constraints and user agency. A possible outcome is not an inevitable outcome. Do not force a test, discovery or revelation merely to use this fact. Register knowledge only after an actor actually perceives and understands sufficient evidence.`;
