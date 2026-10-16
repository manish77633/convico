import { classifyPrompt, createMockReply, isHinglishPrompt } from './reply';

describe('local mock replies', () => {
  it('uses simple Hinglish for Roman Hindi and Devanagari prompts', () => {
    expect(isHinglishPrompt('mujhe plan banao')).toBe(true);
    expect(isHinglishPrompt('मुझे प्लान चाहिए')).toBe(true);
    expect(classifyPrompt('मुझे योजना बनाओ')).toBe('planning');
    expect(isHinglishPrompt('Make a plan')).toBe(false);
    expect(createMockReply('mujhe plan banao')).toContain('Goal aur deadline');
  });

  it('routes different requests to different useful outlines', () => {
    expect(classifyPrompt('Fix a bug')).toBe('debugging');
    expect(classifyPrompt('Write an email')).toBe('writing');
    expect(createMockReply('Fix a bug')).not.toBe(createMockReply('Write an email'));
    expect(createMockReply('Make a plan')).toContain('\n2.');
  });

  it('does not invent facts for unknown questions', () => {
    expect(createMockReply('What is the stock price today?')).toContain('real AI ya source chahiye');
  });
});
